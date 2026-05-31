import {
  assertPublicHttpsUrl,
  canonicalHostname,
  normalizePublicHttpsUrl
} from './network-safety.mjs';

const ALLOWED_VENDOR_UPSTREAM_HOSTS = new Set([
  'storage.googleapis.com'
]);

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

  if (canonicalHostname(upstream.hostname) !== canonicalHostname(source.hostname)) {
    throw new Error(`Invalid ${fieldPath}: upstream host must match dependency source host`);
  }
  if (!upstream.toString().startsWith(source.toString())) {
    throw new Error(`Invalid ${fieldPath}: upstream URL must stay under dependency source ${source.toString()}`);
  }

  return upstream.toString();
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
  ensureVendorHttpsUrl,
  ensureVendorUpstreamMatchesSource
};
