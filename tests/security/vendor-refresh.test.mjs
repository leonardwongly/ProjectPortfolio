import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureHttpsUrl,
  ensureVendorPath,
  fetchVendorFiles,
  getDryRunExitCode,
  parseArgs,
  persistVendorRefresh,
  runVendorRefresh,
  summarizeFetchedFiles,
  updateManifestHashes,
  vendorRefreshExitCode,
  withVendorRefreshLock
} from '../../scripts/update-vendor.mjs';
import {
  MAX_VENDOR_FILE_BYTES,
  MAX_VENDOR_MANIFEST_BYTES
} from '../../scripts/check-vendor-governance.mjs';

async function publicLookup() {
  return [{ address: '142.250.190.27', family: 4 }];
}

function snapshotFilesystemTree(rootDir) {
  const entries = [];

  function visit(absolutePath, relativePath) {
    const stats = fs.lstatSync(absolutePath);
    const displayPath = relativePath.split(path.sep).join('/') || '.';
    if (stats.isDirectory()) {
      entries.push({ path: displayPath, type: 'directory' });
      for (const name of fs.readdirSync(absolutePath).sort()) {
        visit(path.join(absolutePath, name), path.join(relativePath, name));
      }
      return;
    }
    if (stats.isSymbolicLink()) {
      entries.push({ path: displayPath, type: 'symlink', target: fs.readlinkSync(absolutePath) });
      return;
    }
    if (stats.isFile()) {
      const bytes = fs.readFileSync(absolutePath);
      entries.push({
        path: displayPath,
        type: 'file',
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex')
      });
      return;
    }
    entries.push({ path: displayPath, type: 'special' });
  }

  visit(rootDir, '');
  return entries;
}

function assertNoTransactionArtifacts(snapshot) {
  assert.deepEqual(
    snapshot.filter((entry) => {
      const name = path.posix.basename(entry.path);
      return name.startsWith('.tmp-') || name.startsWith('.vendor-refresh-recovery-');
    }),
    []
  );
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
  const beforeDate = new Date().toISOString().slice(0, 10);
  const defaults = parseArgs([]);
  const afterDate = new Date().toISOString().slice(0, 10);
  assert.equal(defaults.write, false);
  assert.equal(defaults.timeoutMs, 15000);
  assert.equal([beforeDate, afterDate].includes(defaults.today), true);
  assert.deepEqual(parseArgs(['--write', '--timeout-ms', '5000', '--today', '2026-04-09']), {
    write: true,
    timeoutMs: 5000,
    today: '2026-04-09'
  });
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
  assert.throws(() => parseArgs(['--timeout-ms', '60001']), /must not exceed 60000ms/);
  assert.throws(() => parseArgs(['--timeout-ms', '999999999999999999999']), /must not exceed 60000ms/);
});

test('fail-on-drift makes a changed vendored file fail the dry-run check', () => {
  const beforeDate = new Date().toISOString().slice(0, 10);
  const options = parseArgs(['--fail-on-drift']);
  const afterDate = new Date().toISOString().slice(0, 10);
  assert.equal(options.failOnDrift, true);
  assert.equal(options.write, false);
  assert.equal(options.timeoutMs, 15000);
  assert.equal([beforeDate, afterDate].includes(options.today), true);
  assert.equal(getDryRunExitCode({ changedFiles: [], failOnDrift: true }), 0);
  assert.equal(getDryRunExitCode({ changedFiles: [{ path: 'js/vendor/workbox/test-file.js' }], failOnDrift: true }), 1);
  assert.equal(getDryRunExitCode({ changedFiles: [{ path: 'js/vendor/workbox/test-file.js' }], failOnDrift: false }), 0);
});



