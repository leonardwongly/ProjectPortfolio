import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureHttpsUrl,
  ensureVendorPath,
  fetchVendorFiles,
  parseArgs,
  runVendorRefresh,
  updateManifestHashes
} from '../../scripts/update-vendor.mjs';

async function publicLookup() {
  return [{ address: '142.250.190.27', family: 4 }];
}

function makeManifest() {
  return {
    last_reviewed: '2026-04-08',
    review_cadence: 'monthly',
    max_review_age_days: 45,
    dependencies: [
      {
        name: 'workbox',
        registry_package: 'workbox-sw',
        source: 'https://storage.googleapis.com/workbox-cdn/releases/9.9.9/',
        version: '9.9.9',
        files: [
          {
            path: 'js/vendor/workbox/test-file.js',
            upstream_url: 'https://storage.googleapis.com/workbox-cdn/releases/9.9.9/test-file.js',
            sha256: '0000000000000000000000000000000000000000000000000000000000000000',
            signatures: ['workbox:test:9.9.9', 'test-file.js']
          }
        ]
      }
    ]
  };
}

test('ensureHttpsUrl rejects non-https upstream URLs', () => {
  assert.equal(
    ensureHttpsUrl('https://storage.googleapis.com/workbox-cdn/releases/5.1.2/workbox-sw.js', 'file.upstream_url'),
    'https://storage.googleapis.com/workbox-cdn/releases/5.1.2/workbox-sw.js'
  );
  assert.throws(() => ensureHttpsUrl('http://example.com/file.js', 'file.upstream_url'), /only https URLs are allowed/);
  assert.throws(() => ensureHttpsUrl('https://example.com/file.js', 'file.upstream_url'), /not in the allowed upstream host list/);
});

test('parseArgs defaults to dry-run and validates known flags', () => {
  assert.deepEqual(parseArgs([]), {
    write: false,
    timeoutMs: 15000,
    today: new Date().toISOString().slice(0, 10)
  });
  assert.deepEqual(parseArgs(['--write', '--timeout-ms', '5000', '--today', '2026-04-09']), {
    write: true,
    timeoutMs: 5000,
    today: '2026-04-09'
  });
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
});



test('ensureVendorPath rejects traversal and non-vendor paths', () => {
  assert.equal(ensureVendorPath('js/vendor/workbox/test-file.js', 'file.path'), 'js/vendor/workbox/test-file.js');
  assert.throws(() => ensureVendorPath('../pwned.txt', 'file.path'), /path must stay under js\/vendor\//);
  assert.throws(() => ensureVendorPath('scripts/build.js', 'file.path'), /path must stay under js\/vendor\//);
});
test('fetchVendorFiles downloads upstream content and verifies signatures', async () => {
  const manifest = makeManifest();
  const payload = '/* workbox:test:9.9.9 */\nconsole.log("test-file.js");\n';
  const fetched = await fetchVendorFiles(manifest, {
    fetchImpl: async () => new Response(payload, { status: 200 }),
    lookupImpl: publicLookup,
    timeoutMs: 5000
  });

  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].path, 'js/vendor/workbox/test-file.js');
  assert.match(fetched[0].sha256, /^[0-9a-f]{64}$/);
});

test('fetchVendorFiles rejects upstream payloads that miss required signatures', async () => {
  const manifest = makeManifest();

  await assert.rejects(
    () => fetchVendorFiles(manifest, {
      fetchImpl: async () => new Response('console.log("wrong");', { status: 200 }),
      lookupImpl: publicLookup,
      timeoutMs: 5000
    }),
    /missing signature/
  );
});

test('fetchVendorFiles rejects private DNS answers before fetching upstream content', async () => {
  const manifest = makeManifest();
  let fetched = false;

  await assert.rejects(
    () => fetchVendorFiles(manifest, {
      fetchImpl: async () => {
        fetched = true;
        return new Response('/* workbox:test:9.9.9 */', { status: 200 });
      },
      lookupImpl: async () => [{ address: '192.168.1.10', family: 4 }],
      timeoutMs: 5000
    }),
    /resolved to blocked address 192\.168\.1\.10/
  );

  assert.equal(fetched, false);
});

test('fetchVendorFiles rejects upstream URLs outside the dependency source', async () => {
  const manifest = makeManifest();
  manifest.dependencies[0].files[0].upstream_url = 'https://storage.googleapis.com/other-bucket/test-file.js';

  await assert.rejects(
    () => fetchVendorFiles(manifest, {
      fetchImpl: async () => new Response('/* workbox:test:9.9.9 */', { status: 200 }),
      lookupImpl: publicLookup,
      timeoutMs: 5000
    }),
    /upstream URL must stay under dependency source/
  );
});

test('updateManifestHashes and runVendorRefresh write deterministic outputs', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-refresh-'));
  const manifestPath = path.join(tempRoot, 'docs', 'security', 'vendor-dependencies.json');
  const vendorDir = path.join(tempRoot, 'js', 'vendor', 'workbox');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(vendorDir, { recursive: true });

  const manifest = makeManifest();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(
    path.join(vendorDir, 'test-file.js'),
    '/* workbox:test:9.9.9 */\nconsole.log("old test-file.js");\n'
  );

  const payload = '/* workbox:test:9.9.9 */\nconsole.log("test-file.js");\n';
  let lookupCalls = 0;
  const result = await runVendorRefresh(
    { write: true, timeoutMs: 5000, today: '2026-04-09' },
    {
      rootDir: tempRoot,
      manifestPath,
      fetchImpl: async () => new Response(payload, { status: 200 }),
      lookupImpl: async (...args) => {
        lookupCalls += 1;
        return publicLookup(...args);
      }
    }
  );

  assert.equal(result.write, true);
  assert.equal(lookupCalls, 1);
  assert.equal(result.summary[0].changed, true);
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).last_reviewed, '2026-04-09');
  assert.equal(fs.readFileSync(path.join(vendorDir, 'test-file.js'), 'utf8'), payload);

  const updatedManifest = updateManifestHashes(manifest, [
    {
      dependencyIndex: 0,
      fileIndex: 0,
      sha256: result.summary[0].sha256
    }
  ], '2026-04-09');
  assert.equal(updatedManifest.last_reviewed, '2026-04-09');
});
