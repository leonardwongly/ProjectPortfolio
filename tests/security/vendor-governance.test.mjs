import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  loadManifest,
  MAX_VENDOR_MANIFEST_BYTES,
  validateVendorGovernance
} from '../../scripts/check-vendor-governance.mjs';

function makeGovernanceFixture(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-governance-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const relativePath = 'js/vendor/package/file.js';
  const absolutePath = path.join(rootDir, relativePath);
  const content = '/* package:1.2.3 unique-signature */\n';
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);

  return {
    rootDir,
    absolutePath,
    manifest: {
      last_reviewed: '2026-07-01',
      review_cadence: 'monthly',
      max_review_age_days: 45,
      dependencies: [
        {
          name: 'package',
          registry_package: '@scope/package',
          source: 'https://storage.googleapis.com/package/releases/1.2.3/',
          version: '1.2.3',
          files: [
            {
              path: relativePath,
              upstream_url: 'https://storage.googleapis.com/package/releases/1.2.3/file.js',
              sha256: crypto.createHash('sha256').update(content).digest('hex'),
              signatures: ['package:1.2.3', 'unique-signature']
            }
          ]
        }
      ]
    }
  };
}

test('vendored dependency governance validates digests, freshness, and inventory', () => {
  const result = validateVendorGovernance(loadManifest(), { today: '2026-07-01' });

  assert.equal(result.reviewAgeDays, 0);
  assert.deepEqual(result.declaredFiles, result.actualFiles);
});

test('vendor manifest loading is bounded, no-follow, regular-only, and snapshot-stable', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-manifest-input-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const filePath = path.join(rootDir, 'docs', 'security', 'vendor-dependencies.json');
  const replacedPath = path.join(rootDir, 'docs', 'security', 'original-manifest.json');
  const externalPath = path.join(rootDir, 'external-manifest.json');
  const manifest = {
    last_reviewed: '2026-07-01',
    review_cadence: 'monthly',
    max_review_age_days: 45,
    dependencies: []
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  fs.writeFileSync(filePath, manifestBytes);
  assert.deepEqual(
    loadManifest(filePath, { rootDir, maxBytes: manifestBytes.length }),
    JSON.parse(manifestBytes.toString('utf8'))
  );

  fs.truncateSync(filePath, MAX_VENDOR_MANIFEST_BYTES + 1);
  assert.throws(
    () => loadManifest(filePath, { rootDir }),
    /exceeds the 262144-byte limit/
  );

  fs.rmSync(filePath, { force: true });
  fs.writeFileSync(externalPath, manifestBytes);
  fs.symlinkSync(externalPath, filePath);
  assert.throws(
    () => loadManifest(filePath, { rootDir }),
    /refusing to follow a symbolic link/
  );

  fs.unlinkSync(filePath);
  fs.mkdirSync(filePath);
  assert.throws(
    () => loadManifest(filePath, { rootDir }),
    /expected a regular file/
  );

  fs.rmdirSync(filePath);
  fs.writeFileSync(filePath, manifestBytes);
  assert.throws(
    () => loadManifest(filePath, {
      rootDir,
      afterRead() {
        fs.renameSync(filePath, replacedPath);
        fs.writeFileSync(filePath, manifestBytes);
      }
    }),
    /changed while it was being read|path was replaced after the read/
  );
});

test('vendored dependency governance rejects stale reviews', () => {
  const manifest = loadManifest();

  assert.throws(
    () => validateVendorGovernance(manifest, { today: '2026-08-16' }),
    /review age is \d+ day\(s\), exceeding 45 day\(s\)/
  );
});

test('vendor governance rejects malformed package names and SemVer', (t) => {
  const fixture = makeGovernanceFixture(t);
  const malformedPackage = structuredClone(fixture.manifest);
  malformedPackage.dependencies[0].registry_package = '@scope';
  assert.throws(
    () => validateVendorGovernance(malformedPackage, { rootDir: fixture.rootDir, today: '2026-07-01' }),
    /unsupported npm package name/
  );

  for (const malformedVersion of ['01.2.3', '1.2.3-01', '1.2.3-', '1.2.3+']) {
    const manifest = structuredClone(fixture.manifest);
    manifest.dependencies[0].version = malformedVersion;
    assert.throws(
      () => validateVendorGovernance(manifest, { rootDir: fixture.rootDir, today: '2026-07-01' }),
      /expected valid SemVer/
    );
  }
});

test('vendor governance rejects source/version incoherence and prefix-sibling paths', (t) => {
  const fixture = makeGovernanceFixture(t);
  const mismatchedSource = structuredClone(fixture.manifest);
  mismatchedSource.dependencies[0].source = 'https://storage.googleapis.com/package/releases/1.2.30/';
  mismatchedSource.dependencies[0].files[0].upstream_url =
    'https://storage.googleapis.com/package/releases/1.2.30/file.js';
  assert.throws(
    () => validateVendorGovernance(mismatchedSource, { rootDir: fixture.rootDir, today: '2026-07-01' }),
    /source path must contain dependency version 1\.2\.3 as a complete segment/
  );

  const siblingVendorPath = structuredClone(fixture.manifest);
  siblingVendorPath.dependencies[0].files[0].path = 'js/vendorish/package/file.js';
  assert.throws(
    () => validateVendorGovernance(siblingVendorPath, { rootDir: fixture.rootDir, today: '2026-07-01' }),
    /path must stay under js\/vendor\//
  );
});

