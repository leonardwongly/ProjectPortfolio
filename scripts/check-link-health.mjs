import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createPinnedLookup as createNetworkPinnedLookup,
  normalizePublicHttpsUrl,
  resolvePublicHttpsUrl
} from './lib/network-safety.mjs';
import { decodeHtmlAttributeEntities, scanHtmlAttributes } from './lib/html-attributes.mjs';
import safeInput from './lib/safe-input.cjs';

const { readStableFileNoFollow } = safeInput;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TIMEOUT_MS = 60000;
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_URL_LENGTH = 4096;
const MAX_COLLECTION_DEPTH = 64;
const MAX_COLLECTION_NODES = 100000;
const MAX_URL_REFERENCES = 1000;
const MAX_STATUS_RESPONSE_BYTES = 1;
const MAX_HTML_ATTRIBUTES = 10000;

const DATA_FILES = [
  'data/profile.json',
  'data/certifications.json',
  'data/featured-projects.json',
  'data/reading.json',
  'data/experience.json',
  'data/case-studies.json',
  'data/skills.json',
  'data/resume.json'
];

const GENERATED_HTML_FILES = [
  'index.html',
  'work.html',
  'case-study-agentforge.html',
  'case-study-agentic.html',
  'case-study-apple-calendar-mcp.html',
  'reading.html',
  'offline.html'
];

function parsePositiveBoundedInteger(rawValue, label, maxValue) {
  const valueText = typeof rawValue === 'number' ? String(rawValue) : rawValue;
  if (typeof valueText !== 'string' || !/^[1-9]\d*$/.test(valueText)) {
    throw new Error(`${label} must be a positive integer`);
  }
  const value = Number(valueText);
  if (!Number.isSafeInteger(value) || value > maxValue) {
    throw new Error(`${label} must be at most ${maxValue}`);
  }
  return value;
}

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
      options.timeoutMs = parsePositiveBoundedInteger(value, 'Link health timeout', MAX_TIMEOUT_MS);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.timeoutMs = parsePositiveBoundedInteger(options.timeoutMs, 'Link health timeout', MAX_TIMEOUT_MS);
  return options;
}

function validateExternalUrl(rawUrl, source) {
  if (typeof rawUrl !== 'string') {
    return {
      ok: false,
      source,
      url: String(rawUrl),
      category: 'invalid-url',
      detail: 'URL-valued field must be a string'
    };
  }
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      source,
      url: rawUrl,
      category: 'invalid-url',
      detail: rawUrl ? `URL exceeds ${MAX_URL_LENGTH} character limit` : 'URL cannot be empty'
    };
  }

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

function invalidUrlReference(source, rawUrl, detail, category = 'invalid-url') {
  return {
    ok: false,
    source,
    url: typeof rawUrl === 'string' ? rawUrl : String(rawUrl),
    category,
    detail
  };
}

function classifyUrlReference(rawUrl, source) {
  if (typeof rawUrl !== 'string') {
    return validateExternalUrl(rawUrl, source);
  }

  const value = rawUrl.trim();
  if (!value || value.length > MAX_URL_LENGTH) {
    return validateExternalUrl(value, source);
  }
  if (/[\u0000-\u001f\u007f\\]/.test(value)) {
    return invalidUrlReference(source, value, 'URL contains disallowed control or backslash characters', 'unsafe-url');
  }
  if (value.startsWith('//')) {
    return invalidUrlReference(source, value, 'protocol-relative URLs are not allowed', 'unsafe-url');
  }
  if (/^[a-z][a-z\d+.-]*\/\//i.test(value)) {
    return invalidUrlReference(source, value, 'malformed absolute URL');
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    return validateExternalUrl(value, source);
  }

  try {
    const base = new URL('https://relative.invalid/');
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) {
      return validateExternalUrl(value, source);
    }
    return null;
  } catch (error) {
    return invalidUrlReference(source, value, 'malformed relative URL');
  }
}

function isUrlValuedField(key) {
  return /^(?:url|uri|href|link|same[_-]?as)$/i.test(key) ||
    /[_-](?:url|uri|href|link)$/i.test(key) ||
    /(?:URL|Url|URI|Uri|Href|Link)$/.test(key);
}

function addUrlReference(urls, rawUrl, source, maxReferences) {
  const classified = classifyUrlReference(rawUrl, source);
  if (!classified) return;
  if (urls.length >= maxReferences) {
    throw new Error(`URL references exceed ${maxReferences} entry limit`);
  }
  urls.push(classified);
}

