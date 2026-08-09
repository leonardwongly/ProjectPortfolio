import { pathToFileURL } from 'node:url';

const DEFAULT_ORIGIN = 'https://leonardwong.tech';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_ATTEMPTS = 6;
const DEFAULT_RETRY_DELAY_MS = 10000;

function canonicalizeOrigin(rawOrigin) {
  if (typeof rawOrigin !== 'string' || rawOrigin.trim() === '') {
    throw new Error('Production smoke origin is required');
  }

  let parsed;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    throw new Error('Production smoke origin must be a valid HTTPS origin');
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '' && parsed.pathname !== '/')
  ) {
    throw new Error('Production smoke origin must be an HTTPS origin without credentials, path, query, or fragment');
  }

  return parsed.origin;
}

function approvedOrigins() {
  const configured = process.env.SMOKE_ALLOWED_ORIGINS
    ? process.env.SMOKE_ALLOWED_ORIGINS.split(',').map((value) => canonicalizeOrigin(value.trim()))
    : [];
  return new Set([DEFAULT_ORIGIN, ...configured]);
}

function parsePositiveInteger(value, name) {
  const normalizedValue = String(value ?? '').trim();
  const parsed = Number(normalizedValue);
  if (!/^\d+$/.test(normalizedValue) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

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
    path: '/work.html',
    marker: /Project Archive/i,
    headers: [
      'content-security-policy',
      'x-content-type-options'
    ]
  },
  {
    path: '/case-study-agentforge.html',
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

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    origin: process.env.SITE_ORIGIN || DEFAULT_ORIGIN,
    timeoutMs: parsePositiveInteger(process.env.SMOKE_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 'Smoke timeout'),
    attempts: parsePositiveInteger(process.env.SMOKE_ATTEMPTS || `${DEFAULT_ATTEMPTS}`, 'Smoke attempts'),
    retryDelayMs: parsePositiveInteger(process.env.SMOKE_RETRY_DELAY_MS || `${DEFAULT_RETRY_DELAY_MS}`, 'Smoke retry delay')
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--origin') {
      options.origin = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = parsePositiveInteger(argv[index + 1], 'Smoke timeout');
      index += 1;
      continue;
    }
    if (arg === '--attempts') {
      options.attempts = parsePositiveInteger(argv[index + 1], 'Smoke attempts');
      index += 1;
      continue;
    }
    if (arg === '--retry-delay-ms') {
      options.retryDelayMs = parsePositiveInteger(argv[index + 1], 'Smoke retry delay');
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.origin = canonicalizeOrigin(options.origin);
  if (!approvedOrigins().has(options.origin)) {
    throw new Error(`Production smoke origin is not approved: ${options.origin}`);
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchTextWithTimeout(url, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'ProjectPortfolio-production-smoke/1.0'
      }
    });
    const body = await response.text();
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function validatePage({ url, response, body, check, approvedOrigin }) {
  const findings = [];

  const expectedOrigin = approvedOrigin || (response.url ? new URL(url).origin : undefined);
  if (expectedOrigin) {
    let finalOrigin;
    try {
      finalOrigin = new URL(response.url).origin;
    } catch {
      findings.push(`${url}: response did not provide a valid final URL`);
    }
    if (finalOrigin && finalOrigin !== expectedOrigin) {
      findings.push(`${url}: response redirected to unapproved origin ${finalOrigin}`);
    }
  }

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

async function runProductionSmoke(options = parseArgs()) {
  const normalizedOptions = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    attempts: DEFAULT_ATTEMPTS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    ...options,
    timeoutMs: parsePositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'Smoke timeout'),
    attempts: parsePositiveInteger(options.attempts ?? DEFAULT_ATTEMPTS, 'Smoke attempts'),
    retryDelayMs: parsePositiveInteger(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, 'Smoke retry delay'),
    origin: canonicalizeOrigin(options.origin)
  };
  if (!approvedOrigins().has(normalizedOptions.origin)) {
    throw new Error(`Production smoke origin is not approved: ${normalizedOptions.origin}`);
  }

  let lastFindings = [];

  for (let attempt = 1; attempt <= normalizedOptions.attempts; attempt += 1) {
    const findings = [];

    for (const check of PAGE_CHECKS) {
      const url = new URL(check.path, normalizedOptions.origin).toString();
      try {
        const result = await fetchTextWithTimeout(url, normalizedOptions);
        findings.push(...validatePage({
          url,
          check,
          approvedOrigin: normalizedOptions.origin,
          ...result
        }));
      } catch (error) {
        findings.push(`${url}: ${error?.message || 'request failed'}`);
      }
    }

    if (findings.length === 0) {
      return [];
    }

    lastFindings = findings;
    if (attempt < normalizedOptions.attempts) {
      await sleep(normalizedOptions.retryDelayMs);
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
  PAGE_CHECKS,
  parseArgs,
  runProductionSmoke,
  validatePage
};
