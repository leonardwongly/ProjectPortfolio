import {
  assertPublicHttpsUrl,
  canonicalHostname,
  normalizePublicHttpsUrl
} from './network-safety.mjs';

const ALLOWED_VENDOR_UPSTREAM_HOSTS = new Set([
  'storage.googleapis.com'
]);

const SEMVER_NUMERIC_IDENTIFIER = '(?:0|[1-9]\\d*)';
const SEMVER_NON_NUMERIC_IDENTIFIER = '(?:\\d*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER_PRERELEASE_IDENTIFIER = `(?:${SEMVER_NUMERIC_IDENTIFIER}|${SEMVER_NON_NUMERIC_IDENTIFIER})`;
const SEMVER_PATTERN = new RegExp(
  `^(${SEMVER_NUMERIC_IDENTIFIER})\\.(${SEMVER_NUMERIC_IDENTIFIER})\\.(${SEMVER_NUMERIC_IDENTIFIER})` +
  `(?:-(${SEMVER_PRERELEASE_IDENTIFIER}(?:\\.${SEMVER_PRERELEASE_IDENTIFIER})*))?` +
  '(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$'
);

function fail(message) {
  throw new Error(message);
}

function ensureNonEmptyString(value, fieldPath) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`Invalid manifest at ${fieldPath}: expected non-empty string`);
  }
  if (value !== value.trim()) {
    fail(`Invalid manifest at ${fieldPath}: surrounding whitespace is not allowed`);
  }
  return value;
}

function ensureRegistryPackageName(rawName, fieldPath) {
  const value = ensureNonEmptyString(rawName, fieldPath);
  if (
    value.length > 214 ||
    value === 'node_modules' ||
    value === 'favicon.ico' ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)
  ) {
    fail(`Invalid manifest at ${fieldPath}: unsupported npm package name`);
  }
  return value;
}

function parseSemver(rawVersion, fieldPath = 'version') {
  const value = ensureNonEmptyString(rawVersion, fieldPath);
  const match = value.match(SEMVER_PATTERN);
  if (!match) {
    fail(`Invalid manifest at ${fieldPath}: expected valid SemVer`);
  }

  const prerelease = match[4] ? match[4].split('.') : [];
  const build = match[5] ? match[5].split('.') : [];
  return {
    raw: value,
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease,
    build,
    precedence: `${match[1]}.${match[2]}.${match[3]}${prerelease.length > 0 ? `-${prerelease.join('.')}` : ''}`
  };
}

function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePrereleaseIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);

  if (leftNumeric && rightNumeric) return compareNumericIdentifiers(left, right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareSemver(leftRaw, rightRaw) {
  const left = typeof leftRaw === 'string' ? parseSemver(leftRaw, 'version.left') : leftRaw;
  const right = typeof rightRaw === 'string' ? parseSemver(rightRaw, 'version.right') : rightRaw;

  for (const key of ['major', 'minor', 'patch']) {
    const delta = compareNumericIdentifiers(left[key], right[key]);
    if (delta !== 0) return delta;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;

    const delta = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier);
    if (delta !== 0) return delta;
  }

  return 0;
}

function ensureVendorHttpsUrl(rawUrl, fieldPath) {
  return normalizePublicHttpsUrl(rawUrl, {
    fieldPath,
    allowedHosts: ALLOWED_VENDOR_UPSTREAM_HOSTS
  }).toString();
}

function ensureVendorUpstreamMatchesSource(upstreamUrl, sourceUrl, fieldPath) {
  const upstream = normalizePublicHttpsUrl(upstreamUrl, {
    fieldPath,
    allowedHosts: ALLOWED_VENDOR_UPSTREAM_HOSTS
  });
  const source = normalizePublicHttpsUrl(sourceUrl, {
    fieldPath: fieldPath.replace(/\.upstream_url$/, '.source'),
    allowedHosts: ALLOWED_VENDOR_UPSTREAM_HOSTS
  });

  if (source.search || source.hash) {
    throw new Error(`Invalid ${fieldPath.replace(/\.upstream_url$/, '.source')}: dependency source must not contain a query or fragment`);
  }

  if (upstream.origin !== source.origin || canonicalHostname(upstream.hostname) !== canonicalHostname(source.hostname)) {
    throw new Error(`Invalid ${fieldPath}: upstream host must match dependency source host`);
  }
  const sourceDirectory = source.pathname.endsWith('/') ? source.pathname : `${source.pathname}/`;
  if (!upstream.pathname.startsWith(sourceDirectory)) {
    throw new Error(`Invalid ${fieldPath}: upstream URL must stay under dependency source ${source.toString()}`);
  }

  return upstream.toString();
}

function ensureVendorSourceMatchesVersion(sourceUrl, rawVersion, fieldPath) {
  const source = normalizePublicHttpsUrl(sourceUrl, {
    fieldPath,
    allowedHosts: ALLOWED_VENDOR_UPSTREAM_HOSTS
  });
  if (source.search || source.hash) {
    fail(`Invalid ${fieldPath}: dependency source must not contain a query or fragment`);
  }
  const version = parseSemver(rawVersion, fieldPath.replace(/\.source$/, '.version'));

  let segments;
  try {
    segments = source.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    fail(`Invalid ${fieldPath}: source path contains malformed percent encoding`);
  }

  if (!segments.includes(version.raw) && !segments.includes(version.precedence)) {
    fail(`Invalid ${fieldPath}: source path must contain dependency version ${version.raw} as a complete segment`);
  }
  return source.toString();
}

async function assertPublicVendorUrl(rawUrl, fieldPath, options = {}) {
  return await assertPublicHttpsUrl(rawUrl, {
    ...options,
    fieldPath,
    allowedHosts: ALLOWED_VENDOR_UPSTREAM_HOSTS
  });
}

export {
  ALLOWED_VENDOR_UPSTREAM_HOSTS,
  assertPublicVendorUrl,
  compareSemver,
  ensureRegistryPackageName,
  ensureVendorHttpsUrl,
  ensureVendorSourceMatchesVersion,
  ensureVendorUpstreamMatchesSource,
  parseSemver
};
