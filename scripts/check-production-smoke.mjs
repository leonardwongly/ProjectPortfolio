import { pathToFileURL } from 'node:url';

import {
  assertPublicHttpsUrl,
  normalizePublicHttpsUrl,
  requestPinnedHttpsBytes
} from './lib/network-safety.mjs';

const DEFAULT_ORIGIN = 'https://leonardwong.tech';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_ATTEMPTS = 6;
const DEFAULT_RETRY_DELAY_MS = 10000;
const MAX_TIMEOUT_MS = 60000;
const MAX_ATTEMPTS = 10;
const MAX_RETRY_DELAY_MS = 60000;
const MAX_RESPONSE_BODY_BYTES = 1024 * 1024;

const PAGE_CHECKS = [
  {
    path: '/',
    marker: /Leonard Wong/i,
    headers: [
      'content-security-policy',
      'strict-transport-security',
      'x-content-type-options'
    ]
  },
  {
    path: '/work',
    marker: /Project Archive/i,
    headers: [
      'content-security-policy',
      'x-content-type-options'
    ]
  },
  {
    path: '/case-study-agentforge',
    marker: /AgentForge Merge Guard/i,
    headers: [
      'content-security-policy',
      'x-content-type-options'
    ]
  },
  {
    path: '/reading',
    marker: /Reading/i,
    headers: [
      'content-security-policy',
      'x-content-type-options'
    ]
  },
  {
    path: '/offline',
    marker: /Offline/i,
    headers: [
      'content-security-policy',
      'x-content-type-options'
    ]
  }
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

function normalizeProductionOrigin(rawOrigin) {
  if (typeof rawOrigin !== 'string' || !rawOrigin) {
    throw new Error('Production smoke origin must be an HTTPS public origin');
  }

  const parsed = normalizePublicHttpsUrl(rawOrigin, {
    fieldPath: 'production smoke origin'
  });
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Production smoke origin must not include a path, query, or fragment');
  }
  return parsed.origin;
}

function normalizeSmokeOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Production smoke options must be an object');
  }

  return {
    ...options,
    origin: normalizeProductionOrigin(options.origin),
    timeoutMs: parsePositiveBoundedInteger(options.timeoutMs, 'Production smoke timeout', MAX_TIMEOUT_MS),
    attempts: parsePositiveBoundedInteger(options.attempts, 'Production smoke attempts', MAX_ATTEMPTS),
    retryDelayMs: parsePositiveBoundedInteger(options.retryDelayMs, 'Production smoke retry delay', MAX_RETRY_DELAY_MS),
    maxBodyBytes: parsePositiveBoundedInteger(
      options.maxBodyBytes ?? MAX_RESPONSE_BODY_BYTES,
      'Production smoke response body limit',
      MAX_RESPONSE_BODY_BYTES
    )
  };
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    origin: env.SITE_ORIGIN ?? DEFAULT_ORIGIN,
    timeoutMs: env.SMOKE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
    attempts: env.SMOKE_ATTEMPTS ?? DEFAULT_ATTEMPTS,
    retryDelayMs: env.SMOKE_RETRY_DELAY_MS ?? DEFAULT_RETRY_DELAY_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--origin') {
      if (argv[index + 1] === undefined) throw new Error('Expected value after --origin');
      options.origin = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      if (argv[index + 1] === undefined) throw new Error('Expected value after --timeout-ms');
      options.timeoutMs = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--attempts') {
      if (argv[index + 1] === undefined) throw new Error('Expected value after --attempts');
      options.attempts = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--retry-delay-ms') {
      if (argv[index + 1] === undefined) throw new Error('Expected value after --retry-delay-ms');
      options.retryDelayMs = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const normalized = normalizeSmokeOptions(options);
  delete normalized.maxBodyBytes;
  return normalized;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readBoundedResponseBody(response, maxBodyBytes, signal) {
  const declaredLength = response.headers?.get?.('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBodyBytes) {
    throw new Error(`Response body exceeds ${maxBodyBytes} byte limit`);
  }

  if (response.body === null || response.body === undefined) return '';
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = '';
    let totalBytes = 0;
    let cancellationPromise;
    const cancelForAbort = () => {
      try {
        cancellationPromise = Promise.resolve(
          reader.cancel(signal?.reason ?? 'production smoke request aborted')
        ).catch(() => {});
      } catch {
        cancellationPromise = Promise.resolve();
      }
    };
    if (signal?.aborted) {
      cancelForAbort();
    } else {
      signal?.addEventListener('abort', cancelForAbort, { once: true });
    }
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBodyBytes) {
          await reader.cancel('response body limit exceeded').catch(() => {});
          throw new Error(`Response body exceeds ${maxBodyBytes} byte limit`);
        }
        body += decoder.decode(chunk, { stream: true });
      }
      body += decoder.decode();
      return body;
    } finally {
      signal?.removeEventListener('abort', cancelForAbort);
      if (cancellationPromise) await cancellationPromise;
      reader.releaseLock?.();
    }
  }

  throw new Error('Production smoke response does not expose a bounded readable body');
}

