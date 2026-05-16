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

test('reading metadata audit detects missing fields, duplicate records, and missing covers', async () => {
  const { auditReadingMetadata } = await import('../../scripts/audit-reading-metadata.mjs');
  const rootDir = makeTempRoot();
  writeFile(rootDir, 'book/2026/a.jpg', 'cover');

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
    }
  ], { rootDir });

  assert.ok(findings.some((finding) => finding.includes('missing author')));
  assert.ok(findings.some((finding) => finding.includes('duplicate isbn')));
  assert.ok(findings.some((finding) => finding.includes('declared cover is missing')));
});

test('performance budget check reports clean fixtures and oversized generated files', async () => {
  const { checkPerformanceBudget } = await import('../../scripts/check-performance-budget.mjs');
  const rootDir = makeTempRoot();

  writePerformanceFixture(rootDir);
  assert.deepEqual(checkPerformanceBudget({ rootDir }).failures, []);

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
  assert.equal(validateExternalUrl('https://192.168.0.10/status', 'fixture').ok, false);
  assert.equal(validateExternalUrl('notaurl', 'fixture').category, 'invalid-url');
});
