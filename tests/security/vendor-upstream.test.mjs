import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkVendorUpstreamVersions,
  compareVersions,
  ensureRegistryPackageName,
  fetchRegistryVersion,
  formatSummary,
  listTrackedRegistryDependencies,
  parseArgs,
  parseSemver
} from '../../scripts/check-vendor-upstream.mjs';

const PUBLIC_REGISTRY_RECORD = { address: '104.16.30.34', family: 4 };

async function publicRegistryLookup() {
  return [PUBLIC_REGISTRY_RECORD];
}

function makeManifest(version = '5.1.2') {
  return {
    dependencies: [
      {
        name: 'workbox',
        registry_package: 'workbox-sw',
        version
      }
    ]
  };
}

test('ensureRegistryPackageName rejects malformed npm package names', () => {
  assert.equal(ensureRegistryPackageName('workbox-sw', 'dependency.registry_package'), 'workbox-sw');
  assert.equal(ensureRegistryPackageName('@scope/pkg', 'dependency.registry_package'), '@scope/pkg');
  assert.throws(
    () => ensureRegistryPackageName('workbox sw', 'dependency.registry_package'),
    /unsupported npm package name/
  );
  for (const malformed of [
    '@scope',
    '@/pkg',
    'scope/pkg',
    '@scope/pkg/extra',
    'Workbox',
    '.hidden',
    ' workbox-sw',
    'node_modules',
    'favicon.ico'
  ]) {
    assert.throws(
      () => ensureRegistryPackageName(malformed, 'dependency.registry_package'),
      /unsupported npm package name|surrounding whitespace/
    );
  }
});

test('parseArgs validates timeout flag', () => {
  assert.deepEqual(parseArgs([]), { timeoutMs: 15000, maxAttempts: 3 });
  assert.deepEqual(parseArgs(['--timeout-ms', '2500', '--max-attempts', '4']), { timeoutMs: 2500, maxAttempts: 4 });
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
  assert.throws(() => parseArgs(['--timeout-ms', '60001']), /must not exceed 60000ms/);
  assert.throws(() => parseArgs(['--max-attempts', '6']), /must not exceed 5/);
});

test('SemVer validation and precedence cover malformed, build, and huge identifiers', () => {
  assert.equal(parseSemver('5.1.2').raw, '5.1.2');
  assert.equal(compareVersions('5.1.3', '5.1.2') > 0, true);
  assert.equal(compareVersions('5.1.2', '5.1.2'), 0);
  assert.equal(compareVersions('5.1.2', '5.1.2-beta.1') > 0, true);
  assert.equal(compareVersions('5.1.2-beta.2', '5.1.2-beta.1') > 0, true);
  assert.equal(compareVersions('5.1.2+build.2', '5.1.2+build.1'), 0);
  assert.equal(
    compareVersions(
      '5.1.2-beta.999999999999999999999999',
      '5.1.2-beta.1000000000000000000000000'
    ) < 0,
    true
  );
  for (const malformed of [
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-01',
    '1.2.3-',
    '1.2.3-alpha..1',
    '1.2.3+',
    '1.2.3+build..1',
    ' 1.2.3'
  ]) {
    assert.throws(() => parseSemver(malformed), /expected valid SemVer|surrounding whitespace/);
  }
});

test('listTrackedRegistryDependencies returns registry-backed dependencies', () => {
  const tracked = listTrackedRegistryDependencies(makeManifest());

  assert.deepEqual(tracked, [
    {
      dependencyIndex: 0,
      name: 'workbox',
      version: {
        raw: '5.1.2',
        major: '5',
        minor: '1',
        patch: '2',
        prerelease: [],
        build: [],
        precedence: '5.1.2'
      },
      registryPackage: 'workbox-sw'
    }
  ]);
});

test('fetchRegistryVersion reads latest version from npm metadata', async () => {
  const result = await fetchRegistryVersion('workbox-sw', {
    fetchImpl: async () => new Response(JSON.stringify({
      'dist-tags': {
        latest: '7.3.0'
      }
    }), { status: 200 }),
    lookupImpl: publicRegistryLookup,
    timeoutMs: 5000,
    maxAttempts: 1
  });

  assert.equal(result.packageName, 'workbox-sw');
  assert.equal(result.latestVersion.raw, '7.3.0');
});

test('fetchRegistryVersion bounds injected metadata bytes', async () => {
  await assert.rejects(
    () => fetchRegistryVersion('workbox-sw', {
      fetchImpl: async () => new Response(JSON.stringify({
        'dist-tags': { latest: '7.3.0' },
        padding: 'x'.repeat(128)
      }), { status: 200 }),
      lookupImpl: publicRegistryLookup,
      timeoutMs: 5000,
      maxAttempts: 1,
      maxBytes: 64
    }),
    /exceeds 64 byte limit/
  );
});

