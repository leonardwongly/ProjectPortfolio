const DEFAULT_RESOURCE = 'https://leonardwong.tech';
const DEFAULT_AUTHORIZATION_SERVERS = Object.freeze([
  'https://leonardwongly.cloudflareaccess.com'
]);
const DEFAULT_SCOPES_SUPPORTED = Object.freeze(['openid']);
const ALLOWED_RESOURCE = new Set([DEFAULT_RESOURCE]);
const ALLOWED_AUTHORIZATION_SERVERS = new Set(DEFAULT_AUTHORIZATION_SERVERS);

const METADATA_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300, s-maxage=300',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff'
});

function parseHttpsUrl(value, fallback, allowedValues = null) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('OAuth metadata URL configuration is invalid');
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new Error('OAuth metadata URL must use HTTPS without credentials or fragments');
    }
    const normalized = url.toString().replace(/\/$/u, '');
    if (allowedValues && !allowedValues.has(normalized)) {
      throw new Error('OAuth metadata URL is not an approved production endpoint');
    }
    return normalized;
  } catch {
    throw new Error('OAuth metadata URL configuration is invalid');
  }
}

function parseHttpsUrlList(value, fallback, allowedValues = null) {
  if (value === undefined || value === null) {
    return [...fallback];
  }
  const candidates = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,]+/u).filter(Boolean)
      : [];
  if (candidates.length === 0) {
    throw new Error('OAuth authorization server configuration is invalid');
  }
  const urls = candidates.map((candidate) => parseHttpsUrl(candidate, null, allowedValues));
  return [...new Set(urls)];
}

function parseScopes(value, fallback = []) {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,]+/u)
      : [];
  const scopes = [...new Set(candidates
    .filter((scope) => typeof scope === 'string')
    .map((scope) => scope.trim())
    .filter((scope) => /^[A-Za-z0-9._:-]+$/u.test(scope)))];

  return scopes.length > 0 ? scopes : [...fallback];
}

function buildMetadata(env = {}) {
  const metadata = {
    resource: parseHttpsUrl(env.OAUTH_RESOURCE_URL, DEFAULT_RESOURCE, ALLOWED_RESOURCE),
    authorization_servers: parseHttpsUrlList(
      env.OAUTH_AUTHORIZATION_SERVERS,
      DEFAULT_AUTHORIZATION_SERVERS,
      ALLOWED_AUTHORIZATION_SERVERS
    ),
    bearer_methods_supported: ['header']
  };
  metadata.scopes_supported = parseScopes(env.OAUTH_SCOPES_SUPPORTED, DEFAULT_SCOPES_SUPPORTED);

  return metadata;
}

function methodNotAllowed() {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: {
      Allow: 'GET, HEAD',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function handleMetadataRequest({ request, env } = {}) {
  const method = request?.method?.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return methodNotAllowed();
  }

  let body;
  try {
    body = JSON.stringify(buildMetadata(env));
  } catch {
    return new Response(JSON.stringify({ error: 'OAuth metadata configuration is unavailable' }), {
      status: 503,
      headers: {
        ...METADATA_HEADERS,
        'Cache-Control': 'no-store'
      }
    });
  }
  return new Response(method === 'HEAD' ? null : body, {
    status: 200,
    headers: METADATA_HEADERS
  });
}

export function onRequest({ request, env }) {
  return handleMetadataRequest({ request, env });
}

export function onRequestGet({ request, env }) {
  return handleMetadataRequest({ request, env });
}

export function onRequestHead({ request, env }) {
  return handleMetadataRequest({ request, env });
}

export { buildMetadata, parseHttpsUrl, parseHttpsUrlList, parseScopes };
