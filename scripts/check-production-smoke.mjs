import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import safeInput from './lib/safe-input.cjs';

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
// Build output is reviewed with the source. Additional provider hash sources
// must not silently authorize previously unapproved inline code.
const headerArtifact = safeInput.readStableFileNoFollow(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../_headers'),
  { label: 'reviewed header artifact', maxBytes: MAX_RESPONSE_BODY_BYTES, minBytes: 1 }
).toString('utf8');
const APPROVED_SCRIPT_HASHES = new Set(headerArtifact.match(/'sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}'/g) ?? []);

const REQUIRED_SECURITY_HEADERS = [
  'content-security-policy', 'strict-transport-security', 'x-content-type-options',
  'x-frame-options', 'referrer-policy', 'permissions-policy'
];
const PAGE_CHECKS = [
  { path: '/', marker: /Leonard Wong/i },
  { path: '/work', marker: /Project Archive/i },
  { path: '/case-study-agentforge', marker: /AgentForge Merge Guard/i },
  { path: '/case-study-agentic', marker: /Agentic/i },
  { path: '/case-study-apple-calendar-mcp', marker: /Apple Calendar/i },
  { path: '/reading', marker: /Reading/i },
  { path: '/offline', marker: /Offline/i },
  { path: '/.well-known/service-doc', marker: /Service Documentation/i }
].map((check) => ({ ...check, headers: REQUIRED_SECURITY_HEADERS }));
const REQUIRED_DISABLED_FEATURES = [
  'accelerometer', 'autoplay', 'camera', 'geolocation', 'gyroscope',
  'magnetometer', 'microphone', 'payment', 'usb', 'interest-cohort'
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

async function readBoundedResponseBody(response, maxBodyBytes, signal, onChunk = () => {}) {
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
        signal?.throwIfAborted();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBodyBytes) {
          await reader.cancel('response body limit exceeded').catch(() => {});
          throw new Error(`Response body exceeds ${maxBodyBytes} byte limit`);
        }
        onChunk(chunk);
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
      const error = new Error(`Request timed out after ${normalizedTimeoutMs}ms`);
      error.name = 'AbortError';
      controller.abort(error);
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
        if (controller.signal.aborted) {
          try {
            await response?.body?.cancel?.(controller.signal.reason);
          } catch {
            // Cleanup must not replace the deadline error.
          }
          controller.signal.throwIfAborted();
        }
        if (!response || typeof response.status !== 'number' || !response.headers) {
          throw new Error('Production smoke fetch returned an invalid response');
        }
        if (response.redirected || (response.status >= 300 && response.status < 400)) {
          throw new Error('Production smoke redirects are not allowed');
        }
        if (response.url && new URL(response.url).toString() !== new URL(url).toString()) {
          throw new Error('Production smoke response URL changed unexpectedly');
        }
        const chunks = [];
        const body = await readBoundedResponseBody(response, normalizedMaxBodyBytes, controller.signal,
          (chunk) => chunks.push(Buffer.from(chunk)));
        return { response, body, bytes: Buffer.concat(chunks) };
      })(),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// A header may carry several enforcing policies. They intersect in browsers;
