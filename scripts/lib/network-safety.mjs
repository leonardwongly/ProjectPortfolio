import dns from 'node:dns/promises';
import net from 'node:net';

function fail(message) {
  throw new Error(message);
}

function canonicalHostname(hostname) {
  return hostname
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '');
}

function ipv4ToNumber(address) {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number.parseInt(part, 10);
    if (octet < 0 || octet > 255) return null;
    value = (value * 256) + octet;
  }
  return value >>> 0;
}

function ipv4Range(start, prefixLength) {
  return {
    start: ipv4ToNumber(start),
    mask: prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0
  };
}

const BLOCKED_IPV4_RANGES = [
  ipv4Range('0.0.0.0', 8),
  ipv4Range('10.0.0.0', 8),
  ipv4Range('100.64.0.0', 10),
  ipv4Range('127.0.0.0', 8),
  ipv4Range('169.254.0.0', 16),
  ipv4Range('172.16.0.0', 12),
  ipv4Range('192.0.0.0', 24),
  ipv4Range('192.0.2.0', 24),
  ipv4Range('192.168.0.0', 16),
  ipv4Range('198.18.0.0', 15),
  ipv4Range('198.51.100.0', 24),
  ipv4Range('203.0.113.0', 24),
  ipv4Range('224.0.0.0', 4),
  ipv4Range('240.0.0.0', 4)
];

function isBlockedIpv4Address(address) {
  const value = ipv4ToNumber(address);
  if (value === null) return false;
  return BLOCKED_IPV4_RANGES.some((range) => (value & range.mask) === (range.start & range.mask));
}

function expandIpv4Tail(address) {
  if (!address.includes('.')) return address;

  const lastColon = address.lastIndexOf(':');
  if (lastColon < 0) return address;

  const ipv4 = address.slice(lastColon + 1);
  const value = ipv4ToNumber(ipv4);
  if (value === null) return address;

  const high = ((value >>> 16) & 0xffff).toString(16);
  const low = (value & 0xffff).toString(16);
  return `${address.slice(0, lastColon)}:${high}:${low}`;
}

function parseIpv6Bytes(rawAddress) {
  const address = expandIpv4Tail(canonicalHostname(rawAddress));
  const parts = address.split('::');
  if (parts.length > 2) return null;

  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missingGroups = 8 - left.length - right.length;

  if ((parts.length === 1 && missingGroups !== 0) || missingGroups < 0) {
    return null;
  }

  const groups = [
    ...left,
    ...Array.from({ length: parts.length === 2 ? missingGroups : 0 }, () => '0'),
    ...right
  ];

  if (groups.length !== 8) return null;

  const bytes = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push((value >>> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function bytesAreAll(bytes, value) {
  return bytes.every((byte) => byte === value);
}

function bytesStartWith(bytes, prefix) {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function mappedIpv4FromIpv6Bytes(bytes) {
  const isMapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const isCompatible = bytes.slice(0, 12).every((byte) => byte === 0);
  const isNat64WellKnown = bytesStartWith(bytes, [0x00, 0x64, 0xff, 0x9b]) && bytes.slice(4, 12).every((byte) => byte === 0);

  if (!isMapped && !isCompatible && !isNat64WellKnown) return null;

  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}

function isBlockedIpv6Address(address) {
  const bytes = parseIpv6Bytes(address);
  if (!bytes) return false;

  const mappedIpv4 = mappedIpv4FromIpv6Bytes(bytes);
  if (mappedIpv4 && isBlockedIpv4Address(mappedIpv4)) return true;

  return (
    bytesAreAll(bytes, 0) ||
    (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) ||
    ((bytes[0] & 0xfe) === 0xfc) ||
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) ||
    bytes[0] === 0xff ||
    bytesStartWith(bytes, [0x20, 0x01, 0x0d, 0xb8]) ||
    bytesStartWith(bytes, [0x20, 0x01, 0x00, 0x00]) ||
    bytesStartWith(bytes, [0x01, 0x00]) ||
    bytesStartWith(bytes, [0x20, 0x02])
  );
}

function isBlockedIpAddress(address) {
  const canonical = canonicalHostname(address);
  const ipVersion = net.isIP(canonical);
  if (ipVersion === 4) return isBlockedIpv4Address(canonical);
  if (ipVersion === 6) return isBlockedIpv6Address(canonical);
  return false;
}

function isBlockedHostname(hostname) {
  const canonical = canonicalHostname(hostname);
  return canonical === 'localhost' || canonical.endsWith('.localhost');
}

function normalizePublicHttpsUrl(rawUrl, {
  fieldPath = 'URL',
  allowedHosts = null
} = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    fail(`Invalid ${fieldPath}: malformed URL`);
  }

  if (parsed.protocol !== 'https:') {
    fail(`Invalid ${fieldPath}: only https URLs are allowed`);
  }
  if (parsed.username || parsed.password) {
    fail(`Invalid ${fieldPath}: credentials in URL are not allowed`);
  }

  const hostname = canonicalHostname(parsed.hostname);
  if (isBlockedHostname(hostname)) {
    fail(`Invalid ${fieldPath}: local/private host is blocked`);
  }
  if (isBlockedIpAddress(hostname)) {
    fail(`Invalid ${fieldPath}: local/private IP address is blocked`);
  }

  if (allowedHosts) {
    const allowed = new Set([...allowedHosts].map(canonicalHostname));
    if (!allowed.has(hostname)) {
      fail(`Invalid ${fieldPath}: host ${hostname} is not in the allowed upstream host list`);
    }
  }

  return parsed;
}

async function resolveHostname(hostname, lookupImpl = dns.lookup) {
  const records = await lookupImpl(hostname, { all: true, verbatim: true });
  if (!Array.isArray(records) || records.length === 0) {
    fail(`DNS lookup for ${hostname} returned no addresses`);
  }
  return records;
}

async function assertPublicDnsResolution(parsedUrl, {
  fieldPath = 'URL',
  lookupImpl = dns.lookup
} = {}) {
  const hostname = canonicalHostname(parsedUrl.hostname);
  if (net.isIP(hostname)) return;

  const records = await resolveHostname(hostname, lookupImpl);
  const blockedRecord = records.find((record) => isBlockedIpAddress(record.address));
  if (blockedRecord) {
    fail(`Invalid ${fieldPath}: host ${hostname} resolved to blocked address ${blockedRecord.address}`);
  }

  return records;
}

async function assertPublicHttpsUrl(rawUrl, options = {}) {
  const parsed = normalizePublicHttpsUrl(rawUrl, options);
  await assertPublicDnsResolution(parsed, options);
  return parsed.toString();
}

async function resolvePublicHttpsUrl(rawUrl, options = {}) {
  const parsed = normalizePublicHttpsUrl(rawUrl, options);
  const hostname = canonicalHostname(parsed.hostname);
  const ipVersion = net.isIP(hostname);
  const records = ipVersion
    ? [{ address: hostname, family: ipVersion }]
    : await assertPublicDnsResolution(parsed, options);

  return {
    url: parsed.toString(),
    hostname,
    records
  };
}

export {
  assertPublicDnsResolution,
  assertPublicHttpsUrl,
  canonicalHostname,
  isBlockedHostname,
  isBlockedIpAddress,
  normalizePublicHttpsUrl,
  parseIpv6Bytes,
  resolvePublicHttpsUrl
};
