import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareVersions,
  fetchRegistryVersion,
  listTrackedRegistryDependencies,
  parseArgs,
  parseSemver
} from '../../../scripts/check-vendor-upstream.mjs';

// --- parseArgs: adversarial timeout / attempts variants ---

test('parseArgs rejects zero, negative, NaN, and non-integer numeric timeout values', () => {
  assert.throws(() => parseArgs(['--timeout-ms', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--timeout-ms', '-1']), /Expected integer value after --timeout-ms/);
  assert.throws(() => parseArgs(['--timeout-ms', 'NaN']), /Expected integer value after --timeout-ms/);
  assert.throws(() => parseArgs(['--timeout-ms', '1e3']), /Expected integer value after --timeout-ms/);
});

test('parseArgs enforces timeout and attempt caps and rejects non-decimal numeric forms', () => {
  assert.deepEqual(parseArgs(['--timeout-ms', '60000', '--max-attempts', '5']), { timeoutMs: 60000, maxAttempts: 5 });
  for (const value of ['60001', '9007199254740991', '9007199254740992']) {
    assert.throws(() => parseArgs(['--timeout-ms', value]), { message: 'Timeout must not exceed 60000ms' });
  }
  for (const value of ['6', '9007199254740991']) {
    assert.throws(() => parseArgs(['--max-attempts', value]), { message: 'Max attempts must not exceed 5' });
  }
  // Decimal grammar is checked before range validation.
  assert.throws(() => parseArgs(['--timeout-ms', '0x10']), { message: 'Expected integer value after --timeout-ms' });
});

test('parseArgs treats missing flag values as errors instead of defaults', () => {
  assert.throws(() => parseArgs(['--timeout-ms']), /Expected integer value after --timeout-ms/);
  assert.throws(() => parseArgs(['--max-attempts']), /Expected integer value after --max-attempts/);
  assert.throws(() => parseArgs(['--timeout-ms', '500', '--max-attempts', '0']), /positive integer/);
});

// --- parseSemver: malformed inputs ---

test('parseSemver rejects empty, prefix-only, truncated, and double-dot versions', () => {
  for (const bad of ['', '   ']) {
    assert.throws(() => parseSemver(bad), { message: 'Invalid manifest at version: expected non-empty string' });
  }
  for (const bad of ['v', 'v1.2.3', '1.', '.1', '1..2', '1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03']) {
    assert.throws(
      () => parseSemver(bad),
      { message: 'Invalid manifest at version: expected valid SemVer' },
      `expected rejection for ${JSON.stringify(bad)}`
    );
  }
  assert.throws(() => parseSemver(' 1.2.3'), { message: 'Invalid manifest at version: surrounding whitespace is not allowed' });
});

test('parseSemver accepts valid build metadata without changing version precedence', () => {
  for (const suffix of ['build.1', '20130313144700', '001']) {
    const raw = `1.0.0+${suffix}`;
    const parsed = parseSemver(raw);
    assert.equal(parsed.raw, raw);
    assert.deepEqual(parsed.build, suffix.split('.'));
    assert.equal(parsed.precedence, '1.0.0');
    assert.equal(compareVersions(raw, '1.0.0'), 0);
    assert.equal(compareVersions('1.0.0', raw), 0);
  }
  for (const bad of ['1.0.0+', '1.0.0+build..1']) {
    assert.throws(() => parseSemver(bad), { message: 'Invalid manifest at version: expected valid SemVer' });
  }
});

test('parseSemver splits prerelease identifiers on dots', () => {
  const parsed = parseSemver('1.2.3-alpha.beta.7');
  assert.deepEqual(parsed.prerelease, ['alpha', 'beta', '7']);
  assert.equal(parseSemver('1.2.3').prerelease.length, 0);
});

test('parseSemver rejects prerelease payloads containing whitespace, empty identifiers, or numeric leading zeros', () => {
  for (const bad of ['1.2.3-alpha .beta', '1.2.3-', '1.2.3-alpha..beta', '1.2.3-alpha.01']) {
    assert.throws(() => parseSemver(bad), { message: 'Invalid manifest at version: expected valid SemVer' });
  }
});

// --- compareVersions ordering semantics (semver spec spot checks) ---

test('compareVersions orders prerelease below release and compares identifier-wise', () => {
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0') < 0, true);
  assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta') < 0, true);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0-alpha') > 0, true);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0-rc.1') === 0, true);
});

test('compareVersions treats structurally identical parsed objects as equal regardless of raw strings', () => {
  const left = { ...parseSemver('1.0.0'), raw: 'ignored' };
  const right = { ...parseSemver('1.0.0'), raw: 'different-label' };
  assert.equal(compareVersions(left, right), 0);
  assert.equal(compareVersions(right, left), 0);
});

test('compareVersions is transitive across representative triples', () => {
  const triples = [
    ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0'],
    ['0.9.9', '1.0.0-rc.2', '1.0.0'],
    ['2.3.0', '2.4.0-alpha', '2.4.1']
  ];
  for (const [a, b, c] of triples) {
    assert.equal(compareVersions(a, b) < 0, true);
    assert.equal(compareVersions(b, c) < 0, true);
    assert.equal(compareVersions(a, c) < 0, true);
    assert.equal(compareVersions(c, b) > 0, true);
    assert.equal(compareVersions(b, a) > 0, true);
    assert.equal(compareVersions(c, a) > 0, true);
  }
});

// --- listTrackedRegistryDependencies boundary shapes ---

test('listTrackedRegistryDependencies skips deps without registry_package even with missing or odd source fields', () => {
  const manifest = {
    dependencies: [
      { name: 'no-source-at-all', version: '1.0.0' },
      { name: 'cdn-source-only', source: 'https://cdn.example.com/lib/', version: '2.0.0' }
    ]
  };
  assert.deepEqual(listTrackedRegistryDependencies(manifest), []);
});

test('listTrackedRegistryDependencies tracks npm-backed dep regardless of non-npm source URL', () => {
  const tracked = listTrackedRegistryDependencies({
    dependencies: [
      {
        name: 'workbox',
        registry_package: 'workbox-sw',
        source: 'https://storage.googleapis.com/workbox-cdn/releases/7.4.1/',
        version: '7.4.1'
      }
    ]
  });
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].registryPackage, 'workbox-sw');
  assert.equal(tracked[0].version.raw, '7.4.1');
});

