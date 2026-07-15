import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizePublicHttpsUrl, resolvePublicHttpsUrl } from './lib/network-safety.mjs';

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
    preflightOnly: false,
    strict: false,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--preflight-only') {
      options.preflightOnly = true;
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

function createPinnedLookup(records) {
  const approved = records.map(({ address, family }) => ({ address, family }));
  return (_hostname, options, callback) => {
    const wantsAll = typeof options === 'object' && options.all;
    if (wantsAll) {
      callback(null, approved.map((record) => ({ ...record })));
      return;
    }

    const requestedFamily = typeof options === 'number' ? options : options?.family;
    const record = approved.find((candidate) => !requestedFamily || candidate.family === requestedFamily);
    if (!record) {
      callback(new Error(`No approved DNS address matches family ${requestedFamily}`));
      return;
    }
    callback(null, record.address, record.family);
  };
}

async function requestWithTimeout(target, {
  method,
  timeoutMs,
  requestImpl = https.request
}) {
  return await new Promise((resolve, reject) => {
    const request = requestImpl(target.url, {
      method,
      lookup: createPinnedLookup(target.records),
      servername: net.isIP(target.hostname) ? undefined : target.hostname,
      headers: {
        'user-agent': 'ProjectPortfolio-link-health/1.0',
        connection: 'close'
      }
    }, (response) => {
      response.resume();
      resolve({
        status: response.statusCode || 0,
        statusText: response.statusMessage || ''
      });
    });

    request.setTimeout(timeoutMs, () => {
      const error = new Error(`Request timed out after ${timeoutMs}ms`);
      error.name = 'AbortError';
      request.destroy(error);
    });
    request.once('error', reject);
    request.end();
  });
}

async function checkUrl(entry, options) {
  if (!entry.ok) return entry;

  try {
    const target = await resolvePublicHttpsUrl(entry.url, {
      fieldPath: entry.source,
      lookupImpl: options.lookupImpl
    });
    if (options.preflightOnly) {
      return {
        ...entry,
        ok: true,
        category: 'preflight-ok',
        detail: 'URL shape and DNS preflight passed'
      };
    }
    let response = await requestWithTimeout(target, {
      method: 'HEAD',
      timeoutMs: options.timeoutMs,
      requestImpl: options.requestImpl
    });
    if (response.status === 405 || response.status === 501) {
      response = await requestWithTimeout(target, {
        method: 'GET',
        timeoutMs: options.timeoutMs,
        requestImpl: options.requestImpl
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
  createPinnedLookup,
  requestWithTimeout,
  runLinkHealth,
  validateExternalUrl
};