// accept additional restrictive policies, but never let malformed or unsafe
// policy fragments hide behind one valid baseline.
function validateContentSecurityPolicy(value) {
  if (typeof value !== 'string' || !value.trim() || /[^\x20-\x7e\t]/.test(value)) {
    return 'content-security-policy is malformed';
  }
  const policies = value.split(',');
  if (policies.length > 16 || policies.some((policy) => !policy.trim())) {
    return 'content-security-policy contains an empty or excessive policy list';
  }
  const sourceRules = new Map([
    ['default-src', ["'self'", "'none'"]],
    ['style-src', ["'self'", "'none'"]],
    ['style-src-elem', ["'self'", "'none'"]],
    ['style-src-attr', ["'none'"]],
    ['img-src', ["'self'", 'data:', "'none'"]],
    ['font-src', ["'self'", "'none'"]],
    ['connect-src', ["'self'", "'none'"]],
    ['worker-src', ["'self'", "'none'"]],
    ['child-src', ["'self'", "'none'"]],
    ['manifest-src', ["'self'", "'none'"]],
    ['object-src', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'self'", "'none'"]],
    ['form-action', ["'self'", "'none'"]],
    ['script-src-attr', ["'none'"]]
  ]);
  const isScriptSource = (source) => {
    if (["'self'", "'none'"].includes(source)) return true;
    const match = /^'sha(256|384|512)-([A-Za-z0-9+/]+={0,2})'$/.exec(source);
    if (!match || !APPROVED_SCRIPT_HASHES.has(source)) return false;
    const digest = Buffer.from(match[2], 'base64');
    return digest.length === Number(match[1]) / 8 && digest.toString('base64') === match[2];
  };
  let hasBaseline = false;
  for (const policy of policies) {
    const directives = new Map();
    for (const rawDirective of policy.split(';')) {
      if (!rawDirective.trim()) continue;
      const [rawName, ...sources] = rawDirective.trim().split(/[ \t]+/);
      const name = rawName.toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(name) || directives.has(name)) {
        return 'content-security-policy contains an invalid or duplicate directive';
      }
      if (['upgrade-insecure-requests', 'block-all-mixed-content'].includes(name)) {
        if (sources.length) return `content-security-policy ${name} must not have a value`;
      } else {
        if (!sources.length || new Set(sources).size !== sources.length ||
            (sources.includes("'none'") && sources.length !== 1)) {
          return `content-security-policy ${name} has malformed sources`;
        }
        const approved = ['script-src', 'script-src-elem'].includes(name)
          ? sources.every(isScriptSource)
          : sourceRules.has(name) && sources.every((source) => sourceRules.get(name).includes(source));
        if (!approved) return `content-security-policy ${name} contains an unapproved source or directive`;
      }
      directives.set(name, sources);
    }
    // Required fetch directives may inherit the already restricted default-src.
    // Navigation and framing directives have no default-src fallback.
    if (['default-src', 'script-src', 'object-src', 'frame-src', 'base-uri',
      'form-action', 'frame-ancestors', 'upgrade-insecure-requests',
      'block-all-mixed-content'].every((name) => directives.has(name))) {
      hasBaseline = true;
    }
  }
  return hasBaseline ? null : 'content-security-policy is missing a complete enforcing baseline';
}

function validatePermissionsPolicy(value) {
  if (typeof value !== 'string' || !value.trim() || /[^\x20-\x7e\t]/.test(value)) {
    return 'permissions-policy is malformed';
  }
  const features = new Set();
  for (const directive of value.split(',')) {
    const match = /^([a-z][a-z0-9-]*)[ \t]*=[ \t]*\([ \t]*\)$/.exec(directive.trim());
    if (!match || features.has(match[1])) {
      return 'permissions-policy must contain unique disabled feature declarations';
    }
    features.add(match[1]);
  }
  return REQUIRED_DISABLED_FEATURES.every((feature) => features.has(feature))
    ? null : 'permissions-policy is missing a required disabled feature';
}

function validateStrictTransportSecurity(value) {
  if (typeof value !== 'string' || !value.trim() || /,|[^\x20-\x7e\t]/.test(value)) {
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
    if (!['max-age', 'includesubdomains', 'preload'].includes(match[1].toLowerCase())) {
      return 'strict-transport-security contains an unapproved directive';
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
  if (!directives.has('preload')) return 'strict-transport-security must include preload';
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
  }
  const hsts = response.headers.get('strict-transport-security');
  if (hsts) {
    const error = validateStrictTransportSecurity(hsts);
    if (error) findings.push(`${url}: ${error}`);
  }

  if (response.headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff') {
    findings.push(`${url}: x-content-type-options must be nosniff`);
  }

  if (response.headers.get('x-frame-options')?.trim().toUpperCase() !== 'DENY') {
    findings.push(`${url}: x-frame-options must be DENY`);
  }
  if (response.headers.get('referrer-policy')?.trim().toLowerCase() !== 'strict-origin-when-cross-origin') {
    findings.push(`${url}: referrer-policy must be strict-origin-when-cross-origin`);
  }
  const permissionsError = validatePermissionsPolicy(response.headers.get('permissions-policy'));
  if (permissionsError) findings.push(`${url}: ${permissionsError}`);

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
    bytes: result.bytes,
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
  if (useInjectedFetch && (typeof options.fetchImpl !== 'function' || typeof options.lookupImpl !== 'function')) {
    throw new Error('Injected production smoke transport requires explicit fetch and DNS implementations');
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
  APPROVED_SCRIPT_HASHES,
  MAX_ATTEMPTS,
  MAX_RESPONSE_BODY_BYTES,
  MAX_RETRY_DELAY_MS,
  MAX_TIMEOUT_MS,
  MIN_HSTS_MAX_AGE_SECONDS,
  PAGE_CHECKS,
  REQUIRED_SECURITY_HEADERS,
  REQUIRED_DISABLED_FEATURES,
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
  validatePermissionsPolicy,
  validatePage
};
