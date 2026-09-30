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
const MIN_HSTS_MAX_AGE_SECONDS = 31536000;

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
      'strict-transport-security',
      'x-content-type-options'
    ]
  },
  {
    path: '/case-study-agentforge',
    marker: /AgentForge Merge Guard/i,
    headers: [
      'content-security-policy',
      'strict-transport-security',
      'x-content-type-options'
    ]
  },
  {
    path: '/reading',
    marker: /Reading/i,
    headers: [
      'content-security-policy',
      'strict-transport-security',
      'x-content-type-options'
    ]
  },
  {
    path: '/.well-known/service-doc',
    marker: /Service Documentation/i,
    headers: [
      'content-security-policy',
      'strict-transport-security',
      'x-content-type-options'
    ],
    noScripts: true
  },
  {
    path: '/offline',
    marker: /Offline/i,
    headers: [
      'content-security-policy',
      'strict-transport-security',
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

function validateContentSecurityPolicy(value) {
  if (typeof value !== 'string' || !value.trim() || /[,\u0000-\u001f\u007f]/.test(value)) {
    return 'content-security-policy is malformed or contains multiple policies';
  }

  const directives = new Map();
  for (const rawDirective of value.split(';')) {
    const directive = rawDirective.trim();
    if (!directive) continue;
    const [name, ...sources] = directive.split(/\s+/);
    const normalizedName = name.toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(normalizedName) || directives.has(normalizedName)) {
      return 'content-security-policy contains an invalid or duplicate directive';
    }
    if (sources.length === 0 && !['upgrade-insecure-requests', 'block-all-mixed-content'].includes(normalizedName)) {
      return `content-security-policy ${normalizedName} has no value`;
    }
    if (sources.length > 0 && ['upgrade-insecure-requests', 'block-all-mixed-content'].includes(normalizedName)) {
      return `content-security-policy ${normalizedName} must not have a value`;
    }
    directives.set(normalizedName, sources);
  }

  const isExactSource = (name, allowed) => {
    const sources = directives.get(name);
    return sources?.length === 1 && allowed.includes(sources[0].toLowerCase());
  };
  const hasOnlySources = (name, allowed) => {
    const sources = directives.get(name);
    return sources?.length > 0 && sources.every((source) => allowed.includes(source.toLowerCase()));
  };
  if (!isExactSource('default-src', ["'self'", "'none'"])) {
    return "content-security-policy default-src must be 'self' or 'none'";
  }

  const isRestrictedScriptSource = (source) => {
    if (source.toLowerCase() === "'self'") return true;
    const match = /^'sha(256|384|512)-([A-Za-z0-9+/]+={0,2})'$/.exec(source);
    if (!match) return false;
    const digest = Buffer.from(match[2], 'base64');
    return digest.length === Number(match[1]) / 8 && digest.toString('base64') === match[2];
  };
  for (const name of ['script-src', 'script-src-elem']) {
    const sources = directives.get(name);
    if (name === 'script-src-elem' && !sources) continue;
    if (isExactSource(name, ["'none'"])) continue;
    if (!sources?.some((source) => source.toLowerCase() === "'self'") ||
        !sources.every(isRestrictedScriptSource)) {
      return `content-security-policy ${name} must allow only 'self' and script hashes`;
    }
  }
  if (directives.has('script-src-attr') && !isExactSource('script-src-attr', ["'none'"])) {
    return "content-security-policy script-src-attr must be 'none'";
  }
  if (!isExactSource('object-src', ["'none'"]) || !isExactSource('frame-ancestors', ["'none'"])) {
    return "content-security-policy must block object embedding and framing with 'none'";
  }
  if (!isExactSource('base-uri', ["'self'", "'none'"]) ||
      !isExactSource('form-action', ["'self'", "'none'"])) {
    return "content-security-policy must restrict base-uri and form-action to 'self' or 'none'";
  }
  for (const [name, allowed] of [
    ['style-src', ["'self'"]],
    ['img-src', ["'self'", 'data:']],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'"]],
    ['worker-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['frame-src', ["'none'"]]
  ]) {
    if (directives.has(name) && !hasOnlySources(name, allowed)) {
      return `content-security-policy ${name} contains an unapproved source`;
    }
  }
  if (!directives.has('upgrade-insecure-requests')) {
    return 'content-security-policy must include upgrade-insecure-requests';
  }
  return null;
}

function validateStrictTransportSecurity(value) {
  if (typeof value !== 'string' || !value.trim() || /[,\u0000-\u001f\u007f]/.test(value)) {
    return 'strict-transport-security is malformed';
  }

  const directives = new Map();
  for (const rawDirective of value.split(';')) {
    const directive = rawDirective.trim();
    if (!directive) continue;
    const match = /^([a-z][a-z0-9-]*)(?:\s*=\s*(\S+))?$/i.exec(directive);
    if (!match || directives.has(match[1].toLowerCase())) {
      return 'strict-transport-security contains an invalid or duplicate directive';
    }
    directives.set(match[1].toLowerCase(), match[2]);
  }

  const maxAgeValue = directives.get('max-age');
  const maxAge = /^"(\d+)"$/.exec(maxAgeValue || '')?.[1] ?? maxAgeValue;
  if (!/^\d+$/.test(maxAge || '') ||
      !Number.isSafeInteger(Number(maxAge)) ||
      Number(maxAge) < MIN_HSTS_MAX_AGE_SECONDS) {
    return `strict-transport-security max-age must be at least ${MIN_HSTS_MAX_AGE_SECONDS}`;
  }
  if (!directives.has('includesubdomains') || directives.get('includesubdomains') !== undefined) {
    return 'strict-transport-security must include includeSubDomains';
  }
  if (directives.has('preload') && directives.get('preload') !== undefined) {
    return 'strict-transport-security preload must not have a value';
  }
  return null;
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

  const csp = response.headers.get('content-security-policy');
  if (csp) {
    const error = validateContentSecurityPolicy(csp);
    if (error) findings.push(`${url}: ${error}`);
    if (check.noScripts && (!/(?:^|;)\s*script-src\s+'none'\s*(?:;|$)/i.test(csp) ||
        /(?:^|;)\s*script-src-elem\s+(?!'none'\s*(?:;|$))/i.test(csp))) {
      findings.push(`${url}: service documentation must use script-src 'none'`);
    }
  }
  const hsts = response.headers.get('strict-transport-security');
  if (hsts) {
    const error = validateStrictTransportSecurity(hsts);
    if (error) findings.push(`${url}: ${error}`);
  }

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
  MIN_HSTS_MAX_AGE_SECONDS,
  PAGE_CHECKS,
  fetchTextWithTimeout,
  normalizeProductionOrigin,
  normalizeResponseHeaders,
  normalizeSmokeOptions,
  parseArgs,
  readBoundedResponseBody,
  requestProductionPage,
  runProductionSmoke,
  validateContentSecurityPolicy,
  validateStrictTransportSecurity,
  validatePage
};
