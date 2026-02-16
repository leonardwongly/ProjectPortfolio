import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const WORKFLOW_FILES = [
  '.github/workflows/build.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/gemini-cli.yml',
  '.github/workflows/playwright-integration.yml'
];

const SOURCE_HTML_FILES = [
  'src/index.html',
  'src/reading.html',
  'src/offline.html'
];

const GENERATED_HTML_FILES = [
  'index.html',
  'reading.html',
  'offline.html'
];

const HEADERS_FILE = '_headers';

test('workflow uses references are pinned by SHA', () => {
  const unpinned = [];
  const pinPattern = /uses:\s*[^@\s]+@[0-9a-f]{40}\b/;
  const usesPattern = /uses:\s*[^@\s]+@/;

  for (const file of WORKFLOW_FILES) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (usesPattern.test(line) && !pinPattern.test(line)) {
        unpinned.push(`${file}:${index + 1}:${line.trim()}`);
      }
    });
  }

  assert.deepEqual(unpinned, [], `Found unpinned action references:\n${unpinned.join('\n')}`);
});

test('CSP is declared in source pages and appears before script tags when present', () => {
  for (const file of SOURCE_HTML_FILES) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const cspLine = lines.findIndex((line) => line.includes('Content-Security-Policy'));
    const scriptLine = lines.findIndex((line) => line.includes('<script'));

    assert.ok(cspLine >= 0, `Missing CSP in ${file}`);
    if (scriptLine >= 0) {
      assert.ok(cspLine < scriptLine, `CSP appears after script tags in ${file}`);
    }
  }
});

test('source CSP style-src does not permit unsafe-inline', () => {
  const offenders = [];

  for (const file of SOURCE_HTML_FILES) {
    const content = fs.readFileSync(file, 'utf8');
    if (/style-src[^"]*'unsafe-inline'/i.test(content)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, [], `Found unsafe-inline style-src directives in: ${offenders.join(', ')}`);
});

test('_headers includes required runtime security headers', () => {
  const content = fs.readFileSync(HEADERS_FILE, 'utf8');

  assert.match(content, /Content-Security-Policy:/);
  assert.match(content, /Permissions-Policy:/);
  assert.match(content, /X-Frame-Options:\s*DENY/i);
  assert.match(content, /X-Content-Type-Options:\s*nosniff/i);
  assert.match(content, /Referrer-Policy:\s*strict-origin-when-cross-origin/i);
});

test('target=_blank always includes noopener and noreferrer', () => {
  const missingRel = [];
  const linkRegex = /<a[^>]*target="_blank"[^>]*>/g;

  for (const file of [...SOURCE_HTML_FILES, ...GENERATED_HTML_FILES]) {
    const content = fs.readFileSync(file, 'utf8');
    const matches = content.match(linkRegex) || [];
    matches.forEach((anchor) => {
      const hasRel = /rel="[^"]*noopener[^"]*noreferrer[^"]*"|rel="[^"]*noreferrer[^"]*noopener[^"]*"/.test(anchor);
      if (!hasRel) {
        missingRel.push(`${file}: ${anchor}`);
      }
    });
  }

  assert.deepEqual(missingRel, [], `Found target=_blank links without rel protection:\n${missingRel.join('\n')}`);
});

test('generated pages do not contain dangerous href/src schemes', () => {
  const offenders = [];
  const dangerousPattern = /\b(?:href|src)="(?:javascript:|data:text|vbscript:)/ig;

  for (const file of GENERATED_HTML_FILES) {
    const content = fs.readFileSync(file, 'utf8');
    if (dangerousPattern.test(content)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, [], `Found dangerous schemes in generated pages: ${offenders.join(', ')}`);
});

test('generated pages do not contain inline style attributes', () => {
  const offenders = [];
  const inlineStylePattern = /\sstyle\s*=/i;

  for (const file of GENERATED_HTML_FILES) {
    const content = fs.readFileSync(file, 'utf8');
    if (inlineStylePattern.test(content)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, [], `Found inline style attributes in generated pages: ${offenders.join(', ')}`);
});

test('reading page exposes share controls with accessible status messaging', () => {
  const content = fs.readFileSync('reading.html', 'utf8');

  assert.match(content, /data-reading-share/);
  assert.match(content, /data-reading-share-status/);
  assert.match(content, /aria-live="polite"/);
});

test('reading share measurement hooks remain wired in client script', () => {
  const content = fs.readFileSync('js/main.js', 'utf8');

  assert.match(content, /reading_share_clicked/);
  assert.match(content, /reading_share_completed/);
});

test('reading page avoids oversized 2x cover variants for known heavy assets', () => {
  const content = fs.readFileSync('reading.html', 'utf8');

  assert.doesNotMatch(content, /book\/2022\/2022-4\.webp 2x/);
  assert.doesNotMatch(content, /book\/2022\/2022-5\.webp 2x/);
  assert.match(content, /book\/2022\/2022-4-300\.webp/);
  assert.match(content, /book\/2022\/2022-5-300\.webp/);
});
