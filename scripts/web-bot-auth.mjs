import { createHash, createPrivateKey, sign as signBytes } from 'node:crypto';

const DEFAULT_AGENT = 'https://leonardwong.tech';
const DEFAULT_KEY_ID = 'leonardwong.tech';
const DEFAULT_COMPONENTS = ['@method', '@target-uri', 'signature-agent'];
const DEFAULT_MAX_AGE_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 30;
const COMPONENT_PATTERN = /^(?:@[A-Za-z0-9-]+|[!#$%&'*+.^_`|~0-9A-Za-z-]+)$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const SUPPORTED_DERIVED_COMPONENTS = new Set(['@method', '@target-uri', '@authority']);

function quote(value) {
  const text = String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `"${text}"`;
}

function normalizeHeaders(headers = {}) {
  return new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()]));
}

function serializeSignatureParams(components, { created, expires, keyId, algorithm }) {
  const componentList = components.map(quote).join(' ');
  const expiry = Number.isSafeInteger(expires) ? `;expires=${expires}` : '';
  return `(${componentList});created=${created}${expiry};keyid=${quote(keyId)};alg=${quote(algorithm)}`;
}

function signatureBase({ method, url, headers, components, signatureParams }) {
  const values = components.map((component) => {
    if (component === '@method') return `"@method": ${method}`;
    if (component === '@target-uri') return `"@target-uri": ${url}`;
    if (component === '@authority') return `"@authority": ${new URL(url).host}`;
    if (component.startsWith('@')) {
      throw new Error(`Unsupported derived HTTP signature component: ${component}`);
    }
    return `"${component}": ${headers.get(component) ?? ''}`;
  });
  values.push(`"@signature-params": ${signatureParams}`);
  return values.join('\n');
}

function bodyBytes(body) {
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }
  return Buffer.from(body);
}

function validateTargetUrl(value) {
  if (typeof value !== 'string') {
    throw new Error('url must be an HTTPS URL');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('url must be an HTTPS URL');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new Error('url must be an HTTPS URL without credentials or fragments');
  }
  return parsed.toString();
}

function validateSafeValue(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0 || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a non-empty string without control characters`);
  }
  return value;
}

function validateComponents(components) {
  if (!Array.isArray(components) || components.length === 0 || components.some((component) => (
    typeof component !== 'string' ||
    !COMPONENT_PATTERN.test(component) ||
    component !== component.trim()
  ))) {
    throw new Error('components must be a non-empty list of valid HTTP signature components');
  }
  if (new Set(components).size !== components.length) {
    throw new Error('components must not contain duplicates');
  }
  const normalized = components.map((component) => component.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('components must not contain duplicates');
  }
  if (normalized.some((component) => component.startsWith('@') && !SUPPORTED_DERIVED_COMPONENTS.has(component))) {
    throw new Error('components must use only supported derived HTTP signature components');
  }
  return normalized;
}

function loadPrivateKey(privateJwk = process.env.WEB_BOT_AUTH_PRIVATE_JWK) {
  if (!privateJwk) {
    throw new Error('WEB_BOT_AUTH_PRIVATE_JWK is required to sign Web Bot Auth requests');
  }

  let jwk;
  try {
    jwk = typeof privateJwk === 'string' ? JSON.parse(privateJwk) : privateJwk;
  } catch {
    throw new Error('WEB_BOT_AUTH_PRIVATE_JWK must contain valid JSON');
  }

  if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.d !== 'string') {
    throw new Error('WEB_BOT_AUTH_PRIVATE_JWK must be an Ed25519 private JWK');
  }
  return createPrivateKey({ key: jwk, format: 'jwk' });
}

/**
 * Sign an outbound HTTP request using the Web Bot Auth HTTP Message Signature
 * profile. Keep the private JWK in a secret store or environment variable.
 */
export function signWebBotAuthRequest({
  url,
  method = 'GET',
  headers = {},
  body,
  privateJwk,
  agent = DEFAULT_AGENT,
  keyId = DEFAULT_KEY_ID,
  created = Math.floor(Date.now() / 1000),
  components = DEFAULT_COMPONENTS,
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS
} = {}) {
  const targetUrl = validateTargetUrl(url);
  validateSafeValue(agent, 'agent');
  validateSafeValue(keyId, 'keyId');
  validateSafeValue(method, 'method');
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(method)) {
    throw new Error('method must be a valid HTTP method token');
  }
  if (!Number.isSafeInteger(created) || created <= 0) {
    throw new Error('created must be a positive integer timestamp');
  }
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0 || maxAgeSeconds > DEFAULT_MAX_AGE_SECONDS) {
    throw new Error(`maxAgeSeconds must be an integer between 1 and ${DEFAULT_MAX_AGE_SECONDS}`);
  }
  const now = Math.floor(Date.now() / 1000);
  if (created < now - maxAgeSeconds || created > now + CLOCK_SKEW_SECONDS) {
    throw new Error('created timestamp is outside the allowed freshness window');
  }
  const expires = created + maxAgeSeconds;
  const signedComponents = validateComponents(components);

  const normalized = normalizeHeaders(headers);
  if (body !== undefined) {
    const digest = createHash('sha256').update(bodyBytes(body)).digest('base64');
    normalized.set('content-digest', `sha-256=:${digest}:`);
    if (!signedComponents.includes('content-digest')) {
      signedComponents.push('content-digest');
    }
  }
  const signatureAgent = quote(agent);
  normalized.set('signature-agent', signatureAgent);
  const algorithm = 'ed25519';
  const signatureParams = serializeSignatureParams(signedComponents, {
    created,
    expires,
    keyId,
    algorithm
  });
  const base = signatureBase({ method, url: targetUrl, headers: normalized, components: signedComponents, signatureParams });
  const signature = signBytes(null, Buffer.from(base, 'utf8'), loadPrivateKey(privateJwk)).toString('base64');
  const outputHeaders = Object.fromEntries(
    [...normalized].filter(([name]) => !['signature-agent', 'signature-input', 'signature'].includes(name))
  );

  return {
    ...outputHeaders,
    'Signature-Agent': signatureAgent,
    'Signature-Input': `sig1=${signatureParams}`,
    Signature: `sig1=:${signature}:`
  };
}

export { DEFAULT_AGENT, DEFAULT_KEY_ID, DEFAULT_COMPONENTS, serializeSignatureParams, signatureBase };