test('fetchRegistryVersion rejects malformed registry JSON', async () => {
  await assert.rejects(
    () => fetchRegistryVersion('workbox-sw', {
      fetchImpl: async () => new Response('{not-json', { status: 200 }),
      lookupImpl: publicRegistryLookup,
      timeoutMs: 5000,
      maxAttempts: 1
    }),
    /expected valid UTF-8 JSON/
  );
});

test('fetchRegistryVersion wires the default path to the pinned byte transport', async () => {
  let transportCall;
  const result = await fetchRegistryVersion('workbox-sw', {
    lookupImpl: publicRegistryLookup,
    requestBytesImpl: async (url, options) => {
      transportCall = { url, options };
      return {
        status: 200,
        statusText: 'OK',
        bytes: Buffer.from(JSON.stringify({ 'dist-tags': { latest: '7.4.1' } }))
      };
    },
    timeoutMs: 1000,
    maxAttempts: 1
  });

  assert.equal(transportCall.url, 'https://registry.npmjs.org/workbox-sw');
  assert.equal(transportCall.options.lookupImpl, publicRegistryLookup);
  assert.equal(transportCall.options.maxBytes, 2 * 1024 * 1024);
  assert.equal(result.latestVersion.raw, '7.4.1');
});

test('fetchRegistryVersion retries transient npm errors before succeeding', async () => {
  let attempts = 0;
  const result = await fetchRegistryVersion('workbox-sw', {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response('temporary failure', { status: 503, statusText: 'Service Unavailable' });
      }
      return new Response(JSON.stringify({
        'dist-tags': {
          latest: '7.4.0'
        }
      }), { status: 200 });
    },
    lookupImpl: publicRegistryLookup,
    timeoutMs: 5000,
    maxAttempts: 2,
    sleepImpl: async () => {}
  });

  assert.equal(attempts, 2);
  assert.equal(result.latestVersion.raw, '7.4.0');
});

test('fetchRegistryVersion retries injected transport failures before succeeding', async () => {
  let attempts = 0;
  const result = await fetchRegistryVersion('workbox-sw', {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('socket closed');
      return new Response(JSON.stringify({
        'dist-tags': { latest: '7.4.0' }
      }), { status: 200 });
    },
    lookupImpl: publicRegistryLookup,
    timeoutMs: 5000,
    maxAttempts: 2,
    sleepImpl: async () => {}
  });

  assert.equal(attempts, 2);
  assert.equal(result.latestVersion.raw, '7.4.0');
});

test('fetchRegistryVersion does not retry non-retryable npm responses', async () => {
  let attempts = 0;

  await assert.rejects(
    () => fetchRegistryVersion('workbox-sw', {
      fetchImpl: async () => {
        attempts += 1;
        return new Response('not found', { status: 404, statusText: 'Not Found' });
      },
      lookupImpl: publicRegistryLookup,
      timeoutMs: 5000,
      maxAttempts: 3
    }),
    /404 Not Found/
  );

  assert.equal(attempts, 1);
});

test('checkVendorUpstreamVersions reports stale dependencies', async () => {
  const manifest = makeManifest('5.1.2');
  let manifestRead;
  const results = await checkVendorUpstreamVersions(
    { timeoutMs: 5000, maxAttempts: 1 },
    {
      manifestPath: '/unused/in-test.json',
      fetchImpl: async () => new Response(JSON.stringify({
        'dist-tags': {
          latest: '5.2.0'
        }
      }), { status: 200 }),
      lookupImpl: publicRegistryLookup,
      rootDir: '/trusted/test-root',
      loadManifest: (manifestPath, options) => {
        manifestRead = { manifestPath, options };
        return manifest;
      }
    }
  );

  assert.equal(results.length, 1);
  assert.deepEqual(manifestRead, {
    manifestPath: '/unused/in-test.json',
    options: { rootDir: '/trusted/test-root' }
  });
  assert.deepEqual(results[0], {
    name: 'workbox',
    registryPackage: 'workbox-sw',
    currentVersion: '5.1.2',
    latestVersion: '5.2.0',
    registryUrl: 'https://registry.npmjs.org/workbox-sw',
    updateAvailable: true
  });
});

test('formatSummary distinguishes clean and stale states', () => {
  assert.match(
    formatSummary([
      {
        name: 'workbox',
        registryPackage: 'workbox-sw',
        currentVersion: '5.1.2',
        latestVersion: '5.1.2',
        updateAvailable: false
      }
    ]),
    /latest declared npm release/
  );

  assert.match(
    formatSummary([
      {
        name: 'workbox',
        registryPackage: 'workbox-sw',
        currentVersion: '5.1.2',
        latestVersion: '5.2.0',
        updateAvailable: true
      }
    ]),
    /pinned 5\.1\.2, latest 5\.2\.0/
  );
});