async function fetchTextWithTimeout(url, {
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBodyBytes = MAX_RESPONSE_BODY_BYTES
} = {}) {
  const normalizedTimeoutMs = parsePositiveBoundedInteger(timeoutMs, 'Production smoke timeout', MAX_TIMEOUT_MS);
  const normalizedMaxBodyBytes = parsePositiveBoundedInteger(
    maxBodyBytes,
    'Production smoke response body limit',
    MAX_RESPONSE_BODY_BYTES
  );
  if (typeof fetchImpl !== 'function') {
    throw new Error('Production smoke fetch implementation must be a function');
  }

  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error(`Request timed out after ${normalizedTimeoutMs}ms`);
      error.name = 'AbortError';
      reject(error);
    }, normalizedTimeoutMs);
  });

  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, {
          redirect: 'error',
          signal: controller.signal,
          headers: {
            'user-agent': 'ProjectPortfolio-production-smoke/1.0'
          }
        });
        if (!response || typeof response.status !== 'number' || !response.headers) {
          throw new Error('Production smoke fetch returned an invalid response');
        }
        if (response.redirected || (response.status >= 300 && response.status < 400)) {
          throw new Error('Production smoke redirects are not allowed');
        }
        if (response.url && new URL(response.url).toString() !== new URL(url).toString()) {
          throw new Error('Production smoke response URL changed unexpectedly');
        }
        const body = await readBoundedResponseBody(response, normalizedMaxBodyBytes, controller.signal);
        return { response, body };
      })(),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function validatePage({ url, response, body, check }) {
  const findings = [];

  if (response.status !== 200) {
    findings.push(`${url}: expected HTTP 200, received ${response.status}`);
  }

  check.headers.forEach((header) => {
    if (!response.headers.get(header)) {
      findings.push(`${url}: missing ${header} header`);
    }
  });

  if (response.headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff') {
    findings.push(`${url}: x-content-type-options must be nosniff`);
  }

  if (!check.marker.test(body)) {
    findings.push(`${url}: expected page marker was not found`);
  }

  return findings;
}

function normalizeResponseHeaders(headers) {
  if (typeof headers?.get === 'function') return headers;
  const normalized = new Headers();
  Object.entries(headers || {}).forEach(([name, rawValue]) => {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    values.forEach((value) => {
      if (value !== undefined) normalized.append(name, String(value));
    });
  });
  return normalized;
}

async function requestProductionPage(url, options, useInjectedFetch) {
  if (useInjectedFetch) {
    return await fetchTextWithTimeout(url, {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      maxBodyBytes: options.maxBodyBytes
    });
  }

  const result = await requestPinnedHttpsBytes(url, {
    fieldPath: 'production smoke page',
    lookupImpl: options.lookupImpl,
    requestImpl: options.requestImpl,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBodyBytes,
    method: 'GET',
    headers: {
      'user-agent': 'ProjectPortfolio-production-smoke/1.0'
    }
  });
  if (result.status >= 300 && result.status < 400) {
    throw new Error('Production smoke redirects are not allowed');
  }
  return {
    response: {
      status: result.status,
      headers: normalizeResponseHeaders(result.headers),
      redirected: false,
      url: result.url
    },
    body: result.bytes.toString('utf8')
  };
}

async function runProductionSmoke(inputOptions = parseArgs()) {
  const options = normalizeSmokeOptions(inputOptions);
  const sleepImpl = options.sleepImpl ?? sleep;
  const useInjectedFetch = Object.hasOwn(inputOptions, 'fetchImpl');
  if (typeof sleepImpl !== 'function') {
    throw new Error('Production smoke sleep implementation must be a function');
  }
  if (useInjectedFetch && typeof options.fetchImpl !== 'function') {
    throw new Error('Injected production smoke fetch implementation must be a function');
  }

  // The default transport resolves once per request and pins that approved address into each
  // HTTPS request. The injected Fetch path exists only for deterministic tests,
  // so it receives an explicit public-DNS preflight before any request.
  if (useInjectedFetch) {
    await assertPublicHttpsUrl(`${options.origin}/`, {
      fieldPath: 'production smoke origin',
      lookupImpl: options.lookupImpl
    });
  }

  let lastFindings = [];

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const findings = [];

    for (const check of PAGE_CHECKS) {
      const url = new URL(check.path, `${options.origin}/`).toString();
      try {
        const result = await requestProductionPage(url, options, useInjectedFetch);
        findings.push(...validatePage({ url, check, ...result }));
      } catch (error) {
        findings.push(`${url}: ${error?.message || 'request failed'}`);
      }
    }

    if (findings.length === 0) {
      return [];
    }

    lastFindings = findings;
    if (attempt < options.attempts) {
      await sleepImpl(options.retryDelayMs);
    }
  }

  return lastFindings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const findings = await runProductionSmoke();
    if (findings.length > 0) {
      console.error('Production smoke check failed:');
      findings.forEach((finding) => console.error(`- ${finding}`));
      process.exit(1);
    }
    console.log('Production smoke check passed.');
  } catch (error) {
    console.error(error?.message || 'Production smoke check failed.');
    process.exit(1);
  }
}

export {
  MAX_ATTEMPTS,
  MAX_RESPONSE_BODY_BYTES,
  MAX_RETRY_DELAY_MS,
  MAX_TIMEOUT_MS,
  PAGE_CHECKS,
  fetchTextWithTimeout,
  normalizeProductionOrigin,
  normalizeResponseHeaders,
  normalizeSmokeOptions,
  parseArgs,
  readBoundedResponseBody,
  requestProductionPage,
  runProductionSmoke,
  validatePage
};