test('listTrackedRegistryDependencies rejects malformed dependency entries', () => {
  assert.throws(() => listTrackedRegistryDependencies({ dependencies: [null] }), /expected object/);
  assert.throws(
    () => listTrackedRegistryDependencies({ dependencies: [{ name: 'x', registry_package: 'pkg', version: 'not-semver' }] }),
    { message: 'Invalid manifest at manifest.dependencies[0].version: expected valid SemVer' }
  );
  assert.throws(() => listTrackedRegistryDependencies({}), /expected dependencies array/);
});

// --- fetchRegistryVersion npm metadata shapes ---

function okResponse(payload) {
  return new Response(JSON.stringify(payload), { status: 200 });
}

const baseOptions = () => ({
  timeoutMs: 1000,
  maxAttempts: 1,
  lookupImpl: async (hostname, options) => {
    assert.equal(hostname, 'registry.npmjs.org');
    assert.deepEqual(options, { all: true, verbatim: true });
    return [{ address: '93.184.216.34', family: 4 }];
  }
});

test('fetchRegistryVersion rejects when dist-tags.latest is a non-semver tag like "next"', async () => {
  await assert.rejects(
    () => fetchRegistryVersion('workbox-sw', {
      ...baseOptions(),
      fetchImpl: async () => okResponse({
        versions: {},
        'dist-tags': { latest: 'next' }
      })
    }),
    { message: 'Invalid manifest at npm.workbox-sw.dist-tags.latest: expected valid SemVer' }
  );
});

test('fetchRegistryVersion accepts prerelease-shaped dist-tags.latest even without a matching versions entry', async () => {
  // Note: 'not-real' is itself a valid dot-separated prerelease identifier,
  // so this malformed-looking tag still parses; only the versions map lookup
  // would catch divergence, which this checker intentionally does not do.
  const result = await fetchRegistryVersion('workbox-sw', {
    ...baseOptions(),
    fetchImpl: async () => okResponse({ versions: {}, 'dist-tags': { latest: '9.9.9-not-real' } })
  });
  assert.equal(result.latestVersion.raw, '9.9.9-not-real');
});

test('fetchRegistryVersion tolerates an empty versions map when dist-tags.latest parses', async () => {
  const result = await fetchRegistryVersion('workbox-sw', {
    ...baseOptions(),
    fetchImpl: async () => okResponse({ versions: {}, 'dist-tags': { latest: '7.5.0' } })
  });
  assert.equal(result.latestVersion.raw, '7.5.0');
});

test('fetchRegistryVersion fails clearly when dist-tags.latest is missing', async () => {
  await assert.rejects(
    () => fetchRegistryVersion('workbox-sw', {
      ...baseOptions(),
      fetchImpl: async () => okResponse({ versions: {} })
    }),
    { message: 'Invalid manifest at npm.workbox-sw.dist-tags.latest: expected non-empty string' }
  );
});

test('fetchRegistryVersion ignores anomalous time fields and reads only dist-tags.latest', async () => {
  const result = await fetchRegistryVersion('workbox-sw', {
    ...baseOptions(),
    fetchImpl: async () => okResponse({
      time: { created: 'not-a-date', modified: null, '7.6.0': '2020-01-01' },
      versions: { bogus: {} },
      'dist-tags': { latest: '7.6.0' }
    })
  });
  assert.equal(result.latestVersion.raw, '7.6.0');
});

// --- retry/backoff boundaries ---

test('fetchRegistryVersion stops retrying exactly at the configured attempt limit', async () => {
  let attempts = 0;
  const delays = [];
  await assert.rejects(
    () => fetchRegistryVersion('workbox-sw', {
      ...baseOptions(),
      maxAttempts: 3,
      sleepImpl: async (delayMs) => { delays.push(delayMs); },
      fetchImpl: async () => {
        attempts += 1;
        return new Response(`down ${attempts}`, { status: 503, statusText: 'Service Unavailable' });
      }
    }),
    { message: 'Failed to fetch npm metadata for workbox-sw: 503 Service Unavailable' }
  );
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [500, 1000], 'backoff must occur only between attempts');
});
