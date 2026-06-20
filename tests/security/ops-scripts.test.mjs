import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-ops-'));
}

function writeFile(rootDir, relativePath, content = '') {
  const absolutePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function writePerformanceFixture(rootDir, overrides = {}) {
  [
    'index.html',
    'reading.html',
    'offline.html',
    'css/custom.css',
    'js/main.js',
    'js/site.js',
    'pwabuilder-sw.js',
    'book/.keep',
    'fonts/.keep',
    'images/.keep',
    'js/vendor/.keep'
  ].forEach((relativePath) => {
    writeFile(rootDir, relativePath, overrides[relativePath] ?? 'ok');
  });
}

test('reading metadata audit detects missing fields, duplicate records, missing covers, and duplicate cover files', async () => {
  const { auditReadingMetadata } = await import('../../scripts/audit-reading-metadata.mjs');
  const rootDir = makeTempRoot();
  writeFile(rootDir, 'book/2026/a.jpg', 'cover');
  writeFile(rootDir, 'book/2026/b.jpg', 'same-cover');
  writeFile(rootDir, 'book/2026/c.jpg', 'same-cover');

  const findings = auditReadingMetadata([
    {
      title: 'Safe Systems',
      author: 'Ada Lovelace',
      year: '2026',
      isbn: '9780000000001',
      cover: 'book/2026/a.jpg'
    },
    {
      title: 'Safe Systems',
      author: '',
      year: '2026',
      isbn: '9780000000001',
      cover: 'book/2026/missing.jpg'
    },
    {
      title: 'Different Cover Record',
      author: 'Grace Hopper',
      year: '2026',
      isbn: '9780000000002',
      cover: 'book/2026/b.jpg'
    },
    {
      title: 'Duplicate Cover Record',
      author: 'Katherine Johnson',
      year: '2026',
      isbn: '9780000000003',
      cover: 'book/2026/c.jpg'
    }
  ], { rootDir });

  assert.ok(findings.some((finding) => finding.includes('missing author')));
  assert.ok(findings.some((finding) => finding.includes('duplicate isbn')));
  assert.ok(findings.some((finding) => finding.includes('declared cover is missing')));
  assert.ok(findings.some((finding) => finding.includes('cover duplicates')));
});

test('performance budget check reports clean fixtures and oversized generated files', async () => {
  const { checkPerformanceBudget, collectRenderedAssetReferences, createAssetInventoryReport } = await import('../../scripts/check-performance-budget.mjs');
  const rootDir = makeTempRoot();

  writePerformanceFixture(rootDir);
  writeFile(rootDir, 'book/large-cover.jpg', Buffer.alloc(500, 'a'));
  writeFile(rootDir, 'book/large-cover-2x.jpg', Buffer.alloc(500, 'b'));
  writeFile(rootDir, 'reading.html', '<img src="book/large-cover.jpg" srcset="book/large-cover.jpg 1x, book/large-cover-2x.jpg 2x">');
  writeFile(rootDir, 'images/logo.png', Buffer.alloc(100, 'a'));
  assert.deepEqual(checkPerformanceBudget({ rootDir }).failures, []);
  assert.deepEqual(collectRenderedAssetReferences(fs.readFileSync(path.join(rootDir, 'reading.html'), 'utf8')), {
    references: ['book/large-cover.jpg', 'book/large-cover-2x.jpg'],
    highDpiReferences: ['book/large-cover-2x.jpg']
  });
  assert.deepEqual(createAssetInventoryReport({ rootDir, limit: 2 }).largestFiles, [
    { path: 'book/large-cover-2x.jpg', size: 500 },
    { path: 'book/large-cover.jpg', size: 500 }
  ]);

  writePerformanceFixture(rootDir, {
    'index.html': Buffer.alloc(91 * 1024, 'a')
  });
  const result = checkPerformanceBudget({ rootDir });

  assert.ok(result.failures.some((failure) => failure.includes('index.html')));
});

test('link health validator rejects unsafe URL shapes before network access', async () => {
  const { validateExternalUrl } = await import('../../scripts/check-link-health.mjs');

  assert.equal(validateExternalUrl('https://example.com/path#fragment', 'fixture').ok, true);
  assert.equal(validateExternalUrl('http://example.com', 'fixture').ok, false);
  assert.equal(validateExternalUrl('https://user:pass@example.com', 'fixture').ok, false);
  assert.equal(validateExternalUrl('https://localhost/status', 'fixture').ok, false);
  assert.equal(validateExternalUrl('https://127.0.0.1/status', 'fixture').ok, false);
  assert.equal(validateExternalUrl('https://[::1]/status', 'fixture').ok, false);
  assert.equal(validateExternalUrl('https://[fd00::1]/status', 'fixture').ok, false);
  assert.equal(validateExternalUrl('https://192.168.0.10/status', 'fixture').ok, false);
  assert.equal(validateExternalUrl('notaurl', 'fixture').category, 'invalid-url');
});

test('network safety rejects private and reserved DNS answers before fetch', async () => {
  const {
    assertPublicHttpsUrl,
    isBlockedIpAddress
  } = await import('../../scripts/lib/network-safety.mjs');

  assert.equal(isBlockedIpAddress('10.0.0.1'), true);
  assert.equal(isBlockedIpAddress('100.64.0.1'), true);
  assert.equal(isBlockedIpAddress('169.254.169.254'), true);
  assert.equal(isBlockedIpAddress('198.51.100.10'), true);
  assert.equal(isBlockedIpAddress('8.8.8.8'), false);
  assert.equal(isBlockedIpAddress('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedIpAddress('2001:db8::1'), true);
  assert.equal(isBlockedIpAddress('2606:4700:4700::1111'), false);

  await assert.rejects(
    () => assertPublicHttpsUrl('https://private.example/status', {
      lookupImpl: async () => [{ address: '10.0.0.5', family: 4 }]
    }),
    /resolved to blocked address 10\.0\.0\.5/
  );

  await assert.rejects(
    () => assertPublicHttpsUrl('https://mixed.example/status', {
      lookupImpl: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: 'fd00::1', family: 6 }
      ]
    }),
    /resolved to blocked address fd00::1/
  );

  assert.equal(
    await assertPublicHttpsUrl('https://public.example/status', {
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }]
    }),
    'https://public.example/status'
  );
});