function collectJsonUrls(value, source, urls = [], {
  maxDepth = MAX_COLLECTION_DEPTH,
  maxNodes = MAX_COLLECTION_NODES,
  maxReferences = MAX_URL_REFERENCES
} = {}) {
  const state = { nodes: 0 };

  function visit(item, itemSource, urlValued, depth) {
    state.nodes += 1;
    if (state.nodes > maxNodes) {
      throw new Error(`${source} exceeds ${maxNodes} JSON node limit`);
    }
    if (depth > maxDepth) {
      throw new Error(`${source} exceeds ${maxDepth} level JSON depth limit`);
    }

    if (urlValued) {
      if (Array.isArray(item)) {
        item.forEach((child, index) => visit(child, `${itemSource}[${index}]`, true, depth + 1));
        return;
      }
      addUrlReference(urls, item, itemSource, maxReferences);
      return;
    }

    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${itemSource}[${index}]`, false, depth + 1));
      return;
    }
    if (!item || typeof item !== 'object') return;

    Object.entries(item).forEach(([key, child]) => {
      visit(child, `${itemSource}.${key}`, isUrlValuedField(key), depth + 1);
    });
  }

  visit(value, source, false, 0);
  return urls;
}

function readBoundedSourceFile(rootDir, file, { openSync = fs.openSync } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const absolutePath = path.resolve(resolvedRoot, file);
  return readStableFileNoFollow(absolutePath, {
    label: file,
    rootDir: resolvedRoot,
    maxBytes: MAX_SOURCE_FILE_BYTES,
    minBytes: 0,
    openSync
  }).toString('utf8');
}

function collectHtmlUrls(file, {
  rootDir = projectRoot,
  maxReferences = MAX_URL_REFERENCES,
  openSync = fs.openSync
} = {}) {
  const content = readBoundedSourceFile(rootDir, file, { openSync });
  const urls = [];
  const scanned = scanHtmlAttributes(content, {
    attributeNames: ['href', 'src', 'srcset', 'action', 'formaction', 'poster', 'cite'],
    maxAttributes: MAX_HTML_ATTRIBUTES,
    maxBytes: MAX_SOURCE_FILE_BYTES
  });
  scanned.findings.forEach((finding) => {
    if (urls.length >= maxReferences) throw new Error('URL references exceed ' + maxReferences + ' entry limit');
    urls.push(invalidUrlReference(file + ':html', '<malformed-html>', finding));
  });
  for (const { name: attrName, value } of scanned.attributes) {
    let rawValue = value;
    try {
      rawValue = decodeHtmlAttributeEntities(rawValue);
    } catch (error) {
      if (urls.length >= maxReferences) throw new Error('URL references exceed ' + maxReferences + ' entry limit');
      urls.push(invalidUrlReference(file + ':html:' + attrName, rawValue, error.message));
      continue;
    }

    if (/[<>]/.test(rawValue)) {
      if (urls.length >= maxReferences) throw new Error('URL references exceed ' + maxReferences + ' entry limit');
      urls.push(invalidUrlReference(file + ':html:' + attrName, rawValue, 'attribute contains an invalid tag boundary'));
      continue;
    }

    if (attrName === 'srcset') {
      rawValue.split(',').forEach((candidate, index) => {
        const parts = candidate.trim().split(/\s+/);
        if (!parts[0] || parts.length > 2) {
          if (urls.length >= maxReferences) throw new Error('URL references exceed ' + maxReferences + ' entry limit');
          urls.push(invalidUrlReference(file + ':html:' + attrName + '[' + index + ']', candidate, 'malformed srcset candidate'));
          return;
        }
        addUrlReference(urls, parts[0], file + ':html:' + attrName + '[' + index + ']', maxReferences);
      });
    } else {
      addUrlReference(urls, rawValue, file + ':html:' + attrName, maxReferences);
    }
  }
  return urls;
}

function collectExternalUrls({
  rootDir = projectRoot,
  dataFiles = DATA_FILES,
  generatedHtmlFiles = GENERATED_HTML_FILES,
  openSync = fs.openSync
} = {}) {
  const urls = [];
  dataFiles.forEach((file) => {
    collectJsonUrls(JSON.parse(readBoundedSourceFile(rootDir, file, { openSync })), file, urls, {
      maxReferences: MAX_URL_REFERENCES
    });
  });
  generatedHtmlFiles.forEach((file) => {
    const remaining = MAX_URL_REFERENCES - urls.length;
    if (remaining <= 0) throw new Error(`URL references exceed ${MAX_URL_REFERENCES} entry limit`);
    urls.push(...collectHtmlUrls(file, { rootDir, maxReferences: remaining, openSync }));
  });

  const seen = new Map();
  return urls
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

function createPinnedLookup(records, expectedHostname = null) {
  return createNetworkPinnedLookup(records, expectedHostname);
}

function createTimeoutError(timeoutMs, phase) {
  const error = new Error(`${phase} timed out after ${timeoutMs}ms`);
  error.name = 'AbortError';
  return error;
}

async function withWallTimeout(operation, timeoutMs, phase) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      finish(reject, createTimeoutError(timeoutMs, phase));
    }, timeoutMs);
    Promise.resolve()
      .then(operation)
      .then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

async function requestWithTimeout(target, {
  method,
  timeoutMs,
  requestImpl = https.request
}) {
  const boundedTimeoutMs = parsePositiveBoundedInteger(timeoutMs, 'Link health timeout', MAX_TIMEOUT_MS);
  if (method !== 'HEAD' && method !== 'GET') {
    throw new Error('Link health request method must be HEAD or GET');
  }
  if (typeof requestImpl !== 'function') {
    throw new Error('Link health request implementation must be a function');
  }

  return await new Promise((resolve, reject) => {
    let request;
    let timer;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const onResponse = (response) => {
      const result = {
        status: response.statusCode || 0,
        statusText: response.statusMessage || ''
      };
      try {
        if (typeof response.destroy === 'function') response.destroy();
        else response.resume?.();
      } catch (error) {
        finish(reject, error);
        return;
      }
      finish(resolve, result);
    };

    try {
      request = requestImpl(target.url, {
        method,
        agent: false,
        lookup: createPinnedLookup(target.records, target.hostname),
        servername: net.isIP(target.hostname) ? undefined : target.hostname,
        headers: {
          'user-agent': 'ProjectPortfolio-link-health/1.0',
          connection: 'close',
          range: `bytes=0-${MAX_STATUS_RESPONSE_BYTES - 1}`
        }
      }, onResponse);
      if (!request || typeof request.once !== 'function' || typeof request.end !== 'function' || typeof request.destroy !== 'function') {
        throw new Error('Link health request implementation returned an invalid request');
      }
      request.once('error', (error) => finish(reject, error));
      timer = setTimeout(() => {
        const error = createTimeoutError(boundedTimeoutMs, 'Request');
        finish(reject, error);
        request.destroy(error);
      }, boundedTimeoutMs);
      request.end();
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function checkUrl(entry, options) {
  if (!entry.ok) return entry;

  try {
    const target = await withWallTimeout(
      () => resolvePublicHttpsUrl(entry.url, {
        fieldPath: entry.source,
        lookupImpl: options.lookupImpl
      }),
      options.timeoutMs,
      'DNS preflight'
    );
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
  const normalizedOptions = {
    ...options,
    preflightOnly: options.preflightOnly === true,
    strict: options.strict === true,
    timeoutMs: parsePositiveBoundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'Link health timeout', MAX_TIMEOUT_MS)
  };
  const entries = options.entries ?? collectExternalUrls({
    rootDir: options.rootDir ?? projectRoot,
    dataFiles: options.dataFiles ?? DATA_FILES,
    generatedHtmlFiles: options.generatedHtmlFiles ?? GENERATED_HTML_FILES,
    openSync: options.openSync ?? fs.openSync
  });
  if (!Array.isArray(entries)) {
    throw new Error('Link health entries must be an array');
  }
  const results = [];
  for (const entry of entries) {
    results.push(await checkUrl(entry, normalizedOptions));
  }
  return results;
}

function shouldFailLinkHealth(results, strict) {
  return strict === true && results.some((result) => !result.ok);
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
    if (shouldFailLinkHealth(results, options.strict)) {
      process.exitCode = 1;
    }
    process.exit(process.exitCode || 0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

export {
  DATA_FILES,
  GENERATED_HTML_FILES,
  MAX_TIMEOUT_MS,
  classifyUrlReference,
  collectExternalUrls,
  collectHtmlUrls,
  collectJsonUrls,
  createPinnedLookup,
  parseArgs,
  requestWithTimeout,
  runLinkHealth,
  shouldFailLinkHealth,
  validateExternalUrl
};
