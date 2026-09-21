import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPublicDnsResolution,
  canonicalHostname,
  isBlockedHostname,
  isBlockedIpAddress,
  normalizePublicHttpsUrl,
  parseIpv6Bytes,
  resolvePublicHttpsUrl
} from '../../../scripts/lib/network-safety.mjs';

// ---------------------------------------------------------------------------
// Malformed / adversarial IPv4 forms
// ---------------------------------------------------------------------------

test('leading-zero IPv4 octets are unparseable directly but cannot smuggle loopback through URL normalization', () => {
  // net.isIP rejects ambiguous octets; URL normalization canonicalizes them
  // before applying the blocklist, while DNS record validation rejects them.
  assert.equal(isBlockedIpAddress('010.0.0.1'), false);
  assert.equal(isBlockedIpAddress('010.000.000.001'), false);
  assert.throws(() => normalizePublicHttpsUrl('https://0177.0.0.1/'), {
    message: 'Invalid URL: local/private IP address is blocked'
  });
});

test('out-of-range, non-digit, empty-octet, and five-part IPv4 are never classified as IPs', () => {
  for (const malformed of [
    '256.1.1.1',
    '1.2.3.999',
    '1a.2.3.4',
    '-1.2.3.4',
    '1..2.3',
    '.1.2.3',
    '1.2.3.',
    '1.2.3.4.5'
  ]) {
    assert.equal(
      isBlockedIpAddress(malformed),
      false,
      `expected ${JSON.stringify(malformed)} to be unparseable`
    );
  }
});

test('blocked-range boundaries for benchmark and link-local blocks hold exactly', () => {
  assert.equal(isBlockedIpAddress('198.19.255.255'), true);
  assert.equal(isBlockedIpAddress('198.20.0.1'), false);
  assert.equal(isBlockedIpAddress('172.31.255.255'), true);
  assert.equal(isBlockedIpAddress('172.32.0.1'), false);
  assert.equal(isBlockedIpAddress('169.254.0.0'), true);
  assert.equal(isBlockedIpAddress('169.253.255.255'), false);
});

test('reserved multicast / reserved-class-E addresses are blocked', () => {
  assert.equal(isBlockedIpAddress('224.0.0.5'), true);
  assert.equal(isBlockedIpAddress('240.1.2.3'), true);
  assert.equal(isBlockedIpAddress('0.255.255.255'), true);
});

// ---------------------------------------------------------------------------
// IPv6 adversarial forms
// ---------------------------------------------------------------------------

test('loopback ::1 parses and is blocked', () => {
  const bytes = parseIpv6Bytes('::1');
  assert.ok(Array.isArray(bytes));
  assert.equal(bytes.length, 16);
  assert.equal(bytes[15], 1);
  assert.equal(isBlockedIpAddress('::1'), true);
});

test('multiple double-colon compressions fail parsing', () => {
  assert.equal(parseIpv6Bytes(':::1'), null);
  assert.equal(parseIpv6Bytes('a::b::c'), null);
});

test('nine groups fail parsing', () => {
  assert.equal(parseIpv6Bytes('1:2:3:4:5:6:7:8:9'), null);
});

test('non-hex characters fail parsing', () => {
  assert.equal(parseIpv6Bytes('g::1'), null);
});

test('IPv4-mapped loopback via hex tail is blocked', () => {
  assert.equal(isBlockedIpAddress('::ffff:7f00:0001'), true);
  assert.equal(isBlockedIpAddress('::ffff:a00:1'), true);
});

test('NAT64 well-known prefix embedding a private IPv4 tail is blocked', () => {
  assert.equal(isBlockedIpAddress('64:ff9b::10.0.0.1'), true);
  assert.equal(isBlockedIpAddress('64:ff9b::127.0.0.1'), true);
});

test('6to4 prefix carrying an embedded loopback or TEST-NET-1 address is blocked', () => {
  assert.equal(isBlockedIpAddress('2002:7f00:0001::'), true);
  assert.equal(isBlockedIpAddress('2002:c000:201::'), true);
});

test('link-local, ULA, multicast, Teredo, documentation, and deprecated-2001 ranges are blocked', () => {
  assert.equal(isBlockedIpAddress('fe80::1'), true);
  assert.equal(isBlockedIpAddress('fc00::'), true);
  assert.equal(isBlockedIpAddress('ff02::1'), true);
  assert.equal(isBlockedIpAddress('2001:db8::dead:beef'), true);
  assert.equal(isBlockedIpAddress('2001::1'), true);
  assert.equal(isBlockedIpAddress('100::'), true);
  assert.equal(isBlockedIpAddress('::'), true);
});