test('vendor governance rejects duplicate signatures', (t) => {
  const fixture = makeGovernanceFixture(t);
  fixture.manifest.dependencies[0].files[0].signatures = ['unique-signature', 'unique-signature'];
  assert.throws(
    () => validateVendorGovernance(fixture.manifest, { rootDir: fixture.rootDir, today: '2026-07-01' }),
    /duplicate signatures are not allowed/
  );
});

test('vendor governance rejects symlinks before reading declared content', (t) => {
  const fixture = makeGovernanceFixture(t);
  const externalPath = path.join(fixture.rootDir, 'outside.js');
  fs.writeFileSync(externalPath, 'unique-signature');
  fs.unlinkSync(fixture.absolutePath);
  fs.symlinkSync(externalPath, fixture.absolutePath);

  assert.throws(
    () => validateVendorGovernance(fixture.manifest, { rootDir: fixture.rootDir, today: '2026-07-01' }),
    /symlink not allowed/
  );
});

test('vendor governance rejects a file swapped to a symlink between inspection and open', (t) => {
  const fixture = makeGovernanceFixture(t);
  const externalPath = path.join(fixture.rootDir, 'outside-race.js');
  fs.copyFileSync(fixture.absolutePath, externalPath);
  const originalLstatSync = fs.lstatSync;
  let declaredFileInspections = 0;

  fs.lstatSync = function lstatAndSwap(filePath, ...args) {
    const stats = originalLstatSync.call(fs, filePath, ...args);
    if (path.resolve(filePath) === path.resolve(fixture.absolutePath)) {
      declaredFileInspections += 1;
      if (declaredFileInspections === 2) {
        fs.unlinkSync(fixture.absolutePath);
        fs.symlinkSync(externalPath, fixture.absolutePath);
      }
    }
    return stats;
  };

  try {
    assert.throws(
      () => validateVendorGovernance(fixture.manifest, { rootDir: fixture.rootDir, today: '2026-07-01' }),
      /symbolic link|changed during validation/
    );
    assert.equal(fs.readlinkSync(fixture.absolutePath), externalPath);
  } finally {
    fs.lstatSync = originalLstatSync;
  }
});

test('vendor governance rejects files added after its initial inventory snapshot', (t) => {
  const fixture = makeGovernanceFixture(t);
  const latePath = path.join(fixture.rootDir, 'js', 'vendor', 'package', 'late.js');
  const originalReadSync = fs.readSync;
  let injected = false;

  fs.readSync = function readAndInjectLateFile(...args) {
    const bytesRead = originalReadSync.apply(fs, args);
    if (!injected && bytesRead > 0) {
      injected = true;
      fs.writeFileSync(latePath, 'late untracked vendor file');
    }
    return bytesRead;
  };

  try {
    assert.throws(
      () => validateVendorGovernance(fixture.manifest, { rootDir: fixture.rootDir, today: '2026-07-01' }),
      /inventory changed during validation/
    );
    assert.equal(fs.existsSync(latePath), true);
  } finally {
    fs.readSync = originalReadSync;
  }
});

test('vendor governance rejects a declared file overwritten after its validated read', (t) => {
  const fixture = makeGovernanceFixture(t);
  const originalReadSync = fs.readSync;
  let injected = false;

  fs.readSync = function readAndOverwriteValidatedFile(...args) {
    const bytesRead = originalReadSync.apply(fs, args);
    if (!injected && bytesRead > 0) {
      injected = true;
      fs.writeFileSync(fixture.absolutePath, 'malicious replacement');
    }
    return bytesRead;
  };

  try {
    assert.throws(
      () => validateVendorGovernance(fixture.manifest, { rootDir: fixture.rootDir, today: '2026-07-01' }),
      /changed during validation|changed while it was being read/
    );
    assert.equal(fs.readFileSync(fixture.absolutePath, 'utf8'), 'malicious replacement');
  } finally {
    fs.readSync = originalReadSync;
  }
});

test('vendor governance rejects special filesystem nodes', (t) => {
  const fixture = makeGovernanceFixture(t);
  const specialPath = path.join(fixture.rootDir, 'js', 'vendor', 'unexpected.node');
  fs.writeFileSync(specialPath, 'synthetic special-node placeholder');
  const originalLstatSync = fs.lstatSync;
  fs.lstatSync = function lstatWithSyntheticSpecialNode(filePath, ...args) {
    const stats = originalLstatSync.call(fs, filePath, ...args);
    if (path.resolve(filePath) !== path.resolve(specialPath)) return stats;
    return {
      isDirectory: () => false,
      isFile: () => false,
      isSymbolicLink: () => false
    };
  };

  try {
    assert.throws(
      () => validateVendorGovernance(fixture.manifest, { rootDir: fixture.rootDir, today: '2026-07-01' }),
      /special node not allowed/
    );
  } finally {
    fs.lstatSync = originalLstatSync;
  }
});
