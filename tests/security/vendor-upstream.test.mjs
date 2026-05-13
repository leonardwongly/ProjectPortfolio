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
});

test('parseArgs validates timeout flag', () => {
  assert.deepEqual(parseArgs([]), { timeoutMs: 15000, maxAttempts: 3 });
  assert.deepEqual(parseArgs(['--timeout-ms', '2500', '--max-attempts', '4']), { timeoutMs: 2500, maxAttempts: 4 });
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
});

test('parseSemver and compareVersions handle releases and prereleases', () => {
  assert.equal(parseSemver('5.1.2').raw, '5.1.2');
  assert.equal(compareVersions('5.1.3', '5.1.2') > 0, true);
  assert.equal(compareVersions('5.1.2', '5.1.2'), 0);
  assert.equal(compareVersions('5.1.2', '5.1.2-beta.1') > 0, true);
  assert.equal(compareVersions('5.1.2-beta.2', '5.1.2-beta.1') > 0, true);
});

test('listTrackedRegistryDependencies returns registry-backed dependencies', () => {
  const tracked = listTrackedRegistryDependencies(makeManifest());

  assert.deepEqual(tracked, [
    {
      dependencyIndex: 0,
      name: 'workbox',
      version: {
        raw: '5.1.2',
        major: 5,
        minor: 1,
        patch: 2,
        prerelease: []
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
    timeoutMs: 5000,
    maxAttempts: 1
  });

  assert.equal(result.packageName, 'workbox-sw');
  assert.equal(result.latestVersion.raw, '7.3.0');
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
    timeoutMs: 5000,
    maxAttempts: 2
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
      timeoutMs: 5000,
      maxAttempts: 3
    }),
    /404 Not Found/
  );

  assert.equal(attempts, 1);
});

test('checkVendorUpstreamVersions reports stale dependencies', async () => {
  const manifest = makeManifest('5.1.2');
  const results = await checkVendorUpstreamVersions(
    { timeoutMs: 5000, maxAttempts: 1 },
    {
      manifestPath: '/unused/in-test.json',
      fetchImpl: async () => new Response(JSON.stringify({
        'dist-tags': {
          latest: '5.2.0'
        }
      }), { status: 200 }),
      loadManifest: () => manifest
    }
  );

  assert.equal(results.length, 1);
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