test('zone IDs do not defeat link-local detection', () => {
  assert.equal(isBlockedIpAddress('fe80::1%eth0'), true);
  assert.equal(isBlockedIpAddress('fe80::1%1'), true);
  // Scoped literals refer to a local interface even with a public-looking prefix.
  assert.equal(isBlockedIpAddress('2606:4700:4700::1111%eth0'), true);
});

test('dot-hex embedded tails are rejected as unparseable rather than misclassified', () => {
  // Malformed mixed notation is not an IP; URL normalization rejects it rather
  // than interpreting it as a public mapped address.
  assert.equal(parseIpv6Bytes('::ffff:a00.0001'), null);
  assert.equal(isBlockedIpAddress('::ffff:a00.0001'), false);
  assert.throws(() => normalizePublicHttpsUrl('https://[::ffff:a00.0001]/'), {
    message: 'Invalid URL: malformed URL'
  });
});

// ---------------------------------------------------------------------------
// Hostname canonicalization tricks
// ---------------------------------------------------------------------------

test('canonicalization strips brackets, trailing dot, and lowercases', () => {
  assert.equal(canonicalHostname('[FE80::1]'), 'fe80::1');
  // Actual current behavior: '[FE80::1].' strips the leading bracket, then the
  // trailing-dot strip runs BEFORE any trailing ']' would be removed, so ']'
  // survives. This documents the ordering, not a security gap (WHATWG URL never
  // produces this shape).
  assert.equal(canonicalHostname('[FE80::1].'), 'fe80::1]');
  assert.equal(canonicalHostname('LOCALHOST.'), 'localhost');
  assert.equal(canonicalHostname('Example.COM.'), 'example.com');
});

test('localhost with extra trailing dot is still caught by the hostname blocklist', () => {
  // The caller removes one trailing dot; isBlockedHostname canonicalizes again.
  const canonical = canonicalHostname('localhost..');
  assert.equal(canonical, 'localhost.');
  assert.equal(isBlockedHostname(canonical), true);
});

test('double-dot localhost variant is caught by the hostname blocklist', () => {
  // Even an empty subdomain label still matches the .localhost suffix.
  assert.equal(isBlockedHostname('..localhost'), true);
});

test('bracket-stripping is asymmetric for unbalanced inputs', () => {
  // Documented intent: remove leading '[' and trailing ']'.
  assert.equal(canonicalHostname('[weird-host'), 'weird-host');
  assert.equal(canonicalHostname('weird-host]'), 'weird-host');
});

// ---------------------------------------------------------------------------
// normalizePublicHttpsUrl adversarial shapes
// ---------------------------------------------------------------------------

test('URL normalization rejects credentials even on otherwise-safe hosts', () => {
  assert.throws(
    () => normalizePublicHttpsUrl('https://user@example.com/'),
    /credentials in URL are not allowed/
  );
  assert.throws(
    () => normalizePublicHttpsUrl('https://user:pass@public.example/'),
    /credentials in URL are not allowed/
  );
});

test('allow-list matching is case-insensitive after canonicalization', () => {
  const parsed = normalizePublicHttpsUrl('https://EXAMPLE.com/', { allowedHosts: ['example.com'] });
  assert.equal(parsed.hostname, 'example.com');
});

test('trailing-dot public IP literal normalizes safely', () => {
  // WHATWG URL strips the trailing dot itself, yielding '8.8.8.8'.
  const parsed = normalizePublicHttpsUrl('https://8.8.8.8./x');
  assert.equal(parsed.hostname, '8.8.8.8');
});

test('malformed IPv4-like hostnames are rejected by WHATWG URL before network-safety sees them', () => {
  for (const bad of ['256.1.1.1', '1..2.3', '1.2.3.4.5']) {
    assert.throws(() => new URL(`https://${bad}/x`), Error, `expected ${bad} to be invalid`);
  }
});

test('WHATWG URL canonicalizes leading-zero IPv4 literals to their decimal equivalent', () => {
  const parsed = new URL('https://010.000.000.001/x');
  assert.equal(parsed.hostname, '8.0.0.1');
  // 8.0.0.0/8 is NOT in the blocked list, so this literal passes normalization.
  // This documents that the safety boundary relies on WHATWG URL rewriting
  // rather than on the module's own strict IPv4 parser.
  assert.doesNotThrow(() => normalizePublicHttpsUrl(parsed.href));
});

test('mapped-address literals are canonicalized by URL and blocked by IP check', () => {
  const parsed = new URL('https://[::ffff:10.0.0.1]/');
  assert.equal(parsed.hostname, '[::ffff:a00:1]');
  assert.equal(isBlockedIpAddress('::ffff:a00:1'), true);
});

