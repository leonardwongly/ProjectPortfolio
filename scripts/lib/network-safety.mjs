import dns from 'node:dns/promises';
import https from 'node:https';
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
  ipv4Range('192.88.99.0', 24),
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

function translatedIpv4FromIpv6Bytes(bytes) {
  const isMapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const isNat64WellKnown = bytesStartWith(bytes, [0x00, 0x64, 0xff, 0x9b]) && bytes.slice(4, 12).every((byte) => byte === 0);

  if (!isMapped && !isNat64WellKnown) return null;

  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}

function isBlockedIpv6Address(address) {
  const bytes = parseIpv6Bytes(address);
  if (!bytes) return false;

  const translatedIpv4 = translatedIpv4FromIpv6Bytes(bytes);
  if (translatedIpv4) return isBlockedIpv4Address(translatedIpv4);

  const isCurrentlyRoutableGlobalUnicast = (bytes[0] & 0xe0) === 0x20;
  if (!isCurrentlyRoutableGlobalUnicast) return true;

  return (
    bytesAreAll(bytes, 0) ||
    (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) ||
    ((bytes[0] & 0xfe) === 0xfc) ||
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) ||
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) ||
    bytes[0] === 0xff ||
    bytesStartWith(bytes, [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01]) ||
    bytesStartWith(bytes, [0x20, 0x01, 0x0d, 0xb8]) ||
    bytesStartWith(bytes, [0x20, 0x01, 0x00, 0x00]) ||
    bytesStartWith(bytes, [0x20, 0x01, 0x00, 0x02, 0x00, 0x00]) ||
    (bytesStartWith(bytes, [0x20, 0x01, 0x00]) && (bytes[3] & 0xf0) === 0x10) ||
    (bytesStartWith(bytes, [0x20, 0x01, 0x00]) && (bytes[3] & 0xf0) === 0x20) ||
    (bytesStartWith(bytes, [0x3f, 0xff]) && (bytes[2] & 0xf0) === 0x00) ||
    bytesStartWith(bytes, [0x5f, 0x00]) ||
    bytesStartWith(bytes, [0x01, 0x00]) ||
    bytesStartWith(bytes, [0x20, 0x02])
  );
}

function isBlockedIpAddress(address) {
  const canonical = canonicalHostname(address);
  const ipVersion = net.isIP(canonical);
  if (ipVersion === 4) return isBlockedIpv4Address(canonical);
  if (ipVersion === 6) {
    // Scoped IPv6 literals are meaningful only relative to a local interface.
    // They are never an acceptable public-upstream destination, and the zone
    // suffix is intentionally not fed into the unscoped IPv6 byte parser.
    if (canonical.includes('%')) return true;
    return isBlockedIpv6Address(canonical);
  }
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
  return validateDnsRecords(hostname, records);
}

function validateDnsRecords(hostname, records) {
  if (!Array.isArray(records) || records.length === 0) {
    fail(`DNS lookup for ${hostname} returned no addresses`);
  }

  return records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      fail(`DNS lookup for ${hostname} returned malformed record at index ${index}`);
    }

    const { address, family } = record;
    const detectedFamily = typeof address === 'string' ? net.isIP(address) : 0;
    if (detectedFamily === 0) {
      fail(`DNS lookup for ${hostname} returned invalid IP address at index ${index}`);
    }
    if (family !== 4 && family !== 6) {
      fail(`DNS lookup for ${hostname} returned invalid address family at index ${index}`);
    }
    if (detectedFamily !== family) {
      fail(`DNS lookup for ${hostname} returned address/family mismatch at index ${index}`);
    }

    return {
      address: canonicalHostname(address),
      family
    };
  });
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

