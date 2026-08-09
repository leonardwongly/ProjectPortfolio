#!/usr/bin/env node

const DOMAIN = 'leonardwong.tech';
const DEFAULT_RESOLVERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve'
];
const EXPECTED_RECORDS = [
  `_index._agents.${DOMAIN}`,
  `_a2a._agents.${DOMAIN}`
];
const ALLOWED_RESOLVER_HOSTS = new Set(['cloudflare-dns.com', 'dns.google']);
const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 30000;

function normalizeResolverUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DNS-AID DoH resolver must be a valid HTTPS URL');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !ALLOWED_RESOLVER_HOSTS.has(hostname)
  ) {
    throw new Error('DNS-AID DoH resolver must use an allowed HTTPS resolver host');
  }

  return url.toString();
}

function resolverUrls(env = process.env) {
  const override = typeof env.DNS_AID_DOH_RESOLVER_URL === 'string'
    ? env.DNS_AID_DOH_RESOLVER_URL.trim()
    : '';
  const candidates = override ? [override] : DEFAULT_RESOLVERS;
  return candidates.map(normalizeResolverUrl);
}

function timeoutMs(env = process.env) {
  const raw = env.DNS_AID_TIMEOUT_MS;
  const value = raw === undefined || raw === ''
    ? DEFAULT_TIMEOUT_MS
    : Number(raw);
  return validateTimeout(value);
}

function validateTimeout(value) {
  if (!Number.isSafeInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new Error(`DNS-AID timeout must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds`);
  }
  return value;
}

function resolverLevelFailure(error) {
  return error instanceof TypeError || error?.name === 'AbortError' || error?.resolverLevel === true;
}

async function queryResolver(resolverUrl, name, type, {
  fetchImpl = fetch,
  timeout = timeoutMs()
} = {}) {
  validateTimeout(timeout);
  const url = new URL(normalizeResolverUrl(resolverUrl));
  url.searchParams.set('name', name);
  url.searchParams.set('type', type);
  // Ask both supported JSON resolvers to validate DNSSEC and expose AD.
  url.searchParams.set('do', '1');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/dns-json' },
      redirect: 'error',
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error(`DoH resolver returned HTTP ${response.status}`);
      error.resolverLevel = response.status >= 500;
      throw error;
    }
    const body = await response.json();
    if (!body || typeof body !== 'object') {
      throw new Error('DoH resolver returned a non-object response');
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function queryWithFallback(name, type, { fetchImpl = fetch, env = process.env } = {}) {
  let lastError;
  const resolvers = resolverUrls(env);
  const timeout = timeoutMs(env);
  for (const resolver of resolvers) {
    try {
      return { resolver, body: await queryResolver(resolver, name, type, { fetchImpl, timeout }) };
    } catch (error) {
      lastError = error;
      if (resolvers.length === 1 || !resolverLevelFailure(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

function answerData(body) {
  return (Array.isArray(body.Answer) ? body.Answer : [])
    .filter((answer) => answer && typeof answer.data === 'string')
    .map((answer) => answer.data);
}

function hasConnectionParameters(data) {
  return data.some((value) => /\balpn="?[^\s"]+"?/i.test(value) && /\bport=\d+/i.test(value));
}

async function checkRecord(name) {
  const results = [];
  for (const type of ['SVCB', 'HTTPS']) {
    const result = await queryWithFallback(name, type);
    results.push({ type, ...result });
  }

  const answers = results.flatMap(({ body }) => answerData(body));
  const authenticated = results.every(({ body }) => body.AD === true);
  if (!answers.length) {
    throw new Error(`${name} has no SVCB or HTTPS answer`);
  }
  if (!hasConnectionParameters(answers)) {
    throw new Error(`${name} answers do not include both alpn and port`);
  }
  if (!authenticated) {
    throw new Error(`${name} answers are not DNSSEC-authenticated (AD flag is false)`);
  }

  return {
    name,
    resolver: results[0].resolver,
    authenticated,
    answers
  };
}

async function main() {
  const checks = [];
  for (const name of EXPECTED_RECORDS) {
    checks.push(await checkRecord(name));
  }
  console.log(JSON.stringify({ status: 'pass', checks }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`DNS-AID check failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  DEFAULT_RESOLVERS,
  EXPECTED_RECORDS,
  answerData,
  checkRecord,
  hasConnectionParameters,
  normalizeResolverUrl,
  queryResolver,
  queryWithFallback,
  resolverUrls,
  timeoutMs
};