test('link-local literal URLs are rejected by normalization', () => {
  assert.throws(
    () => normalizePublicHttpsUrl('https://[fe80::1]/'),
    /local\/private IP address is blocked/
  );
});

test('localhost../ is caught by the hostname blocklist during normalization', () => {
  // URL normalization and the hostname blocklist each remove one trailing dot.
  assert.throws(() => normalizePublicHttpsUrl('https://localhost../x'), {
    message: 'Invalid URL: local/private host is blocked'
  });
});

test('non-https schemes are rejected', () => {
  assert.throws(() => normalizePublicHttpsUrl('http://public.example/'), /only https URLs are allowed/);
  assert.throws(() => normalizePublicHttpsUrl('ftp://public.example/file.txt'), /only https URLs are allowed/);
});

// ---------------------------------------------------------------------------
// DNS answer array adversarial cases
// ---------------------------------------------------------------------------

const PUBLIC_HOST_PARSED = () => normalizePublicHttpsUrl('https://adversarial-dns.example/probe');

test('empty DNS answers are rejected before any fetch occurs', async () => {
  await assert.rejects(
    () => assertPublicDnsResolution(PUBLIC_HOST_PARSED(), { lookupImpl: async () => [] }),
    /returned no addresses/
  );
});

test('null and non-array DNS results are rejected', async () => {
  await assert.rejects(
    () => assertPublicDnsResolution(PUBLIC_HOST_PARSED(), { lookupImpl: async () => null }),
    /returned no addresses/
  );
  await assert.rejects(
    () => assertPublicDnsResolution(PUBLIC_HOST_PARSED(), { lookupImpl: async () => 'garbage' }),
    /returned no addresses/
  );
});

test('mixed public + private answers reject on the first blocked record', async () => {
  await assert.rejects(
    () => assertPublicDnsResolution(PUBLIC_HOST_PARSED(), {
      lookupImpl: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: 'fd00::1', family: 6 },
        { address: '2606:4700:4700::1111', family: 6 }
      ]
    }),
    /resolved to blocked address fd00::1/
  );
});

test('all-public answer arrays pass through unchanged', async () => {
  const records = await assertPublicDnsResolution(PUBLIC_HOST_PARSED(), {
    lookupImpl: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 }
    ]
  });
  assert.deepEqual(records, [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 }
  ]);
});

test('malformed DNS records and unparseable addresses are rejected before use', async () => {
  const cases = [
    [null, 'malformed record'],
    [[], 'malformed record'],
    ['93.184.216.34', 'malformed record'],
    [{}, 'invalid IP address'],
    [{ address: 'not-an-ip', family: 4 }, 'invalid IP address'],
    [{ address: '::ffff:a00.0001', family: 6 }, 'invalid IP address'],
    [{ address: '93.184.216.34', family: '4' }, 'invalid address family'],
    [{ address: '93.184.216.34', family: 6 }, 'address/family mismatch']
  ];
  for (const [record, reason] of cases) {
    await assert.rejects(
      () => assertPublicDnsResolution(PUBLIC_HOST_PARSED(), {
        lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }, record]
      }),
      { message: `DNS lookup for adversarial-dns.example returned ${reason} at index 1` }
    );
  }
});

test('DNS answers containing mapped loopback via hex notation are rejected', async () => {
  await assert.rejects(
    () => assertPublicDnsResolution(PUBLIC_HOST_PARSED(), {
      lookupImpl: async () => [{ address: '::ffff:a00:1', family: 6 }]
    }),
    /resolved to blocked address ::ffff:a00:1/
  );
});

test('DNS answers containing NAT64-encoded loopback are rejected', async () => {
  await assert.rejects(
    () => assertPublicDnsResolution(PUBLIC_HOST_PARSED(), {
      lookupImpl: async () => [{ address: '64:ff9b::127.0.0.1', family: 6 }]
    }),
    /resolved to blocked address 64:ff9b::127\.0\.0\.1/
  );
});

test('resolvePublicHttpsUrl pins the approved record set without querying DNS again', async () => {
  let calls = 0;
  const target = await resolvePublicHttpsUrl('https://pin-check.example/status', {
    lookupImpl: async () => {
      calls += 1;
      return [{ address: '93.184.216.34', family: 4 }];
    }
  });
  assert.equal(calls, 1);
  assert.equal(target.hostname, 'pin-check.example');
  assert.deepEqual(target.records, [{ address: '93.184.216.34', family: 4 }]);
});