function createPinnedLookup(records, expectedHostname = null) {
  const hostnameLabel = expectedHostname ? canonicalHostname(expectedHostname) : 'pinned host';
  const approved = validateDnsRecords(hostnameLabel, records);

  return (requestedHostname, rawOptions, rawCallback) => {
    const options = typeof rawOptions === 'function' ? {} : (rawOptions || {});
    const callback = typeof rawOptions === 'function' ? rawOptions : rawCallback;
    if (typeof callback !== 'function') {
      throw new TypeError('Pinned DNS lookup requires a callback');
    }

    const requestedCanonical = canonicalHostname(requestedHostname);
    if (expectedHostname && requestedCanonical !== hostnameLabel) {
      queueMicrotask(() => callback(new Error(
        `Pinned DNS lookup refused unexpected hostname ${requestedHostname}: hostname changed after validation`
      )));
      return;
    }

    const requestedFamily = typeof options === 'number' ? options : options.family;
    const matching = approved.filter((record) => !requestedFamily || record.family === requestedFamily);
    if (matching.length === 0) {
      queueMicrotask(() => callback(new Error(
        `No approved DNS address matches family ${requestedFamily}`
      )));
      return;
    }

    if (typeof options === 'object' && options.all) {
      queueMicrotask(() => callback(null, matching.map((record) => ({ ...record }))));
      return;
    }

    const [selected] = matching;
    queueMicrotask(() => callback(null, selected.address, selected.family));
  };
}

function parseResponseContentLength(headers, fieldPath) {
  const rawValue = typeof headers?.get === 'function'
    ? headers.get('content-length')
    : headers?.['content-length'];
  if (rawValue == null) return null;

  const value = Array.isArray(rawValue) ? rawValue.join(',') : String(rawValue);
  if (!/^\d+$/.test(value)) {
    fail(`Invalid ${fieldPath}: malformed Content-Length header`);
  }
  return BigInt(value);
}

async function readBoundedFetchBody(response, {
  controller,
  fieldPath,
  maxBytes,
  registerCancel,
  url
}) {
  const declaredLength = parseResponseContentLength(response.headers, fieldPath);
  if (declaredLength !== null && declaredLength > BigInt(maxBytes)) {
    controller.abort();
    fail(`Response from ${url} exceeds ${maxBytes} byte limit`);
  }

  if (!response.body) return Buffer.alloc(0);
  if (typeof response.body.getReader !== 'function') {
    fail(`Response from ${url} does not expose a bounded readable body`);
  }

  const reader = response.body.getReader();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
  const cancel = (reason) => {
    const cancellation = reader.cancel(reason).catch(() => {});
    release();
    return cancellation;
  };
  registerCancel(cancel);
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = Buffer.from(value);
      totalBytes += bytes.length;
      if (totalBytes > maxBytes) {
        controller.abort();
        await cancel();
        fail(`Response from ${url} exceeds ${maxBytes} byte limit`);
      }
      chunks.push(bytes);
    }
  } finally {
    registerCancel(null);
    release();
  }

  return Buffer.concat(chunks, totalBytes);
}

