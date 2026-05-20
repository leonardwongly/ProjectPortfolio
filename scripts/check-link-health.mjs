import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_TIMEOUT_MS = 8000;

const DATA_FILES = [
  'data/profile.json',
  'data/certifications.json',
  'data/featured-projects.json',
  'data/reading.json'
];

const GENERATED_HTML_FILES = [
  'index.html',
  'reading.html',
  'offline.html'
];

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    strict: false,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--timeout-ms') {
      const value = argv[index + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error('Expected integer value after --timeout-ms');
      }
      options.timeoutMs = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function isPrivateLiteralHost(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (lower === '0.0.0.0') return true;

  const ipVersion = net.isIP(lower);
  if (ipVersion === 4) {
    const parts = lower.split('.').map((part) => Number.parseInt(part, 10));
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  if (ipVersion === 6) {
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return false;
}

function validateExternalUrl(rawUrl, source) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    return { ok: false, source, url: rawUrl, category: 'invalid-url', detail: 'malformed URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, source, url: rawUrl, category: 'unsafe-url', detail: 'only https URLs are checked' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, source, url: rawUrl, category: 'unsafe-url', detail: 'credentials in URL are not allowed' };
  }
  if (isPrivateLiteralHost(parsed.hostname)) {
    return { ok: false, source, url: rawUrl, category: 'unsafe-url', detail: 'local/private literal host is blocked' };
  }

  parsed.hash = '';
  return { ok: true, source, url: parsed.toString() };
}

function collectJsonUrls(value, source, urls = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectJsonUrls(item, `${source}[${index}]`, urls));
    return urls;
  }
  if (!value || typeof value !== 'object') return urls;

  Object.entries(value).forEach(([key, item]) => {
    const nextSource = `${source}.${key}`;
    if (
      typeof item === 'string' &&
      /^(?:url|link|href|same_as)$/i.test(key) &&
      item.startsWith('https://')
    ) {
      urls.push({ source: nextSource, url: item });
    } else {
      collectJsonUrls(item, nextSource, urls);
    }
  });
  return urls;
}

function collectHtmlUrls(file) {
  const content = fs.readFileSync(path.join(projectRoot, file), 'utf8');
  const urls = [];
  const attrPattern = /\b(?:href|src)="(https:\/\/[^"]+)"/g;
  let match = attrPattern.exec(content);
  while (match) {
    urls.push({ source: `${file}:html`, url: match[1] });
    match = attrPattern.exec(content);
  }
  return urls;
}

function collectExternalUrls() {
  const urls = [];
  DATA_FILES.forEach((file) => {
    collectJsonUrls(JSON.parse(fs.readFileSync(path.join(projectRoot, file), 'utf8')), file, urls);
  });
  GENERATED_HTML_FILES.forEach((file) => {
    urls.push(...collectHtmlUrls(file));
  });

  const seen = new Map();
  return urls
    .map((entry) => validateExternalUrl(entry.url, entry.source))
    .filter((entry) => {
      const key = entry.ok ? entry.url : `${entry.category}:${entry.url}`;
      if (seen.has(key)) {
        const previous = seen.get(key);
        previous.source = `${previous.source}, ${entry.source}`;
        return false;
      }
      seen.set(key, entry);
      return true;
    });
}

async function fetchWithTimeout(url, { method, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'user-agent': 'ProjectPortfolio-link-health/1.0',
        connection: 'close'
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkUrl(entry, options) {
  if (!entry.ok) return entry;

  try {
    let response = await fetchWithTimeout(entry.url, { method: 'HEAD', timeoutMs: options.timeoutMs });
    if (response.status === 405 || response.status === 501) {
      response = await fetchWithTimeout(entry.url, { method: 'GET', timeoutMs: options.timeoutMs });
    }

    const reachable = response.status >= 200 && response.status < 400;
    const authRequired = response.status === 401 || response.status === 403;
    return {
      ...entry,
      ok: reachable || authRequired,
      category: reachable ? 'ok' : authRequired ? 'auth-required' : 'http-error',
      detail: `${response.status} ${response.statusText}`.trim()
    };
  } catch (error) {
    return {
      ...entry,
      ok: false,
      category: error?.name === 'AbortError' ? 'timeout' : 'network-error',
      detail: error?.message || 'network error'
    };
  }
}

async function runLinkHealth(options = parseArgs()) {
  const entries = collectExternalUrls();
  const results = [];
  for (const entry of entries) {
    results.push(await checkUrl(entry, options));
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs();
    const results = await runLinkHealth(options);
    const failures = results.filter((result) => !result.ok);
    console.log(`Checked ${results.length} external URL reference(s).`);
    failures.forEach((failure) => {
      console.log(`- ${failure.category}: ${failure.url} (${failure.source}) ${failure.detail}`);
    });
    if (options.strict && failures.some((failure) => failure.category !== 'timeout' && failure.category !== 'network-error')) {
      process.exitCode = 1;
    }
    process.exit(process.exitCode || 0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

export {
  collectExternalUrls,
  runLinkHealth,
  validateExternalUrl
};
