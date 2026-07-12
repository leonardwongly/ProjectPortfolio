import { pathToFileURL } from 'node:url';

const DEFAULT_ORIGIN = 'https://leonardwong.tech';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_ATTEMPTS = 6;
const DEFAULT_RETRY_DELAY_MS = 10000;

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
    timeoutMs: Number.parseInt(process.env.SMOKE_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10),
    attempts: Number.parseInt(process.env.SMOKE_ATTEMPTS || `${DEFAULT_ATTEMPTS}`, 10),
    retryDelayMs: Number.parseInt(process.env.SMOKE_RETRY_DELAY_MS || `${DEFAULT_RETRY_DELAY_MS}`, 10)
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--origin') {
      options.origin = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }
    if (arg === '--attempts') {
      options.attempts = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }
    if (arg === '--retry-delay-ms') {
      options.retryDelayMs = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.origin.startsWith('https://')) {
    throw new Error('Production smoke origin must be an HTTPS URL');
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

async function runProductionSmoke(options = parseArgs()) {
  let lastFindings = [];

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const findings = [];

    for (const check of PAGE_CHECKS) {
      const url = new URL(check.path, options.origin).toString();
      try {
        const result = await fetchTextWithTimeout(url, options);
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
      await sleep(options.retryDelayMs);
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