async function fetchInjectedHttpsBytes(rawUrl, {
  fieldPath = 'URL',
  allowedHosts = null,
  lookupImpl = null,
  fetchImpl,
  timeoutMs = 15000,
  maxBytes = 1024 * 1024,
  method = 'GET',
  headers = {}
} = {}) {
  if (typeof fetchImpl !== 'function') {
    fail('Injected HTTPS transport requires fetchImpl');
  }
  if (typeof lookupImpl !== 'function') {
    fail('Injected HTTPS transport requires lookupImpl for DNS validation');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    fail('Network timeout must be a positive safe integer');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    fail('Network response byte limit must be a positive safe integer');
  }

  const controller = new AbortController();
  let cancelBody = null;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Timed out fetching ${rawUrl} after ${timeoutMs}ms`);
      error.name = 'AbortError';
      controller.abort(error);
      cancelBody?.(error);
      reject(error);
    }, timeoutMs);
  });

  const operation = (async () => {
    const target = await resolvePublicHttpsUrl(rawUrl, { fieldPath, allowedHosts, lookupImpl });
    let response;
    try {
      response = await fetchImpl(target.url, {
        method,
        redirect: 'error',
        signal: controller.signal,
        headers
      });
    } catch (error) {
      const transportError = new Error(error?.message || 'unknown injected transport error', { cause: error });
      transportError.name = error?.name || 'Error';
      transportError.code = error?.code;
      transportError.networkTransportError = true;
      throw transportError;
    }
    const bytes = await readBoundedFetchBody(response, {
      controller,
      fieldPath,
      maxBytes,
      registerCancel: (cancel) => {
        cancelBody = cancel;
      },
      url: target.url
    });
    return {
      url: target.url,
      hostname: target.hostname,
      records: target.records,
      status: response.status || 0,
      statusText: response.statusText || '',
      headers: response.headers,
      ok: response.ok,
      bytes
    };
  })();

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function requestPinnedHttpsBytes(rawUrl, {
  fieldPath = 'URL',
  allowedHosts = null,
  lookupImpl = dns.lookup,
  requestImpl = https.request,
  timeoutMs = 15000,
  maxBytes = 1024 * 1024,
  method = 'GET',
  headers = {}
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    fail('Network timeout must be a positive safe integer');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    fail('Network response byte limit must be a positive safe integer');
  }

  return await new Promise((resolve, reject) => {
    let request = null;
    let response = null;
    let settled = false;

    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      const error = new Error(`Timed out fetching ${rawUrl} after ${timeoutMs}ms`);
      error.name = 'AbortError';
      settle(error);
      response?.destroy?.(error);
      request?.destroy?.(error);
    }, timeoutMs);

    Promise.resolve()
      .then(() => resolvePublicHttpsUrl(rawUrl, {
        fieldPath,
        allowedHosts,
        lookupImpl
      }))
      .then((target) => {
        if (settled) return;

        const parsed = new URL(target.url);
        const pinnedLookup = createPinnedLookup(target.records, target.hostname);
        try {
          request = requestImpl(parsed, {
            agent: false,
            method,
            lookup: pinnedLookup,
            servername: net.isIP(target.hostname) ? undefined : target.hostname,
            headers: {
              ...headers,
              connection: 'close'
            }
          }, (incoming) => {
            if (settled) {
              incoming.destroy?.();
              return;
            }

            response = incoming;
            let declaredLength;
            try {
              declaredLength = parseResponseContentLength(incoming.headers, fieldPath);
              if (declaredLength !== null && declaredLength > BigInt(maxBytes)) {
                fail(`Response from ${target.url} exceeds ${maxBytes} byte limit`);
              }
            } catch (error) {
              settle(error);
              incoming.destroy?.();
              request?.destroy?.();
              return;
            }

            const chunks = [];
            let totalBytes = 0;
            incoming.on('data', (chunk) => {
              if (settled) return;
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              totalBytes += bytes.length;
              if (totalBytes > maxBytes) {
                const error = new Error(`Response from ${target.url} exceeds ${maxBytes} byte limit`);
                settle(error);
                incoming.destroy?.(error);
                request?.destroy?.(error);
                return;
              }
              chunks.push(bytes);
            });
            incoming.once('aborted', () => {
              settle(new Error(`Response from ${target.url} was aborted before completion`));
            });
            incoming.once('error', (error) => settle(error));
            incoming.once('end', () => {
              settle(null, {
                url: target.url,
                hostname: target.hostname,
                records: target.records,
                status: incoming.statusCode || 0,
                statusText: incoming.statusMessage || '',
                headers: incoming.headers || {},
                bytes: Buffer.concat(chunks, totalBytes)
              });
            });
          });
        } catch (error) {
          settle(error);
          return;
        }

        request.once('error', (error) => settle(error));
        request.end();
      })
      .catch((error) => settle(error));
  });
}

export {
  assertPublicDnsResolution,
  assertPublicHttpsUrl,
  canonicalHostname,
  createPinnedLookup,
  fetchInjectedHttpsBytes,
  isBlockedHostname,
  isBlockedIpAddress,
  normalizePublicHttpsUrl,
  parseIpv6Bytes,
  requestPinnedHttpsBytes,
  validateDnsRecords,
  resolvePublicHttpsUrl
};