test('link health preflight mode validates DNS without fetching URLs', async () => {
  const { runLinkHealth } = await import('../../scripts/check-link-health.mjs');
  const results = await runLinkHealth({
    preflightOnly: true,
    strict: true,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => {
      throw new Error('fetch should not run in preflight-only mode');
    }
  });

  assert.ok(results.length > 0);
  assert.ok(results.every((result) => result.ok || result.category === 'unsafe-url'));
  assert.ok(results.some((result) => result.category === 'preflight-ok'));
});

test('repository hygiene detects junk files in git-visible paths', async () => {
  const { isJunkPath } = await import('../../scripts/check-repository-hygiene.mjs');

  assert.equal(isJunkPath('.github/workflows/.DS_Store'), true);
  assert.equal(isJunkPath('notes/debug.log'), true);
  assert.equal(isJunkPath('src/index.html'), false);
});

test('workflow hygiene enforces pinned actions and safe npm installs', async () => {
  const { collectWorkflowHygieneFindings } = await import('../../scripts/check-workflow-hygiene.mjs');

  assert.deepEqual(collectWorkflowHygieneFindings(), []);
});

test('production smoke validator reports missing headers and markers', async () => {
  const { validatePage } = await import('../../scripts/check-production-smoke.mjs');
  const headers = new Headers({
    'content-security-policy': "default-src 'self'",
    'x-content-type-options': 'nosniff'
  });

  assert.deepEqual(
    validatePage({
      url: 'https://example.test/reading',
      response: { status: 200, headers },
      body: '<h1>Reading</h1>',
      check: {
        marker: /Reading/i,
        headers: ['content-security-policy', 'x-content-type-options']
      }
    }),
    []
  );

  assert.ok(
    validatePage({
      url: 'https://example.test/offline',
      response: { status: 200, headers: new Headers() },
      body: '<h1>Unexpected</h1>',
      check: {
        marker: /Offline/i,
        headers: ['content-security-policy', 'x-content-type-options']
      }
    }).length > 0
  );
});

test('telemetry policy check rejects external runtime analytics adapters', async () => {
  const { collectTelemetryPolicyFindings } = await import('../../scripts/check-telemetry-policy.mjs');

  assert.deepEqual(collectTelemetryPolicyFindings(), []);
});
