import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

function makeTempRoot(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-ops-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return rootDir;
}

function writeFile(rootDir, relativePath, content = '') {
  const absolutePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function writePerformanceFixture(rootDir, overrides = {}) {
  [
    'index.html',
    'work.html',
    'case-study-agentforge.html',
    'case-study-agentic.html',
    'case-study-apple-calendar-mcp.html',
    'reading.html',
    'offline.html',
    'css/custom.css',
    'css/case-study.css',
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

test('shared HTML attribute scanning follows browser quote, raw-text, comment, and entity states', async () => {
  const { decodeHtmlAttributeEntities, scanHtmlAttributes } = await import('../../scripts/lib/html-attributes.mjs');
  const scanned = scanHtmlAttributes([
    `<!-- <img src="book/comment.jpg"> -->`,
    `<script>const fake = '<img src="book/script.jpg">';</script>`,
    `<script>${'İ'.repeat(20)}</script><img src="book/unicode-index.jpg">`,
    `<script>const fake = "</scriptx><img src='book/script-prefix.jpg'>";</script>`,
    `<iframe><img src="book/iframe.jpg"></iframe>`,
    `<img alt=" src='ignored" src="book/real.jpg" data-end="'">`,
    `<img/src=book/slash.jpg>`,
    `<plaintext><img src="book/plaintext.jpg">`
  ].join(''), { attributeNames: ['src'] });

  assert.deepEqual(scanned.findings, []);
  assert.deepEqual(scanned.attributes.map(({ value }) => value), [
    'book/unicode-index.jpg',
    'book/real.jpg',
    'book/slash.jpg'
  ]);
  assert.equal(decodeHtmlAttributeEntities('book&#x2f;cover.jpg'), 'book/cover.jpg');
  assert.equal(decodeHtmlAttributeEntities('https&#58;//public.example'), 'https://public.example');
  assert.equal(decodeHtmlAttributeEntities('book&#47missing-semicolon.jpg'), 'book/missing-semicolon.jpg');
  assert.throws(
    () => scanHtmlAttributes('<img a=1 b=2>', { maxAttributes: 1 }),
    /attribute.*limit/i
  );
});

test('reading metadata audit detects missing fields, duplicate records, missing covers, and duplicate cover files', async (t) => {
  const { auditReadingMetadata } = await import('../../scripts/audit-reading-metadata.mjs');
  const rootDir = makeTempRoot(t);
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

test('reading metadata audit fails closed on malformed entries and unsafe cover files', async (t) => {
  const { MAX_COVER_FILE_BYTES, auditReadingMetadata, sha256SafeCoverFile } = await import('../../scripts/audit-reading-metadata.mjs');
  const rootDir = makeTempRoot(t);
  const outsideRoot = makeTempRoot(t);
  writeFile(rootDir, 'book/valid.jpg', 'valid-cover');
  writeFile(outsideRoot, 'outside.jpg', 'outside-cover');
  writeFile(outsideRoot, 'hardlink-source.jpg', 'hardlinked-cover');
  fs.symlinkSync(path.join(outsideRoot, 'outside.jpg'), path.join(rootDir, 'book', 'linked.jpg'));
  fs.symlinkSync(outsideRoot, path.join(rootDir, 'book', 'linked-parent'));
  fs.linkSync(path.join(outsideRoot, 'hardlink-source.jpg'), path.join(rootDir, 'book', 'hardlinked.jpg'));
  fs.mkdirSync(path.join(rootDir, 'book', 'directory.jpg'));
  writeFile(rootDir, 'book/oversized.jpg');
  fs.truncateSync(path.join(rootDir, 'book', 'oversized.jpg'), MAX_COVER_FILE_BYTES + 1);

  const record = (index, cover) => ({
    title: `Book ${index}`,
    author: 'Security Reviewer',
    year: '2026',
    isbn: `9780000001${String(index).padStart(3, '0')}`,
    cover
  });
  const findings = auditReadingMetadata([
    null,
    'not-an-object',
    [],
    record(1, '../outside.jpg'),
    record(2, 'book/%2e%2e/outside.jpg'),
    record(3, path.join(outsideRoot, 'outside.jpg')),
    record(4, 'book/linked.jpg'),
    record(5, 'book/linked-parent/outside.jpg'),
    record(6, 'book/directory.jpg'),
    record(7, { path: 'book/valid.jpg' }),
    record(8, 'book/valid.jpg'),
    record(9, 'book/oversized.jpg'),
    record(10, 'book/hardlinked.jpg')
  ], { rootDir });

  const findingsFor = (index) => findings.filter((finding) => finding.startsWith(`reading[${index}]:`));
  assert.deepEqual([0, 1, 2].map((index) => findingsFor(index).some((finding) => finding.includes('expected an object'))), [true, true, true]);
  assert.ok(findingsFor(3).some((finding) => finding.includes('dot segments')));
  assert.ok(findingsFor(4).some((finding) => finding.includes('dot segments')));
  assert.ok(findingsFor(5).some((finding) => finding.includes('path must be relative')));
  assert.ok(findingsFor(6).some((finding) => finding.includes('symlinks are not allowed')));
  assert.ok(findingsFor(7).some((finding) => finding.includes('symlinks are not allowed')));
  assert.ok(findingsFor(8).some((finding) => finding.includes('cover must be a regular file')));
  assert.ok(findingsFor(9).some((finding) => finding.includes('expected a string path')));
  assert.deepEqual(findingsFor(10), []);
  assert.ok(findingsFor(11).some((finding) => finding.includes('cover exceeds')));
  assert.deepEqual(findingsFor(12), [
    'reading[12]: Unsafe reading[12].cover: cover must have exactly one hard link'
  ]);
  assert.equal(fs.readFileSync(path.join(outsideRoot, 'hardlink-source.jpg'), 'utf8'), 'hardlinked-cover');
  assert.equal(fs.lstatSync(path.join(outsideRoot, 'hardlink-source.jpg')).nlink, 2);
  assert.match(sha256SafeCoverFile(rootDir, 'book/valid.jpg', 'valid cover'), /^[a-f\d]{64}$/);
});

test('reading metadata source reads are bounded and no-follow', async (t) => {
  const { MAX_READING_METADATA_BYTES, readReadingData } = await import('../../scripts/audit-reading-metadata.mjs');
  const validRoot = makeTempRoot(t);
  writeFile(validRoot, 'data/reading.json', '[]');
  assert.deepEqual(readReadingData({ rootDir: validRoot }), []);

  const outsideRoot = makeTempRoot(t);
  writeFile(outsideRoot, 'reading.json', '[]');
  const linkedRoot = makeTempRoot(t);
  fs.mkdirSync(path.join(linkedRoot, 'data'));
  fs.symlinkSync(path.join(outsideRoot, 'reading.json'), path.join(linkedRoot, 'data', 'reading.json'));
  assert.throws(() => readReadingData({ rootDir: linkedRoot }), /refusing to follow a symbolic link/);

  const oversizedRoot = makeTempRoot(t);
  writeFile(oversizedRoot, 'data/reading.json');
  fs.truncateSync(path.join(oversizedRoot, 'data', 'reading.json'), MAX_READING_METADATA_BYTES + 1);
  assert.throws(() => readReadingData({ rootDir: oversizedRoot }), /exceeds the 2097152-byte limit/);
});

test('validation readers open every inspected source no-follow and nonblocking', async (t) => {
  const { readReadingData, sha256SafeCoverFile } = await import('../../scripts/audit-reading-metadata.mjs');
  const { collectExternalUrls } = await import('../../scripts/check-link-health.mjs');
  const { checkPerformanceBudget } = await import('../../scripts/check-performance-budget.mjs');
  const { collectTelemetryPolicyFindings } = await import('../../scripts/check-telemetry-policy.mjs');
  const rootDir = makeTempRoot(t);

  writePerformanceFixture(rootDir);
  writeFile(rootDir, 'data/reading.json', '[]');
  writeFile(rootDir, 'book/open-flags.jpg', 'cover');
  writeFile(rootDir, 'fixture.html', '<a href="https://public.example/path">public</a>');

  const opened = [];
  const openSync = (file, flags, ...args) => {
    opened.push({
      file: path.relative(rootDir, file).split(path.sep).join('/'),
      flags
    });
    return fs.openSync(file, flags, ...args);
  };

  assert.deepEqual(readReadingData({ rootDir, openSync }), []);
  assert.match(
    sha256SafeCoverFile(rootDir, 'book/open-flags.jpg', 'open flags cover', { openSync }),
    /^[a-f\d]{64}$/
  );
  const linkEntries = collectExternalUrls({
    rootDir,
    dataFiles: [],
    generatedHtmlFiles: ['fixture.html'],
    openSync
  });
  assert.deepEqual(linkEntries.map(({ ok, source, url }) => ({ ok, source, url })), [{
    ok: true,
    source: 'fixture.html:html:href',
    url: 'https://public.example/path'
  }]);
  assert.deepEqual(checkPerformanceBudget({ rootDir, openSync }).failures, []);
  assert.deepEqual(collectTelemetryPolicyFindings({
    rootDir,
    runtimeFiles: ['js/main.js'],
    openSync
  }), []);

  assert.deepEqual(opened.map(({ file }) => file), [
    'data/reading.json',
    'book/open-flags.jpg',
    'fixture.html',
    'reading.html',
    'js/main.js'
  ]);
  const requiredFlags = [
    ['O_NOFOLLOW', fs.constants.O_NOFOLLOW],
    ['O_NONBLOCK', fs.constants.O_NONBLOCK]
  ];
  requiredFlags.forEach(([name, flag]) => {
    assert.ok(Number.isInteger(flag) && flag > 0, `${name} must be available`);
    opened.forEach(({ file, flags }) => {
      assert.equal(flags & flag, flag, `${file} must use ${name}`);
    });
  });
});

test('cover hashing detects truncation, path replacement, and hard-link races', async (t) => {
  const { sha256SafeCoverFile } = await import('../../scripts/audit-reading-metadata.mjs');

  const truncatedRoot = makeTempRoot(t);
  writeFile(truncatedRoot, 'book/cover.jpg', Buffer.alloc(128 * 1024, 'a'));
  assert.throws(
    () => sha256SafeCoverFile(truncatedRoot, 'book/cover.jpg', 'race cover', {
      afterReadChunk: ({ absolutePath, totalBytes }) => {
        if (totalBytes === 64 * 1024) fs.truncateSync(absolutePath, 1);
      }
    }),
    /changed while it was being hashed/
  );

  const replacedRoot = makeTempRoot(t);
  writeFile(replacedRoot, 'book/cover.jpg', Buffer.alloc(128 * 1024, 'a'));
  let replaced = false;
  assert.throws(
    () => sha256SafeCoverFile(replacedRoot, 'book/cover.jpg', 'race cover', {
      afterReadChunk: ({ absolutePath }) => {
        if (replaced) return;
        replaced = true;
        fs.renameSync(absolutePath, `${absolutePath}.old`);
        fs.writeFileSync(absolutePath, Buffer.alloc(128 * 1024, 'b'));
      }
    }),
    /changed while it was being hashed/
  );

  const hardLinkRoot = makeTempRoot(t);
  const aliasRoot = makeTempRoot(t);
  const hardLinkContent = Buffer.alloc(128 * 1024, 'c');
  const hardLinkPath = path.join(hardLinkRoot, 'book', 'cover.jpg');
  const aliasPath = path.join(aliasRoot, 'cover-alias.jpg');
  writeFile(hardLinkRoot, 'book/cover.jpg', hardLinkContent);
  let aliasCreated = false;
  assert.throws(
    () => sha256SafeCoverFile(hardLinkRoot, 'book/cover.jpg', 'race cover', {
      afterReadChunk: ({ absolutePath }) => {
        if (aliasCreated) return;
        aliasCreated = true;
        fs.linkSync(absolutePath, aliasPath);
      }
    }),
    (error) => error.message === 'Unsafe race cover: cover must have exactly one hard link'
  );
  assert.equal(fs.readFileSync(hardLinkPath).equals(hardLinkContent), true);
  assert.equal(fs.readFileSync(aliasPath).equals(hardLinkContent), true);
  assert.equal(fs.lstatSync(hardLinkPath).nlink, 2);
  assert.equal(fs.lstatSync(aliasPath).nlink, 2);
});

test('performance budget check reports clean fixtures and oversized generated files', async (t) => {
  const { checkPerformanceBudget, collectRenderedAssetReferences, createAssetInventoryReport } = await import('../../scripts/check-performance-budget.mjs');
  const rootDir = makeTempRoot(t);

  writePerformanceFixture(rootDir);
  writeFile(rootDir, 'book/large-cover.jpg', Buffer.alloc(500, 'a'));
  writeFile(rootDir, 'book/large-cover-2x.jpg', Buffer.alloc(500, 'b'));
  writeFile(rootDir, 'reading.html', '<img src="book/large-cover.jpg" srcset="book/large-cover.jpg 1x, book/large-cover-2x.jpg 2x">');
  writeFile(rootDir, 'images/logo.png', Buffer.alloc(100, 'a'));
  assert.deepEqual(checkPerformanceBudget({ rootDir }).failures, []);
  assert.deepEqual(collectRenderedAssetReferences(fs.readFileSync(path.join(rootDir, 'reading.html'), 'utf8')), {
    references: ['book/large-cover.jpg', 'book/large-cover-2x.jpg'],
    highDpiReferences: ['book/large-cover-2x.jpg'],
    findings: []
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

test('performance budget rejects unreferenced deployed assets', async (t) => {
  const { checkPerformanceBudget, walkFiles } = await import('../../scripts/check-performance-budget.mjs');
  const rootDir = makeTempRoot(t);

  writePerformanceFixture(rootDir);
  writeFile(rootDir, 'css/bootstrap-grid.min.css', 'unused');
  writeFile(rootDir, 'js/bootstrap.bundle.min.js', 'unused');
  writeFile(rootDir, 'fonts/SF-Pro-Display-Black.otf', 'unused');
  writeFile(rootDir, 'book/large-original.jpg', Buffer.alloc(600 * 1024, 'a'));
  writeFile(rootDir, 'reading.html', '<img src="book/large-cover.jpg">');

  const result = checkPerformanceBudget({ rootDir });

  assert.ok(result.failures.some((failure) => failure.includes('css/bootstrap-grid.min.css')));
  assert.ok(result.failures.some((failure) => failure.includes('js/bootstrap.bundle.min.js')));
  assert.ok(result.failures.some((failure) => failure.includes('fonts/SF-Pro-Display-Black.otf')));
  assert.ok(result.failures.some((failure) => failure.includes('book/large-original.jpg')));
  assert.throws(() => walkFiles('book', { rootDir, maxEntries: 1 }), /inventory entry limit/);

  const outsideRoot = makeTempRoot(t);
  writeFile(outsideRoot, 'outside.png', 'outside');
  fs.symlinkSync(path.join(outsideRoot, 'outside.png'), path.join(rootDir, 'images', 'linked.png'));
  assert.throws(() => checkPerformanceBudget({ rootDir }), /must not be a symbolic link/);
});

test('performance parsing counts quoted and unquoted assets and fails closed on malformed attributes', async (t) => {
  const { checkPerformanceBudget, collectRenderedAssetReferences } = await import('../../scripts/check-performance-budget.mjs');
  const parsed = collectRenderedAssetReferences([
    "<img src='book/single.jpg'>",
    '<img src="book/double.jpg" srcset = \'book/one.jpg 1x, book/two.jpg 2x\'>',
    '<img src=book/unquoted.jpg>',
    "<img src='book/query.jpg?cache=1#cover'>"
  ].join(''));

  assert.deepEqual(parsed, {
    references: [
      'book/single.jpg',
      'book/double.jpg',
      'book/one.jpg',
      'book/two.jpg',
      'book/unquoted.jpg',
      'book/query.jpg'
    ],
    highDpiReferences: ['book/two.jpg'],
    findings: []
  });
  assert.match(
    collectRenderedAssetReferences("<img src='book/broken.jpg>").findings[0],
    /unterminated quoted value/
  );
  const hostile = collectRenderedAssetReferences([
    '<img/src=book/slash-recovered.jpg>',
    '<img src=book&#x2f;entity.jpg>',
    '<img src=book/%2e%2e/secret.jpg>',
    '<img src=book/%00control.jpg>',
    '<img src=book&#47missing-semicolon.jpg>',
    '<img src=book&unknown;bad.jpg>',
    `<img alt=" src='ignored" src="book/quote-state.jpg" data-end="'">`,
    `<!-- <img src="book/comment.jpg"> -->`,
    `<script>const fake = '<img src="book/script.jpg">';</script>`
  ].join(''));
  assert.deepEqual(hostile.references, [
    'book/slash-recovered.jpg',
    'book/entity.jpg',
    'book/missing-semicolon.jpg',
    'book/quote-state.jpg'
  ]);
  assert.equal(hostile.findings.length, 3);
  assert.ok(hostile.findings.some((finding) => finding.includes('dot segments')));
  assert.ok(hostile.findings.some((finding) => finding.includes('disallowed characters')));
  assert.ok(hostile.findings.some((finding) => finding.includes('character reference')));
  const excessiveReferences = collectRenderedAssetReferences(
    `<img srcset="${Array.from({ length: 5001 }, (_, index) => `book/${index}.jpg 1x`).join(',')}">`
  );
  assert.ok(excessiveReferences.findings.some((finding) => finding.includes('5000 entry limit')));

  const rootDir = makeTempRoot(t);
  writePerformanceFixture(rootDir);
  writeFile(rootDir, 'book/rendered-large.jpg', Buffer.alloc(13 * 1024 * 1024, 'a'));
  writeFile(rootDir, 'reading.html', "<img/src='book&#x2f;rendered-large.jpg?cache=1'>");
  assert.ok(
    checkPerformanceBudget({ rootDir }).failures.some((failure) => failure.includes('rendered reading media'))
  );

  writeFile(rootDir, 'reading.html', "<img src='book/broken.jpg>");
  assert.ok(
    checkPerformanceBudget({ rootDir }).failures.some((failure) => failure.includes('unterminated quoted value'))
  );

  writeFile(rootDir, 'reading.html', Buffer.alloc(1024 * 1024 + 1, 'a'));
  assert.ok(
    checkPerformanceBudget({ rootDir }).failures.some((failure) => failure.includes('exceeds the 1048576-byte limit'))
  );
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

test('link health preflight covers every authored data file and generated page without fetching', async (t) => {
  const { DATA_FILES, GENERATED_HTML_FILES, runLinkHealth } = await import('../../scripts/check-link-health.mjs');
  const rootDir = makeTempRoot(t);
  DATA_FILES.forEach((file, index) => {
    writeFile(rootDir, file, JSON.stringify({ url: `https://public.example/data-${index}` }));
  });
  GENERATED_HTML_FILES.forEach((file, index) => {
    writeFile(rootDir, file, `<a href='https://public.example/page-${index}'>page</a>`);
  });

  const results = await runLinkHealth({
    rootDir,
    preflightOnly: true,
    strict: true,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    requestImpl: () => {
      throw new Error('request should not run in preflight-only mode');
    }
  });

  assert.equal(results.length, DATA_FILES.length + GENERATED_HTML_FILES.length);
  assert.ok(results.every((result) => result.ok && result.category === 'preflight-ok'));
  DATA_FILES.concat(GENERATED_HTML_FILES).forEach((file) => {
    assert.ok(results.some((result) => result.source.includes(file)), `missing URL collection coverage for ${file}`);
  });
});

test('link collection reports unsafe URL-valued fields while preserving local relative links', async (t) => {
  const { collectExternalUrls } = await import('../../scripts/check-link-health.mjs');
  const rootDir = makeTempRoot(t);
  writeFile(rootDir, 'data/fixture.json', JSON.stringify({
    href: '#local-section',
    same_as: [
      'https://public.example/profile',
      '//private.example/profile'
    ],
    insecure_url: 'http://public.example/insecure',
    repository_url: 'https//public.example/missing-colon',
    callbackUrl: 'https://public.example/callback',
    sameAs: 'https://public.example/camel-case',
    nested: { link: { unexpected: true } }
  }));
  writeFile(rootDir, 'fixture.html', [
    '<a href="/local-page">local</a>',
    "<a href='http://public.example/insecure-html'>unsafe</a>",
    '<a href=https://public.example/unquoted>public</a>',
    '<a/href=https://public.example/slash-recovered>slash recovered</a>',
    '<a href="https&#58;//public.example/entity">entity</a>',
    `<a title=" href='ignored" href="https://public.example/quote-state" data-end="'">real</a>`,
    `<!-- <a href="https://public.example/comment">comment</a> -->`,
    `<script>const fake = '<a href="https://public.example/script">';</script>`,
    '<a href="jav&#x61;script:alert(1)">encoded script</a>',
    '<a href="&#x2f;&#x2f;private.example/encoded">encoded protocol relative</a>',
    '<a href="https:\\private.example/backslash">backslash</a>',
    '<a href="https://private.example/line\nbreak">control</a>',
    '<img srcset="https://public.example/one.png 1x, javascript:alert(1) 2x">',
    "<a href='https://broken.example>"
  ].join(''));

  const results = collectExternalUrls({
    rootDir,
    dataFiles: ['data/fixture.json'],
    generatedHtmlFiles: ['fixture.html']
  });

  assert.ok(results.some((result) => result.ok && result.url === 'https://public.example/profile'));
  assert.ok(results.some((result) => result.ok && result.url === 'https://public.example/unquoted'));
  assert.ok(results.some((result) => result.ok && result.url === 'https://public.example/slash-recovered'));
  assert.ok(results.some((result) => result.ok && result.url === 'https://public.example/entity'));
  assert.ok(results.some((result) => result.ok && result.url === 'https://public.example/quote-state'));
  assert.ok(results.some((result) => result.ok && result.url === 'https://public.example/callback'));
  assert.ok(results.some((result) => result.ok && result.url === 'https://public.example/camel-case'));
  assert.ok(results.some((result) => result.category === 'unsafe-url' && result.url.startsWith('http://')));
  assert.ok(results.some((result) => result.category === 'unsafe-url' && result.url.startsWith('//')));
  assert.ok(results.some((result) => result.category === 'invalid-url' && result.url.startsWith('https//')));
  assert.ok(results.some((result) => result.category === 'invalid-url' && result.detail.includes('must be a string')));
  assert.ok(results.some((result) => result.category === 'invalid-url' && result.detail.includes('unterminated')));
  assert.ok(results.some((result) => result.category === 'unsafe-url' && result.url.startsWith('javascript:')));
  assert.ok(results.some((result) => result.category === 'unsafe-url' && result.detail.includes('control or backslash')));
  assert.ok(!results.some((result) => result.url === '#local-section' || result.url === '/local-page'));
  assert.ok(!results.some((result) => result.url.includes('/comment') || result.url.includes('/script')));
});

test('link parsing rejects zero, oversized, deeply nested, and excessive inputs', async () => {
  const { collectJsonUrls, parseArgs, shouldFailLinkHealth } = await import('../../scripts/check-link-health.mjs');

  assert.throws(() => parseArgs(['--timeout-ms', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--timeout-ms', '60001']), /at most 60000/);
  assert.throws(() => parseArgs(['--timeout-ms', '10ms']), /positive integer/);
  assert.throws(
    () => collectJsonUrls({ nested: { nested: { url: 'https://public.example' } } }, 'fixture', [], { maxDepth: 1 }),
    /depth limit/
  );
  assert.throws(
    () => collectJsonUrls({ one_url: 'https://one.example', two_url: 'https://two.example' }, 'fixture', [], { maxReferences: 1 }),
    /entry limit/
  );
  assert.throws(
    () => collectJsonUrls({ first: 1, second: 2 }, 'fixture', [], { maxNodes: 2 }),
    /JSON node limit/
  );
  assert.equal(shouldFailLinkHealth([{ ok: false, category: 'timeout' }], true), true);
  assert.equal(shouldFailLinkHealth([{ ok: false, category: 'network-error' }], true), true);
  assert.equal(shouldFailLinkHealth([{ ok: false }], false), false);
});

test('link source parsing refuses symlinked and oversized files', async (t) => {
  const { collectExternalUrls } = await import('../../scripts/check-link-health.mjs');
  const outsideRoot = makeTempRoot(t);
  writeFile(outsideRoot, 'fixture.json', JSON.stringify({ url: 'https://public.example' }));
  const linkedRoot = makeTempRoot(t);
  fs.mkdirSync(path.join(linkedRoot, 'data'));
  fs.symlinkSync(path.join(outsideRoot, 'fixture.json'), path.join(linkedRoot, 'data', 'fixture.json'));
  assert.throws(
    () => collectExternalUrls({ rootDir: linkedRoot, dataFiles: ['data/fixture.json'], generatedHtmlFiles: [] }),
    /refusing to follow a symbolic link/
  );

  const parentLinkedRoot = makeTempRoot(t);
  fs.symlinkSync(outsideRoot, path.join(parentLinkedRoot, 'data'));
  assert.throws(
    () => collectExternalUrls({ rootDir: parentLinkedRoot, dataFiles: ['data/fixture.json'], generatedHtmlFiles: [] }),
    /refusing symbolic link parent directory/
  );

  const oversizedRoot = makeTempRoot(t);
  writeFile(oversizedRoot, 'fixture.html');
  fs.truncateSync(path.join(oversizedRoot, 'fixture.html'), 2 * 1024 * 1024 + 1);
  assert.throws(
    () => collectExternalUrls({ rootDir: oversizedRoot, dataFiles: [], generatedHtmlFiles: ['fixture.html'] }),
    /exceeds the 2097152-byte limit/
  );
});

test('link health binds the approved DNS address to the TLS request', async () => {
  const { requestWithTimeout } = await import('../../scripts/check-link-health.mjs');

  let requestOptions;
  let responseDestroyCount = 0;
  const response = await requestWithTimeout({
    url: 'https://public.example/status',
    hostname: 'public.example',
    records: [{ address: '93.184.216.34', family: 4 }]
  }, {
    method: 'HEAD',
    timeoutMs: 1000,
    requestImpl: (_url, options, onResponse) => {
      requestOptions = options;
      return {
        setTimeout() {},
        once() {},
        destroy() {},
        end() {
          onResponse({
            statusCode: 204,
            statusMessage: 'No Content',
            resume() {
              throw new Error('bounded status checks must not drain response bodies');
            },
            destroy() { responseDestroyCount += 1; }
          });
        }
      };
    }
  });
  assert.deepEqual(response, { status: 204, statusText: 'No Content' });
  assert.equal(requestOptions.servername, 'public.example');
  assert.equal(requestOptions.agent, false);
  assert.equal(requestOptions.headers.range, 'bytes=0-0');
  assert.equal(typeof requestOptions.lookup, 'function');
  assert.equal(responseDestroyCount, 1);

  await assert.rejects(
    () => new Promise((resolve, reject) => {
      requestOptions.lookup('substituted.example', {}, (error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
    /hostname changed after validation/
  );
});

test('requestWithTimeout rejects with an AbortError when the socket exceeds the deadline', { timeout: 1000 }, async () => {
  const { requestWithTimeout } = await import('../../scripts/check-link-health.mjs');
  let errorHandler;
  let destroyCount = 0;
  const mockRequest = {
    once(event, cb) { if (event === 'error') errorHandler = cb; },
    destroy(error) {
      destroyCount += 1;
      errorHandler?.(error);
    },
    end() {}
  };

  await assert.rejects(
    () => requestWithTimeout({
      url: 'https://public.example/status',
      hostname: 'public.example',
      records: [{ address: '93.184.216.34', family: 4 }]
    }, {
      method: 'HEAD',
      timeoutMs: 20,
      requestImpl: () => mockRequest
    }),
    (error) => error.name === 'AbortError' && /timed out after 20ms/.test(error.message)
  );
  assert.equal(destroyCount, 1);
});

test('link health bounds stalled DNS with the configured wall deadline', { timeout: 1000 }, async () => {
  const { runLinkHealth } = await import('../../scripts/check-link-health.mjs');
  const results = await runLinkHealth({
    entries: [{ ok: true, source: 'fixture', url: 'https://stalled.example/' }],
    preflightOnly: true,
    timeoutMs: 20,
    lookupImpl: async () => await new Promise(() => {})
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].category, 'timeout');
  assert.match(results[0].detail, /DNS preflight timed out after 20ms/);
});

test('requestWithTimeout propagates transport errors from the underlying request', async () => {
  const { requestWithTimeout } = await import('../../scripts/check-link-health.mjs');
  let errorHandler;
  const mockRequest = {
    setTimeout() {},
    once(event, cb) { if (event === 'error') errorHandler = cb; },
    destroy() {},
    end() { errorHandler(new Error('socket hang up')); }
  };

  await assert.rejects(
    () => requestWithTimeout({
      url: 'https://public.example/status',
      hostname: 'public.example',
      records: [{ address: '93.184.216.34', family: 4 }]
    }, {
      method: 'GET',
      timeoutMs: 1000,
      requestImpl: () => mockRequest
    }),
    /socket hang up/
  );
});

test('repository hygiene detects junk files in git-visible paths', async () => {
  const { isJunkPath } = await import('../../scripts/check-repository-hygiene.mjs');

  assert.equal(isJunkPath('.github/workflows/.DS_Store'), true);
  assert.equal(isJunkPath('notes/debug.log'), true);
  assert.equal(isJunkPath('src/index.html'), false);
});

test('repository hygiene detects ignored junk files in authored directories', async (t) => {
  const { collectRepositoryHygieneFindings } = await import('../../scripts/check-repository-hygiene.mjs');
  const rootDir = makeTempRoot(t);

  writeFile(rootDir, '.gitignore', '.DS_Store\nnode_modules/\n');
  writeFile(rootDir, '.github/workflows/.DS_Store');
  writeFile(rootDir, 'docs/.DS_Store');
  writeFile(rootDir, 'node_modules/.DS_Store');
  writeFile(rootDir, 'src/index.html', '<main></main>');
  execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });

  const findings = collectRepositoryHygieneFindings({ cwd: rootDir });

  assert.deepEqual(findings, [
    '.github/workflows/.DS_Store',
    'docs/.DS_Store'
  ]);
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

test('production smoke arguments require an HTTPS public origin and positive bounded controls', async () => {
  const { PAGE_CHECKS, parseArgs } = await import('../../scripts/check-production-smoke.mjs');

  assert.deepEqual(parseArgs([], {}), {
    origin: 'https://leonardwong.tech',
    timeoutMs: 10000,
    attempts: 6,
    retryDelayMs: 10000
  });
  assert.throws(() => parseArgs(['--origin', 'http://example.com'], {}), /only https URLs/);
  assert.throws(() => parseArgs(['--origin', 'https://localhost'], {}), /local\/private/);
  assert.throws(() => parseArgs(['--origin', 'https://example.com/path'], {}), /must not include a path/);
  assert.throws(() => parseArgs(['--attempts', '0'], {}), /positive integer/);
  assert.throws(() => parseArgs(['--attempts', '11'], {}), /at most 10/);
  assert.throws(() => parseArgs(['--timeout-ms', '10ms'], {}), /positive integer/);
  assert.throws(() => parseArgs([], { SMOKE_RETRY_DELAY_MS: '-1' }), /positive integer/);
  assert.deepEqual(
    PAGE_CHECKS.map((check) => check.path),
    ['/', '/work', '/case-study-agentforge', '/reading', '/offline']
  );
});

test('production smoke fetch rejects redirects, oversized bodies, and stalled body reads', { timeout: 1000 }, async () => {
  const { fetchTextWithTimeout } = await import('../../scripts/check-production-smoke.mjs');
  let fetchOptions;
  await assert.rejects(
    () => fetchTextWithTimeout('https://public.example/page', {
      timeoutMs: 100,
      fetchImpl: async (_url, options) => {
        fetchOptions = options;
        return {
          status: 302,
          redirected: false,
          headers: new Headers({ location: 'https://public.example/other' }),
          text: async () => ''
        };
      }
    }),
    /redirects are not allowed/
  );
  assert.equal(fetchOptions.redirect, 'error');

  await assert.rejects(
    () => fetchTextWithTimeout('https://public.example/page', {
      timeoutMs: 100,
      maxBodyBytes: 4,
      fetchImpl: async () => new Response('12345')
    }),
    /exceeds 4 byte limit/
  );

  let stalledSignal;
  let rejectStalledRead;
  let bodyCancelCount = 0;
  let bodyReleaseCount = 0;
  await assert.rejects(
    () => fetchTextWithTimeout('https://public.example/page', {
      timeoutMs: 20,
      fetchImpl: async (_url, options) => {
        stalledSignal = options.signal;
        return {
          status: 200,
          redirected: false,
          headers: new Headers(),
          body: {
            getReader: () => ({
              read: async () => await new Promise((resolve, reject) => {
                rejectStalledRead = reject;
              }),
              cancel: async (reason) => {
                bodyCancelCount += 1;
                rejectStalledRead(reason);
              },
              releaseLock: () => {
                bodyReleaseCount += 1;
              }
            })
          }
        };
      }
    }),
    (error) => error.name === 'AbortError' && /timed out after 20ms/.test(error.message)
  );
  assert.equal(stalledSignal.aborted, true);
  assert.equal(bodyCancelCount, 1);
  assert.equal(bodyReleaseCount, 1);
});

test('production smoke validates public DNS and fetches every page at least once', async () => {
  const { PAGE_CHECKS, runProductionSmoke } = await import('../../scripts/check-production-smoke.mjs');
  let fetchCount = 0;
  const requestedPaths = [];
  const markers = new Map([
    ['/', 'Leonard Wong'],
    ['/work', 'Project Archive'],
    ['/case-study-agentforge', 'AgentForge Merge Guard'],
    ['/reading', 'Reading'],
    ['/offline', 'Offline']
  ]);
  const options = {
    origin: 'https://public.example',
    timeoutMs: 100,
    attempts: 1,
    retryDelayMs: 1,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      fetchCount += 1;
      const pathname = new URL(url).pathname;
      requestedPaths.push(pathname);
      const marker = markers.get(pathname);
      if (!marker) throw new Error(`unexpected production path ${pathname}`);
      return new Response(`<main>${marker}</main>`, {
        status: 200,
        headers: {
          'content-security-policy': "default-src 'self'",
          'strict-transport-security': 'max-age=31536000',
          'x-content-type-options': 'nosniff'
        }
      });
    }
  };

  await assert.rejects(
    () => runProductionSmoke({ ...options, attempts: 0 }),
    /positive integer/
  );
  assert.equal(fetchCount, 0);
  assert.deepEqual(await runProductionSmoke(options), []);
  assert.equal(fetchCount, PAGE_CHECKS.length);
  assert.deepEqual(requestedPaths, [...markers.keys()]);

  await assert.rejects(
    () => runProductionSmoke({
      ...options,
      lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }]
    }),
    /resolved to blocked address/
  );

  let retryRequestCount = 0;
  let retrySleepCount = 0;
  const retryResult = await runProductionSmoke({
    ...options,
    attempts: 2,
    sleepImpl: async () => { retrySleepCount += 1; },
    fetchImpl: async (url) => {
      retryRequestCount += 1;
      const pathname = new URL(url).pathname;
      const marker = markers.get(pathname);
      if (!marker) throw new Error(`unexpected production path ${pathname}`);
      return new Response(
        retryRequestCount <= PAGE_CHECKS.length ? '<main>not ready</main>' : `<main>${marker}</main>`,
        {
          status: retryRequestCount <= PAGE_CHECKS.length ? 503 : 200,
          headers: {
            'content-security-policy': "default-src 'self'",
            'strict-transport-security': 'max-age=31536000',
            'x-content-type-options': 'nosniff'
          }
        }
      );
    }
  });
  assert.deepEqual(retryResult, []);
  assert.equal(retryRequestCount, PAGE_CHECKS.length * 2);
  assert.equal(retrySleepCount, 1);
});

test('production smoke default transport pins each approved DNS answer into the request', async () => {
  const { PAGE_CHECKS, runProductionSmoke } = await import('../../scripts/check-production-smoke.mjs');
  let resolverCalls = 0;
  let requestCalls = 0;
  let pinnedLookupCalls = 0;
  const requestedPaths = [];
  const markers = new Map([
    ['/', 'Leonard Wong'],
    ['/work', 'Project Archive'],
    ['/case-study-agentforge', 'AgentForge Merge Guard'],
    ['/reading', 'Reading'],
    ['/offline', 'Offline']
  ]);
  const findings = await runProductionSmoke({
    origin: 'https://public.example',
    timeoutMs: 100,
    attempts: 1,
    retryDelayMs: 1,
    sleepImpl: async () => {},
    lookupImpl: async () => {
      resolverCalls += 1;
      return [{ address: '93.184.216.34', family: 4 }];
    },
    requestImpl: (rawUrl, options, onResponse) => {
      requestCalls += 1;
      assert.equal(options.servername, 'public.example');
      assert.equal(options.agent, false);
      const request = new EventEmitter();
      request.destroy = () => {};
      request.end = () => {
        options.lookup('substituted.example', {}, (error) => {
          assert.match(error?.message || '', /hostname changed after validation/);
        });
        options.lookup('public.example', { family: 4 }, (error, address, family) => {
          assert.ifError(error);
          pinnedLookupCalls += 1;
          assert.deepEqual({ address, family }, { address: '93.184.216.34', family: 4 });
          const pathname = new URL(rawUrl).pathname;
          requestedPaths.push(pathname);
          const marker = markers.get(pathname);
          if (!marker) throw new Error(`unexpected production path ${pathname}`);
          const response = Readable.from([Buffer.from(`<main>${marker}</main>`)]);
          response.statusCode = 200;
          response.statusMessage = 'OK';
          response.headers = {
            'content-security-policy': "default-src 'self'",
            'strict-transport-security': 'max-age=31536000',
            'x-content-type-options': 'nosniff'
          };
          onResponse(response);
        });
      };
      return request;
    }
  });

  assert.deepEqual(findings, []);
  assert.equal(resolverCalls, PAGE_CHECKS.length);
  assert.equal(requestCalls, PAGE_CHECKS.length);
  assert.equal(pinnedLookupCalls, PAGE_CHECKS.length);
  assert.deepEqual(requestedPaths, [...markers.keys()]);
});

test('telemetry policy validates real event calls and detects aliased network adapters', async (t) => {
  const { collectTelemetryPolicyFindings, inspectRuntimeSource } = await import('../../scripts/check-telemetry-policy.mjs');
  const rootDir = makeTempRoot(t);
  writeFile(rootDir, 'js/main.js', `
    const TELEMETRY_ALLOWED_EVENTS = new Set(['portfolio_action_clicked']);
    function trackEvent(eventName) {
      if (!TELEMETRY_ALLOWED_EVENTS.has(eventName)) return;
    }
    const eventName = 'portfolio_action_clicked';
    trackEvent(eventName);
    trackEvent('portfolio_action_clicked');
  `);
  writeFile(rootDir, 'js/site.js', `
    // Mentioning fetch or sendBeacon in documentation is not an adapter.
    const documentation = 'fetch and sendBeacon are prohibited';
    const documentationPattern = /fetch|sendBeacon|Image|WebSocket|EventSource/;
  `);
  assert.deepEqual(collectTelemetryPolicyFindings({ rootDir }), []);
  assert.deepEqual(inspectRuntimeSource('const documentationPattern = /fetch|sendBeacon|Image/;'), []);
  assert.deepEqual(inspectRuntimeSource('const msg = `prefetched ${count} records`;'), []);
  assert.deepEqual(inspectRuntimeSource('const msg = `rendered ${imageCount} covers`;'), []);
  assert.deepEqual(inspectRuntimeSource('const msg = `opening ${websocketStatus} panel`;'), []);
  assert.deepEqual(inspectRuntimeSource([
    "const TELEMETRY_ALLOWED_EVENTS = new Set(['portfolio_action_clicked']);",
    'function trackEvent(eventName) { if (!TELEMETRY_ALLOWED_EVENTS.has(eventName)) return; }',
    'const message = `${trackEvent(getEventName())}`;'
  ].join('\n')), []);

  writeFile(rootDir, 'js/main.js', `
    const TELEMETRY_ALLOWED_EVENTS = new Set([
      'portfolio_action_clicked',
      'silent_exfiltration'
    ]);
    function trackEvent(eventName) { return eventName; }
    const request = globalThis['fe' + 'tch'];
    const beacon = navigator['sendBeacon'];
    const dynamicAdapter = globalThis[adapterName];
    const reflectedAdapter = Reflect.get(globalThis, 'fetch');
    const escapedAdapter = globalThis.f\\u0065tch;
    const templateAdapter = globalThis[\`fetch\`];
    const imageBeacon = new Image();
    const socket = new WebSocket('/collect');
    const stream = new EventSource('/collect');
    const emit = trackEvent;
    request('/collect');
    beacon('/collect', 'payload');
    trackEvent('silent_exfiltration');
    emit('aliased_exfiltration');
    trackEvent(getEventName());
    TELEMETRY_ALLOWED_EVENTS.add('late_mutation');
  `);
  const findings = collectTelemetryPolicyFindings({ rootDir });

  assert.ok(findings.some((finding) => finding.includes('reference fetch')));
  assert.ok(findings.some((finding) => finding.includes('reference sendBeacon')));
  assert.ok(findings.some((finding) => finding.includes('dynamic network-capable global property access')));
  assert.ok(findings.some((finding) => finding.includes('Image beacon')));
  assert.ok(findings.some((finding) => finding.includes('WebSocket')));
  assert.ok(findings.some((finding) => finding.includes('EventSource')));
  assert.ok(findings.some((finding) => finding.includes('must not be mutated')));
  assert.ok(findings.some((finding) => finding.includes('silent_exfiltration') && finding.includes('runtime allowlist')));
  assert.ok(findings.some((finding) => finding.includes('silent_exfiltration') && finding.includes('trackEvent call')));
  assert.ok(findings.some((finding) => finding.includes('aliased_exfiltration') && finding.includes('trackEvent call')));
  assert.ok(findings.some((finding) => finding.includes('dynamic telemetry event name')));

  const adapterSpellings = [
    ['escaped identifier', 'globalThis.f\\u0065tch("/collect")', 'reference fetch'],
    ['escaped leading identifier', 'globalThis.\\u0066etch("/collect")', 'reference fetch'],
    ['static template property', 'globalThis[`fetch`]("/collect")', 'reference fetch'],
    ['reflected property', 'Reflect.get(globalThis, "fetch")("/collect")', 'reference fetch'],
    ['dynamic global property', 'const key = "fetch"; globalThis[key]("/collect")', 'dynamic network-capable'],
    ['template expression', 'const leak = `${globalThis.fetch("/collect")}`', 'reference fetch'],
    ['obfuscated template expression', 'const leak = `${globalThis["fe"+"tch"]("/collect")}`', 'reference fetch'],
    ['global alias dynamic property', 'const g=globalThis; const key=["f","e","t","c","h"].join(""); g[key]("/collect")', 'dynamic network-capable'],
    ['line-continuation property', ["globalThis['fe\\", "tch']('/collect')"].join('\n'), 'reference fetch']
  ];
  adapterSpellings.forEach(([name, source, expected]) => {
    assert.ok(
      inspectRuntimeSource(source).some((finding) => finding.includes(expected)),
      `${name} must be rejected`
    );
  });
  assert.throws(
    () => inspectRuntimeSource("globalThis['f\\145tch']('/collect')"),
    /legacy octal/
  );

  const noOpGuard = inspectRuntimeSource(`
    const TELEMETRY_ALLOWED_EVENTS = new Set(['portfolio_action_clicked']);
    function trackEvent(eventName) { TELEMETRY_ALLOWED_EVENTS.has(eventName); }
    trackEvent(getEventName());
  `);
  assert.ok(noOpGuard.some((finding) => finding.includes('dynamic telemetry event name')));
  const conditionalGuard = inspectRuntimeSource(`
    const TELEMETRY_ALLOWED_EVENTS = new Set(['portfolio_action_clicked']);
    function trackEvent(eventName) { if (!TELEMETRY_ALLOWED_EVENTS.has(eventName) && false) return; }
    trackEvent(getEventName());
  `);
  assert.ok(conditionalGuard.some((finding) => finding.includes('dynamic telemetry event name')));
  const nestedReturnGuard = inspectRuntimeSource(`
    const TELEMETRY_ALLOWED_EVENTS = new Set(['portfolio_action_clicked']);
    function trackEvent(eventName) { if (!TELEMETRY_ALLOWED_EVENTS.has(eventName)) { if (false) return; } }
    trackEvent(getEventName());
  `);
  assert.ok(nestedReturnGuard.some((finding) => finding.includes('dynamic telemetry event name')));
  [
    '!TELEMETRY_ALLOWED_EVENTS.has(eventName) === false',
    '(!TELEMETRY_ALLOWED_EVENTS.has(eventName), false)',
    '!TELEMETRY_ALLOWED_EVENTS.has(eventName) ? false : true'
  ].forEach((condition) => {
    const unsoundGuard = inspectRuntimeSource(`
      const TELEMETRY_ALLOWED_EVENTS = new Set(['portfolio_action_clicked']);
      function trackEvent(eventName) { if (${condition}) return; }
      trackEvent(getEventName());
    `);
    assert.ok(unsoundGuard.some((finding) => finding.includes('dynamic telemetry event name')));
  });
  assert.throws(() => inspectRuntimeSource('a;'.repeat(50001)), /token limit/);
});

test('telemetry source scanning refuses symlinks and oversized runtime files', async (t) => {
  const { collectTelemetryPolicyFindings } = await import('../../scripts/check-telemetry-policy.mjs');
  const outsideRoot = makeTempRoot(t);
  writeFile(outsideRoot, 'main.js', 'fetch("/collect")');
  const linkedRoot = makeTempRoot(t);
  fs.mkdirSync(path.join(linkedRoot, 'js'));
  fs.symlinkSync(path.join(outsideRoot, 'main.js'), path.join(linkedRoot, 'js', 'main.js'));
  const linkedFindings = collectTelemetryPolicyFindings({ rootDir: linkedRoot, runtimeFiles: ['js/main.js'] });
  assert.ok(linkedFindings.some((finding) => finding.includes('refusing to follow a symbolic link')));

  const oversizedRoot = makeTempRoot(t);
  writeFile(oversizedRoot, 'js/main.js');
  fs.truncateSync(path.join(oversizedRoot, 'js', 'main.js'), 512 * 1024 + 1);
  const oversizedFindings = collectTelemetryPolicyFindings({ rootDir: oversizedRoot, runtimeFiles: ['js/main.js'] });
  assert.ok(oversizedFindings.some((finding) => finding.includes('exceeds the 524288-byte limit')));
});