test('ensureVendorPath rejects traversal and non-vendor paths', () => {
  assert.equal(ensureVendorPath('js/vendor/workbox/test-file.js', 'file.path'), 'js/vendor/workbox/test-file.js');
  assert.throws(() => ensureVendorPath('../pwned.txt', 'file.path'), /path must stay under js\/vendor\//);
  assert.throws(() => ensureVendorPath('scripts/build.js', 'file.path'), /path must stay under js\/vendor\//);
  assert.throws(() => ensureVendorPath('js\\vendor\\workbox\\test-file.js', 'file.path'), /backslashes/);
  assert.throws(() => ensureVendorPath('C:\\temp\\test-file.js', 'file.path'), /expected relative path/);
});

test('fetchVendorFiles rejects an empty required-signature set before fetching', async () => {
  const manifest = makeManifest();
  manifest.dependencies[0].files[0].signatures = [];
  let fetched = false;

  await assert.rejects(
    () => fetchVendorFiles(manifest, {
      fetchImpl: async () => {
        fetched = true;
        return new Response('unexpected', { status: 200 });
      },
      lookupImpl: publicLookup,
      timeoutMs: 5000
    }),
    /signatures: expected non-empty array/
  );
  assert.equal(fetched, false);
});

test('fetchVendorFiles rejects a malformed dependency inventory before fetching', async () => {
  let fetched = false;
  await assert.rejects(
    () => fetchVendorFiles({ dependencies: {} }, {
      fetchImpl: async () => {
        fetched = true;
        return new Response('unexpected', { status: 200 });
      },
      lookupImpl: publicLookup,
      timeoutMs: 5000
    }),
    /manifest\.dependencies: expected non-empty array/
  );
  assert.equal(fetched, false);
});

test('fetchVendorFiles rejects duplicate signatures before fetching', async () => {
  const manifest = makeManifest();
  manifest.dependencies[0].files[0].signatures = ['same-signature', 'same-signature'];
  let fetched = false;

  await assert.rejects(
    () => fetchVendorFiles(manifest, {
      fetchImpl: async () => {
        fetched = true;
        return new Response('unexpected', { status: 200 });
      },
      lookupImpl: publicLookup,
      timeoutMs: 5000
    }),
    /duplicate signatures are not allowed/
  );
  assert.equal(fetched, false);
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

test('fetchVendorFiles bounds injected response bytes and body wall time', { timeout: 2000 }, async (t) => {
  const manifest = makeManifest();

  await t.test('byte limit', async () => {
    await assert.rejects(
      () => fetchVendorFiles(manifest, {
        fetchImpl: async () => new Response('x'.repeat(65), { status: 200 }),
        lookupImpl: publicLookup,
        timeoutMs: 5000,
        maxBytes: 64
      }),
      /exceeds 64 byte limit/
    );
  });

  await t.test('body deadline', async () => {
    let cancelled = 0;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'));
      },
      cancel() {
        cancelled += 1;
      }
    });
    await assert.rejects(
      () => fetchVendorFiles(manifest, {
        fetchImpl: async () => new Response(body, { status: 200 }),
        lookupImpl: publicLookup,
        timeoutMs: 10,
        maxBytes: 64
      }),
      (error) => error.name === 'AbortError' && /after 10ms/.test(error.message)
    );
    assert.equal(cancelled, 1);
    assert.equal(body.locked, false);
  });
});

test('fetchVendorFiles wires the default path to the pinned byte transport', async () => {
  const manifest = makeManifest();
  const payload = '/* workbox:test:9.9.9 */\nconsole.log("test-file.js");\n';
  let transportCall;

  const fetched = await fetchVendorFiles(manifest, {
    lookupImpl: publicLookup,
    requestBytesImpl: async (url, options) => {
      transportCall = { url, options };
      return { status: 200, statusText: 'OK', bytes: Buffer.from(payload) };
    },
    timeoutMs: 1000
  });

  assert.equal(transportCall.url, manifest.dependencies[0].files[0].upstream_url);
  assert.equal(transportCall.options.lookupImpl, publicLookup);
  assert.equal(transportCall.options.maxBytes, 5 * 1024 * 1024);
  assert.equal(fetched[0].bytes.toString('utf8'), payload);
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

test('fetchVendorFiles rejects a sibling source directory with the same string prefix', async () => {
  const manifest = makeManifest();
  manifest.dependencies[0].source = 'https://storage.googleapis.com/workbox-cdn/releases/9.9.9';
  manifest.dependencies[0].files[0].upstream_url =
    'https://storage.googleapis.com/workbox-cdn/releases/9.9.90/test-file.js';

  await assert.rejects(
    () => fetchVendorFiles(manifest, {
      fetchImpl: async () => new Response('unexpected', { status: 200 }),
      lookupImpl: publicLookup,
      timeoutMs: 5000
    }),
    /upstream URL must stay under dependency source/
  );
});

test('vendor refresh dry-run exit decision fails only when upstream drift exists', () => {
  assert.equal(vendorRefreshExitCode({ write: false, summary: [{ changed: true }] }, false), 0);
  assert.equal(vendorRefreshExitCode({ write: false, summary: [{ changed: true }] }, true), 1);
  assert.equal(vendorRefreshExitCode({ write: false, summary: [{ changed: false }] }, true), 0);
  assert.equal(vendorRefreshExitCode({ write: true, summary: [{ changed: true }] }, true), 0);
});

test('refresh comparison rejects unsafe, oversized, and replaced current files', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-comparison-input-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const relativePath = 'js/vendor/workbox/test-file.js';
  const absolutePath = path.join(rootDir, relativePath);
  const externalPath = path.join(rootDir, 'external.js');
  const replacedPath = path.join(rootDir, 'replaced.js');
  const originalBytes = Buffer.from('original vendor bytes\n');
  const fetchedFiles = [{
    path: relativePath,
    upstreamUrl: 'https://storage.googleapis.com/workbox-cdn/releases/9.9.9/test-file.js',
    sha256: '0'.repeat(64)
  }];
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  fs.writeFileSync(externalPath, originalBytes);
  fs.symlinkSync(externalPath, absolutePath);
  assert.throws(
    () => summarizeFetchedFiles(fetchedFiles, rootDir),
    /refusing to follow a symbolic link/
  );

  fs.unlinkSync(absolutePath);
  fs.mkdirSync(absolutePath);
  assert.throws(
    () => summarizeFetchedFiles(fetchedFiles, rootDir),
    /expected a regular file/
  );

  fs.rmdirSync(absolutePath);
  fs.writeFileSync(absolutePath, 'x');
  fs.truncateSync(absolutePath, MAX_VENDOR_FILE_BYTES + 1);
  assert.throws(
    () => summarizeFetchedFiles(fetchedFiles, rootDir),
    /exceeds the 5242880-byte limit/
  );

  fs.rmSync(absolutePath, { force: true });
  fs.writeFileSync(absolutePath, originalBytes);
  assert.throws(
    () => summarizeFetchedFiles(fetchedFiles, rootDir, {
      afterRead() {
        fs.renameSync(absolutePath, replacedPath);
        fs.writeFileSync(absolutePath, originalBytes);
      }
    }),
    /changed while it was being read|path was replaced after the read/
  );
});

test('updateManifestHashes and runVendorRefresh write deterministic outputs', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-refresh-'));
  const manifestPath = path.join(tempRoot, 'docs', 'security', 'vendor-dependencies.json');
  const vendorDir = path.join(tempRoot, 'js', 'vendor', 'workbox');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(vendorDir, { recursive: true });

  try {
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
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('persistVendorRefresh restores every original byte after a mid-transaction failure', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-rollback-'));
  const manifestPath = path.join(tempRoot, 'docs', 'security', 'vendor-dependencies.json');
  const vendorPath = path.join(tempRoot, 'js', 'vendor', 'workbox', 'test-file.js');
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(vendorPath), { recursive: true });
    const originalManifestBytes = Buffer.from(`${JSON.stringify(makeManifest(), null, 2)}\n`);
    const originalVendorBytes = Buffer.from('original vendor bytes\n');
    fs.writeFileSync(manifestPath, originalManifestBytes);
    fs.writeFileSync(vendorPath, originalVendorBytes);

    let persistedWrites = 0;
    assert.throws(
      () => persistVendorRefresh(
        manifestPath,
        { ...makeManifest(), last_reviewed: '2026-04-09' },
        [{
          path: 'js/vendor/workbox/test-file.js',
          bytes: Buffer.from('replacement vendor bytes\n')
        }],
        tempRoot,
        {
          beforeWrite({ phase }) {
            if (phase === 'persist' && ++persistedWrites === 2) {
              throw new Error('fault injected on second persistent write');
            }
          }
        }
      ),
      /fault injected on second persistent write/
    );

    assert.deepEqual(fs.readFileSync(manifestPath), originalManifestBytes);
    assert.deepEqual(fs.readFileSync(vendorPath), originalVendorBytes);
    const leftovers = fs.readdirSync(path.dirname(vendorPath)).filter((name) => name.startsWith('.tmp-'));
    assert.deepEqual(leftovers, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('persistVendorRefresh never rolls back a path it did not publish', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-rollback-scope-'));
  const manifestPath = path.join(rootDir, 'docs', 'security', 'vendor-dependencies.json');
  const firstVendorPath = path.join(rootDir, 'js', 'vendor', 'workbox', 'first.js');
  const concurrentVendorPath = path.join(rootDir, 'js', 'vendor', 'workbox', 'concurrent.js');
  const originalManifestBytes = Buffer.from(`${JSON.stringify(makeManifest(), null, 2)}\n`);
  const originalFirstBytes = Buffer.from('first original\n');
  const concurrentBytes = Buffer.from('created by another process\n');
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(firstVendorPath), { recursive: true });
    fs.writeFileSync(manifestPath, originalManifestBytes);
    fs.writeFileSync(firstVendorPath, originalFirstBytes);

    assert.throws(
      () => persistVendorRefresh(
        manifestPath,
        { ...makeManifest(), last_reviewed: '2026-04-09' },
        [
          { path: 'js/vendor/workbox/first.js', bytes: Buffer.from('first replacement\n') },
          { path: 'js/vendor/workbox/concurrent.js', bytes: Buffer.from('transaction replacement\n') }
        ],
        rootDir,
        {
          beforeWrite({ phase, index }) {
            if (phase === 'persist' && index === 1) {
              fs.writeFileSync(concurrentVendorPath, concurrentBytes);
              throw new Error('fault before concurrent path publication');
            }
          }
        }
      ),
      /fault before concurrent path publication/
    );

    assert.deepEqual(fs.readFileSync(firstVendorPath), originalFirstBytes);
    assert.deepEqual(fs.readFileSync(concurrentVendorPath), concurrentBytes);
    assert.deepEqual(fs.readFileSync(manifestPath), originalManifestBytes);
    assertNoTransactionArtifacts(snapshotFilesystemTree(rootDir));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('persistVendorRefresh refuses destination drift immediately before publication', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-prewrite-drift-'));
  const manifestPath = path.join(rootDir, 'docs', 'security', 'vendor-dependencies.json');
  const vendorPath = path.join(rootDir, 'js', 'vendor', 'workbox', 'test-file.js');
  const displacedPath = `${vendorPath}.before-transaction`;
  const originalManifestBytes = Buffer.from(`${JSON.stringify(makeManifest(), null, 2)}\n`);
  const originalVendorBytes = Buffer.from('original vendor bytes\n');
  const concurrentBytes = Buffer.from('concurrent replacement bytes\n');
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(vendorPath), { recursive: true });
    fs.writeFileSync(manifestPath, originalManifestBytes);
    fs.writeFileSync(vendorPath, originalVendorBytes);

    assert.throws(
      () => persistVendorRefresh(
        manifestPath,
        { ...makeManifest(), last_reviewed: '2026-04-09' },
        [{ path: 'js/vendor/workbox/test-file.js', bytes: Buffer.from('transaction replacement\n') }],
        rootDir,
        {
          beforeWrite({ phase, index }) {
            if (phase === 'persist' && index === 0) {
              fs.renameSync(vendorPath, displacedPath);
              fs.writeFileSync(vendorPath, concurrentBytes);
            }
          }
        }
      ),
      /changed after transaction backup; refusing to publish/
    );

    assert.deepEqual(fs.readFileSync(vendorPath), concurrentBytes);
    assert.deepEqual(fs.readFileSync(displacedPath), originalVendorBytes);
    assert.deepEqual(fs.readFileSync(manifestPath), originalManifestBytes);
    assertNoTransactionArtifacts(snapshotFilesystemTree(rootDir));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('persistVendorRefresh rolls back when post-persist validation fails', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-post-validate-'));
  const manifestPath = path.join(rootDir, 'docs', 'security', 'vendor-dependencies.json');
  const vendorPath = path.join(rootDir, 'js', 'vendor', 'workbox', 'test-file.js');
  const originalManifestBytes = Buffer.from(`${JSON.stringify(makeManifest(), null, 2)}\n`);
  const originalVendorBytes = Buffer.from('original vendor bytes\n');
  const replacementVendorBytes = Buffer.from('replacement vendor bytes\n');
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(vendorPath), { recursive: true });
    fs.writeFileSync(manifestPath, originalManifestBytes);
    fs.writeFileSync(vendorPath, originalVendorBytes);

    assert.throws(
      () => persistVendorRefresh(
        manifestPath,
        { ...makeManifest(), last_reviewed: '2026-04-09' },
        [{ path: 'js/vendor/workbox/test-file.js', bytes: replacementVendorBytes }],
        rootDir,
        {
          afterPersist() {
            assert.deepEqual(fs.readFileSync(vendorPath), replacementVendorBytes);
            assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).last_reviewed, '2026-04-09');
            throw new Error('post-persist validation failed');
          }
        }
      ),
      /post-persist validation failed/
    );

    assert.deepEqual(fs.readFileSync(vendorPath), originalVendorBytes);
    assert.deepEqual(fs.readFileSync(manifestPath), originalManifestBytes);
    assertNoTransactionArtifacts(snapshotFilesystemTree(rootDir));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('vendor refresh lock is exclusive, no-follow, and identity checked', async (t) => {
  await t.test('existing symlink is never followed or removed', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-lock-symlink-'));
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-lock-external-'));
    const lockPath = path.join(rootDir, '.vendor-refresh.lock');
    const externalPath = path.join(externalDir, 'outside.lock');
    try {
      fs.writeFileSync(externalPath, 'outside lock bytes\n');
      fs.symlinkSync(externalPath, lockPath);
      await assert.rejects(
        () => withVendorRefreshLock(rootDir, async () => {}),
        /lock is already held or unsafe/
      );
      assert.equal(fs.lstatSync(lockPath).isSymbolicLink(), true);
      assert.equal(fs.readFileSync(externalPath, 'utf8'), 'outside lock bytes\n');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
      fs.rmSync(externalDir, { recursive: true, force: true });
    }
  });

  await t.test('same-path replacement is detected and preserved', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-lock-replaced-'));
    const replacementBytes = Buffer.from('replacement lock bytes\n');
    let lockPath;
    let originalPath;
    try {
      await assert.rejects(
        () => withVendorRefreshLock(rootDir, async (lockState) => {
          lockPath = lockState.lockPath;
          originalPath = `${lockPath}.original`;
          fs.renameSync(lockPath, originalPath);
          fs.writeFileSync(lockPath, replacementBytes);
        }),
        /lock changed while held/
      );
      assert.deepEqual(fs.readFileSync(lockPath), replacementBytes);
      assert.equal(fs.lstatSync(originalPath).isFile(), true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

test('runVendorRefresh holds one lock through fetch, publish, and validation', { timeout: 2000 }, async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-refresh-lock-run-'));
  const manifestPath = path.join(rootDir, 'docs', 'security', 'vendor-dependencies.json');
  const vendorPath = path.join(rootDir, 'js', 'vendor', 'workbox', 'test-file.js');
  const payload = '/* workbox:test:9.9.9 */\nconsole.log("first test-file.js refresh");\n';
  let signalLockAcquired;
  const lockAcquired = new Promise((resolve) => { signalLockAcquired = resolve; });
  let releaseFirst;
  const holdFirst = new Promise((resolve) => { releaseFirst = resolve; });
  let secondFetched = false;
  let firstRefresh;
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(vendorPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(makeManifest(), null, 2)}\n`);
    fs.writeFileSync(vendorPath, '/* workbox:test:9.9.9 */\nconsole.log("old");\n');

    firstRefresh = runVendorRefresh(
      { write: true, timeoutMs: 5000, today: '2026-04-09' },
      {
        rootDir,
        manifestPath,
        afterLockAcquired: async () => {
          signalLockAcquired();
          await holdFirst;
        },
        fetchImpl: async () => new Response(payload, { status: 200 }),
        lookupImpl: publicLookup
      }
    );

    await lockAcquired;
    await assert.rejects(
      () => runVendorRefresh(
        { write: true, timeoutMs: 5000, today: '2026-04-10' },
        {
          rootDir,
          manifestPath,
          fetchImpl: async () => {
            secondFetched = true;
            return new Response('/* workbox:test:9.9.9 */\nconsole.log("second test-file.js refresh");\n', { status: 200 });
          },
          lookupImpl: publicLookup
        }
      ),
      /lock is already held or unsafe/
    );
    assert.equal(secondFetched, false);

    releaseFirst();
    await firstRefresh;
    assert.equal(fs.readFileSync(vendorPath, 'utf8'), payload);
    const persistedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(persistedManifest.last_reviewed, '2026-04-09');
    assert.equal(persistedManifest.dependencies[0].files[0].sha256, crypto.createHash('sha256').update(payload).digest('hex'));
    assert.equal(fs.existsSync(path.join(rootDir, '.vendor-refresh.lock')), false);
  } finally {
    releaseFirst();
    await firstRefresh?.catch(() => {});
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('persistVendorRefresh validates every backup before the first write', async (t) => {
  const cases = [
    {
      name: 'symlink',
      mutate({ vendorPath, rootDir }) {
        const externalPath = path.join(rootDir, 'external.js');
        fs.writeFileSync(externalPath, 'external original\n');
        fs.unlinkSync(vendorPath);
        fs.symlinkSync(externalPath, vendorPath);
      },
      pattern: /refusing to follow a symbolic link/
    },
    {
      name: 'non-regular node',
      mutate({ vendorPath }) {
        fs.unlinkSync(vendorPath);
        fs.mkdirSync(vendorPath);
      },
      pattern: /expected a regular file/
    },
    {
      name: 'oversized file',
      mutate({ vendorPath }) {
        fs.truncateSync(vendorPath, MAX_VENDOR_FILE_BYTES + 1);
      },
      pattern: /exceeds the 5242880-byte limit/
    },
    {
      name: 'path replacement after read',
      backupAfterRead({ index, filePath }) {
        if (index !== 0) return;
        const originalPath = `${filePath}.original`;
        fs.renameSync(filePath, originalPath);
        fs.writeFileSync(filePath, 'replacement at same path\n');
      },
      pattern: /changed while it was being read|path was replaced after the read/
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-backup-input-'));
      const manifestPath = path.join(rootDir, 'docs', 'security', 'vendor-dependencies.json');
      const vendorPath = path.join(rootDir, 'js', 'vendor', 'workbox', 'test-file.js');
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      fs.mkdirSync(path.dirname(vendorPath), { recursive: true });
      fs.writeFileSync(manifestPath, `${JSON.stringify(makeManifest(), null, 2)}\n`);
      fs.writeFileSync(vendorPath, 'original vendor bytes\n');
      fixture.mutate?.({ manifestPath, vendorPath, rootDir });
      const beforeTree = snapshotFilesystemTree(rootDir);
      let expectedTree = beforeTree;
      let writes = 0;

      try {
        assert.throws(
          () => persistVendorRefresh(
            manifestPath,
            { ...makeManifest(), last_reviewed: '2026-04-09' },
            [{
              path: 'js/vendor/workbox/test-file.js',
              bytes: Buffer.from('replacement vendor bytes\n')
            }],
            rootDir,
            {
              beforeWrite() {
                writes += 1;
              },
              backupAfterRead: fixture.backupAfterRead
                ? (details) => {
                    fixture.backupAfterRead(details);
                    expectedTree = snapshotFilesystemTree(rootDir);
                  }
                : undefined
            }
          ),
          fixture.pattern
        );
        assert.equal(writes, 0);
        const afterTree = snapshotFilesystemTree(rootDir);
        assert.deepEqual(afterTree, expectedTree);
        assertNoTransactionArtifacts(afterTree);
      } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
      }
    });
  }

  await t.test('oversized manifest', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-backup-manifest-'));
    const manifestPath = path.join(rootDir, 'docs', 'security', 'vendor-dependencies.json');
    const vendorPath = path.join(rootDir, 'js', 'vendor', 'workbox', 'test-file.js');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(vendorPath), { recursive: true });
    fs.writeFileSync(manifestPath, 'x');
    fs.truncateSync(manifestPath, MAX_VENDOR_MANIFEST_BYTES + 1);
    fs.writeFileSync(vendorPath, 'original vendor bytes\n');
    const beforeTree = snapshotFilesystemTree(rootDir);
    let writes = 0;
    try {
      assert.throws(
        () => persistVendorRefresh(
          manifestPath,
          makeManifest(),
          [{ path: 'js/vendor/workbox/test-file.js', bytes: Buffer.from('replacement\n') }],
          rootDir,
          { beforeWrite() { writes += 1; } }
        ),
        /exceeds the 262144-byte limit/
      );
      assert.equal(writes, 0);
      const afterTree = snapshotFilesystemTree(rootDir);
      assert.deepEqual(afterTree, beforeTree);
      assertNoTransactionArtifacts(afterTree);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

test('persistVendorRefresh attempts every rollback and retains failed recovery bytes', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-rollback-recovery-'));
  const manifestPath = path.join(tempRoot, 'docs', 'security', 'vendor-dependencies.json');
  const firstVendorPath = path.join(tempRoot, 'js', 'vendor', 'workbox', 'first.js');
  const secondVendorPath = path.join(tempRoot, 'js', 'vendor', 'workbox', 'second.js');
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(firstVendorPath), { recursive: true });
    const originalManifestBytes = Buffer.from(`${JSON.stringify(makeManifest(), null, 2)}\n`);
    const originalFirstBytes = Buffer.from('first original\n');
    const originalSecondBytes = Buffer.from('second original\n');
    const concurrentSecondBytes = Buffer.from('concurrent owner bytes\n');
    const displacedPublishedPath = `${secondVendorPath}.transaction-published`;
    fs.writeFileSync(manifestPath, originalManifestBytes);
    fs.writeFileSync(firstVendorPath, originalFirstBytes);
    fs.writeFileSync(secondVendorPath, originalSecondBytes);

    let thrown;
    try {
      persistVendorRefresh(
        manifestPath,
        { ...makeManifest(), last_reviewed: '2026-04-09' },
        [
          { path: 'js/vendor/workbox/first.js', bytes: Buffer.from('first replacement\n') },
          { path: 'js/vendor/workbox/second.js', bytes: Buffer.from('second replacement\n') }
        ],
        tempRoot,
        {
          beforeWrite({ phase, index }) {
            if (phase === 'persist' && index === 2) {
              fs.renameSync(secondVendorPath, displacedPublishedPath);
              fs.writeFileSync(secondVendorPath, concurrentSecondBytes);
              throw new Error('persist fault before manifest write');
            }
          }
        }
      );
      assert.fail('expected persistence failure');
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof AggregateError);
    assert.match(thrown.message, /rollback was incomplete for: js\/vendor\/workbox\/second\.js/);
    assert.match(thrown.message, /Recovery evidence retained at/);
    assert.equal(thrown.cause.message, 'persist fault before manifest write');
    assert.deepEqual(fs.readFileSync(firstVendorPath), originalFirstBytes);
    assert.deepEqual(fs.readFileSync(secondVendorPath), concurrentSecondBytes);
    assert.equal(fs.readFileSync(displacedPublishedPath, 'utf8'), 'second replacement\n');
    assert.deepEqual(fs.readFileSync(manifestPath), originalManifestBytes);

    const recoveryDirectory = thrown.recoveryDirectory;
    assert.equal(fs.statSync(recoveryDirectory).isDirectory(), true);
    const recovery = JSON.parse(fs.readFileSync(path.join(recoveryDirectory, 'recovery.json'), 'utf8'));
    const failedEntry = recovery.entries.find((entry) => entry.path === 'js/vendor/workbox/second.js');
    assert.equal(failedEntry.rollback_status, 'failed');
    assert.match(failedEntry.rollback_error, /changed ownership or content before rollback/);
    assert.deepEqual(
      fs.readFileSync(path.join(recoveryDirectory, failedEntry.backup_file)),
      originalSecondBytes
    );
    assert.equal(
      recovery.entries.find((entry) => entry.path === 'js/vendor/workbox/first.js').rollback_status,
      'restored'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('persistVendorRefresh reports an incomplete recovery bundle without claiming retention', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-rollback-incomplete-'));
  const manifestPath = path.join(tempRoot, 'docs', 'security', 'vendor-dependencies.json');
  const vendorPath = path.join(tempRoot, 'js', 'vendor', 'workbox', 'test-file.js');
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(vendorPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(makeManifest(), null, 2)}\n`);
    fs.writeFileSync(vendorPath, 'original vendor bytes\n');

    let thrown;
    try {
      persistVendorRefresh(
        manifestPath,
        { ...makeManifest(), last_reviewed: '2026-04-09' },
        [{
          path: 'js/vendor/workbox/test-file.js',
          bytes: Buffer.from('replacement vendor bytes\n')
        }],
        tempRoot,
        {
          beforeWrite({ phase, index, label }) {
            if (phase === 'persist' && index === 1) {
              throw new Error('persist fault before manifest write');
            }
            if (phase === 'rollback' && label === 'js/vendor/workbox/test-file.js') {
              throw new Error('rollback fault for vendor file');
            }
          },
          recoveryWriteImpl() {
            throw new Error('injected recovery write failure');
          }
        }
      );
      assert.fail('expected persistence failure');
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof AggregateError);
    assert.equal(thrown.errors.length, 3);
    assert.match(thrown.message, /evidence retention was incomplete/);
    assert.match(thrown.message, /injected recovery write failure/);
    assert.doesNotMatch(thrown.message, /evidence retained at/);
    assert.deepEqual(fs.readdirSync(thrown.recoveryDirectory), []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runVendorRefresh rejects a symlinked vendor parent without external writes', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-symlink-'));
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-external-'));
  const manifestPath = path.join(tempRoot, 'docs', 'security', 'vendor-dependencies.json');
  const linkedParent = path.join(tempRoot, 'js', 'vendor', 'workbox');
  const externalFile = path.join(externalRoot, 'test-file.js');
  const manifest = makeManifest();
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(linkedParent), { recursive: true });
    fs.symlinkSync(externalRoot, linkedParent);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(externalFile, 'original external bytes');
    let fetched = false;

    await assert.rejects(
      () => runVendorRefresh(
        { write: true, timeoutMs: 5000, today: '2026-04-09' },
        {
          rootDir: tempRoot,
          manifestPath,
          fetchImpl: async () => {
            fetched = true;
            return new Response('/* workbox:test:9.9.9 */\nconsole.log("test-file.js");\n', { status: 200 });
          },
          lookupImpl: publicLookup
        }
      ),
      /symlink not allowed/
    );
    assert.equal(fetched, false);
    assert.equal(fs.readFileSync(externalFile, 'utf8'), 'original external bytes');
    assert.equal(fs.existsSync(path.join(tempRoot, '.vendor-refresh.lock')), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
});
