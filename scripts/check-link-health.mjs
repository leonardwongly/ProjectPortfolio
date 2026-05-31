import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertPublicHttpsUrl, normalizePublicHttpsUrl } from './lib/network-safety.mjs';

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

function validateExternalUrl(rawUrl, source) {
  try {
    const parsed = normalizePublicHttpsUrl(rawUrl, { fieldPath: source });
    parsed.hash = '';
    return { ok: true, source, url: parsed.toString() };
  } catch (error) {
    const detail = error?.message || 'invalid URL';
    return {
      ok: false,
      source,
      url: rawUrl,
      category: detail.includes('malformed URL') ? 'invalid-url' : 'unsafe-url',
      detail: detail.replace(/^Invalid [^:]+:\s*/, '')
    };
  }
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

async function fetchWithTimeout(url, { method, timeoutMs, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
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
    const url = await assertPublicHttpsUrl(entry.url, {
      fieldPath: entry.source,
      lookupImpl: options.lookupImpl
    });
    let response = await fetchWithTimeout(url, {
      method: 'HEAD',
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetchWithTimeout(url, {
        method: 'GET',
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl
      });
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
      category: error?.message?.includes('blocked address') || error?.message?.includes('local/private')
        ? 'unsafe-url'
        : error?.name === 'AbortError' ? 'timeout' : 'network-error',
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
