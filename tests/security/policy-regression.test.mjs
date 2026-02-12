import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const WORKFLOW_FILES = [
  '.github/workflows/build.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/semgrep.yml',
  '.github/workflows/gemini-cli.yml'
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

test('semgrep workflow uses a supported runner and queue-safe concurrency', () => {
  const content = fs.readFileSync('.github/workflows/semgrep.yml', 'utf8');

  assert.ok(
    /runs-on:\s*ubuntu-(?:latest|24\.04)\b/.test(content),
    'Semgrep workflow must use a currently supported Ubuntu runner label.'
  );
  assert.ok(
    /concurrency:\s*(?:\r?\n)+\s*# Keep one Semgrep run per ref; cancel stale runs to reduce queue pressure\.\s*(?:\r?\n)+\s*group:\s*semgrep-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}\s*(?:\r?\n)+\s*cancel-in-progress:\s*true/.test(content),
    'Semgrep workflow must set concurrency with cancel-in-progress to avoid queue buildup.'
  );
});

test('CSP is declared before the first script tag in source pages', () => {
  for (const file of SOURCE_HTML_FILES) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const cspLine = lines.findIndex((line) => line.includes('Content-Security-Policy'));
    const scriptLine = lines.findIndex((line) => line.includes('<script'));

    assert.ok(cspLine >= 0, `Missing CSP in ${file}`);
    assert.ok(scriptLine >= 0, `Missing script tag in ${file}`);
    assert.ok(cspLine < scriptLine, `CSP appears after script tags in ${file}`);
  }
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
