import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  buildResume,
  computeBytesSha256,
  computeResumeHtmlHash,
  exportDocx,
  exportPdf,
  getResumePaths,
  loadResumeData,
  MAX_PANDOC_DIAGNOSTIC_BYTES,
  MAX_RESUME_EXPORT_TIMEOUT_MS,
  MAX_RESUME_SOURCE_BYTES,
  parseArgs,
  renderResumeHtml,
  ResumeExportTimeoutError,
  validateResumeData,
  validateResumeSources,
  withResumeBuildLock
} from '../../scripts/build-resume.mjs';
import {
  checkResumeFreshness,
  MAX_MANIFEST_BYTES,
  MAX_PDF_BYTES,
  validateDocxBytes,
  validatePdfBytes
} from '../../scripts/check-resume-freshness.mjs';

const require = createRequire(import.meta.url);
const { writeFileNoFollow } = require('../../scripts/lib/safe-output.cjs');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const trackedTemporaryRoots = new Set();

function validResume() {
  return {
    name: 'Example Person',
    title: 'Software Engineer · AI & Agentic Development',
    location: 'Singapore',
    contact: {
      email: 'me@example.com',
      phone: '+65 0000 0000',
      links: [{ label: 'example.com', url: 'https://example.com' }]
    },
    summary: 'AI and agentic development on secure platforms.',
    ai_highlights: { heading: 'AI & Agentic Highlights', items: ['Agentic development.'] },
    section_order: ['summary', 'ai_highlights', 'skills']
  };
}

function minimalData(resume) {
  return {
    resume,
    profile: { education: [], publication: {} },
    experience: [],
    skills: [],
    certifications: []
  };
}

function makeFixture({ includeDocs = true } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'));
  trackedTemporaryRoots.add(rootDir);
  fs.cpSync(path.join(projectRoot, 'data'), path.join(rootDir, 'data'), { recursive: true });
  if (includeDocs) {
    fs.mkdirSync(path.join(rootDir, 'docs'), { recursive: true });
    for (const name of ['resume.manifest.json', 'resume.pdf', 'resume.docx']) {
      fs.copyFileSync(path.join(projectRoot, 'docs', name), path.join(rootDir, 'docs', name));
    }
  }
  return rootDir;
}

function cleanupFixture(rootDir) {
  fs.rmSync(rootDir, { recursive: true, force: true });
  trackedTemporaryRoots.delete(rootDir);
}

function issueFor(result, code, artifact) {
  return result.issues.find((issue) => issue.code === code && (!artifact || issue.artifact === artifact));
}

function assertIssue(result, code, artifact) {
  const issue = issueFor(result, code, artifact);
  assert.ok(issue, `Expected ${code} for ${artifact || 'any artifact'}:\n${result.failures.join('\n')}`);
  return issue;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createManualDeadline() {
  const handle = Symbol('manual exporter deadline');
  let callback;
  let timeoutMs;
  let clearCalls = 0;
  return {
    setTimeoutImpl(nextCallback, nextTimeoutMs) {
      assert.equal(callback, undefined, 'only one end-to-end deadline is scheduled');
      callback = nextCallback;
      timeoutMs = nextTimeoutMs;
      return handle;
    },
    clearTimeoutImpl(receivedHandle) {
      assert.equal(receivedHandle, handle);
      clearCalls += 1;
    },
    fire() {
      assert.equal(typeof callback, 'function', 'deadline was armed before exporter work');
      callback();
    },
    get timeoutMs() {
      return timeoutMs;
    },
    get clearCalls() {
      return clearCalls;
    }
  };
}

function snapshotFile(filePath) {
  try {
    return { exists: true, bytes: fs.readFileSync(filePath) };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, bytes: null };
    throw error;
  }
}

function assertSnapshot(filePath, snapshot) {
  if (!snapshot.exists) {
    assert.equal(fs.existsSync(filePath), false, `${filePath} remains absent`);
    return;
  }
  assert.deepEqual(fs.readFileSync(filePath), snapshot.bytes, `${filePath} was restored byte-for-byte`);
}

function mutateDocxPayload(bytes) {
  const changed = Buffer.from(bytes);
  assert.equal(changed.readUInt32LE(0), 0x04034b50, 'fixture starts with a ZIP local header');
  const nameLength = changed.readUInt16LE(26);
  const extraLength = changed.readUInt16LE(28);
  const dataOffset = 30 + nameLength + extraLength;
  assert.ok(dataOffset < changed.length, 'fixture has compressed entry data');
  changed[dataOffset] ^= 0x01;
  return changed;
}

function replaceAsciiEverywhere(bytes, from, to) {
  assert.equal(Buffer.byteLength(from), Buffer.byteLength(to), 'replacement preserves ZIP offsets');
  const changed = Buffer.from(bytes);
  const needle = Buffer.from(from, 'ascii');
  const replacement = Buffer.from(to, 'ascii');
  let count = 0;
  let offset = 0;
  while ((offset = changed.indexOf(needle, offset)) >= 0) {
    replacement.copy(changed, offset);
    offset += replacement.length;
    count += 1;
  }
  return { bytes: changed, count };
}

test.after(() => {
  for (const rootDir of trackedTemporaryRoots) cleanupFixture(rootDir);
});

test('validateResumeData accepts its contract and rejects distinct malformed boundaries', () => {
  assert.doesNotThrow(() => validateResumeData(validResume()));

  const cases = [
    {
      name: 'unknown top-level key',
      mutate: (resume) => { resume.unexpected = 'value'; },
      error: /unexpected key\(s\): unexpected/
    },
    {
      name: 'missing required name',
      mutate: (resume) => { delete resume.name; },
      error: /resume\.name/
    },
    {
      name: 'blank required title',
      mutate: (resume) => { resume.title = '   '; },
      error: /resume\.title: expected a non-empty string/
    },
    {
      name: 'active-content contact link',
      mutate: (resume) => { resume.contact.links[0].url = 'javascript:alert(1)'; },
      error: /only https URLs are allowed|malformed URL/
    },
    {
      name: 'unknown section',
      mutate: (resume) => { resume.section_order = ['summary', 'bogus']; },
      error: /unknown section "bogus"/
    },
    {
      name: 'duplicate section',
      mutate: (resume) => { resume.section_order = ['summary', 'skills', 'summary']; },
      error: /duplicate section "summary"/
    },
    {
      name: 'empty AI highlights',
      mutate: (resume) => { resume.ai_highlights.items = []; },
      error: /at least 1 item/
    }
  ];

  for (const entry of cases) {
    const resume = validResume();
    entry.mutate(resume);
    assert.throws(() => validateResumeData(resume), entry.error, entry.name);
  }
});

test('validateResumeSources applies every shared website-data validator', () => {
  const baseline = loadResumeData();
  assert.doesNotThrow(() => validateResumeSources(structuredClone(baseline)));

  const cases = [
    ['profile', (data) => { data.profile.education[0].institution = ''; }, /profile\.education\[0\]\.institution/],
    ['skills', (data) => { data.skills = []; }, /skills/],
    ['experience', (data) => { data.experience = []; }, /experience/],
    ['certifications', (data) => { data.certifications = []; }, /certifications/]
  ];
  for (const [name, mutate, error] of cases) {
    const data = structuredClone(baseline);
    mutate(data);
    assert.throws(() => validateResumeSources(data), error, name);
  }
});

test('loadResumeData rejects malformed, linked, non-regular, and oversized source files', () => {
  const cases = [
    {
      name: 'symlink',
      mutate(rootDir) {
        const file = path.join(rootDir, 'data/resume.json');
        fs.unlinkSync(file);
        fs.symlinkSync(path.join(projectRoot, 'data/resume.json'), file);
      },
      error: /symbolic link/
    },
    {
      name: 'non-regular file',
      mutate(rootDir) {
        const file = path.join(rootDir, 'data/skills.json');
        fs.unlinkSync(file);
        fs.mkdirSync(file);
      },
      error: /expected a regular file/
    },
    {
      name: 'oversized file',
      mutate(rootDir) {
        fs.truncateSync(path.join(rootDir, 'data/profile.json'), MAX_RESUME_SOURCE_BYTES + 1);
      },
      error: /exceeds the 524288-byte limit/
    },
    {
      name: 'malformed UTF-8 JSON',
      mutate(rootDir) {
        fs.writeFileSync(path.join(rootDir, 'data/certifications.json'), Buffer.from([0xff, 0xfe]));
      },
      error: /Invalid JSON in resume source data\/certifications\.json/
    }
  ];

  for (const entry of cases) {
    const rootDir = makeFixture({ includeDocs: false });
    try {
      entry.mutate(rootDir);
      assert.throws(() => loadResumeData({ rootDir }), entry.error, entry.name);
    } finally {
      cleanupFixture(rootDir);
    }
  }
});

test('resume CLI parser accepts only one valueless --html-only flag', () => {
  assert.deepEqual(parseArgs([]), { htmlOnly: false });
  assert.deepEqual(parseArgs(['--html-only']), { htmlOnly: true });
  const cases = [
    [['--html-only', '--html-only'], /Duplicate argument/],
    [['--html-only=true'], /does not accept a value/],
    [['--'], /Missing argument after --/],
    [['--bogus'], /Unknown argument/],
    [['positional'], /Unknown argument/],
    [[''], /non-empty strings/]
  ];
  for (const [argv, error] of cases) assert.throws(() => parseArgs(argv), error);
});

test('standalone build and freshness fail closed on malformed shared sources', async () => {
  const rootDir = makeFixture();
  try {
    const skillsPath = path.join(rootDir, 'data/skills.json');
    const skills = JSON.parse(fs.readFileSync(skillsPath, 'utf8'));
    skills[0].items = [];
    fs.writeFileSync(skillsPath, `${JSON.stringify(skills, null, 2)}\n`);

    const freshness = checkResumeFreshness({ rootDir });
    assertIssue(freshness, 'SOURCE_INVALID', 'data');

    await assert.rejects(
      buildResume({ rootDir, htmlOnly: true, log: () => {} }),
      /Invalid data at skills\[0\]\.items/
    );
    const paths = getResumePaths(rootDir);
    assert.equal(fs.existsSync(paths.htmlOutPath), false, 'invalid data is not published');
    assert.equal(fs.existsSync(paths.buildLockPath), false, 'build lock is released after validation failure');
  } finally {
    cleanupFixture(rootDir);
  }
});

test('rendered resume escapes fields and the default AI heading exactly once', () => {
  const unsafeData = minimalData({
    name: '</style><script>alert(1)</script>',
    title: 'Engineer',
    contact: {},
    summary: '<img src=x onerror=alert(1)>',
    section_order: ['summary']
  });
  const unsafeHtml = renderResumeHtml(unsafeData);
  assert.doesNotMatch(unsafeHtml, /<script>alert\(1\)<\/script>/);
  assert.match(unsafeHtml, /&lt;script&gt;/);
  assert.doesNotMatch(unsafeHtml, /<img src=x onerror/);

  const resume = validResume();
  delete resume.ai_highlights.heading;
  const defaultHeadingHtml = renderResumeHtml(minimalData(resume));
  assert.match(defaultHeadingHtml, /<h2 class="ai-callout__head">AI &amp; Agentic Highlights<\/h2>/);
  assert.doesNotMatch(defaultHeadingHtml, /AI &amp;amp; Agentic Highlights/);
});

test('computeResumeHtmlHash is deterministic and content-sensitive', () => {
  const data = minimalData(validResume());
  const first = computeResumeHtmlHash(renderResumeHtml(data));
  const second = computeResumeHtmlHash(renderResumeHtml(data));
  assert.equal(first, second);
  assert.match(first, /^sha256-[0-9a-f]{64}$/);

  const changed = minimalData(validResume());
  changed.resume.summary = 'A different summary entirely.';
  assert.notEqual(first, computeResumeHtmlHash(renderResumeHtml(changed)));
});

test('current committed resume bundle passes the end-to-end freshness boundary', () => {
  const result = checkResumeFreshness();
  assert.ok(result.ok, result.failures.join('\n'));
});

test('freshness returns structured failures for malformed and non-strict manifests', () => {
  const rootDir = makeFixture();
  const manifestPath = path.join(rootDir, 'docs/resume.manifest.json');
  const validManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  try {
    fs.writeFileSync(manifestPath, '{');
    assertIssue(checkResumeFreshness({ rootDir }), 'MANIFEST_PARSE', 'docs/resume.manifest.json');

    const cases = [
      ['null manifest', null],
      ['array manifest', []],
      ['missing key', (() => { const value = structuredClone(validManifest); delete value.docxSha256; return value; })()],
      ['unexpected key', { ...validManifest, unexpected: true }],
      ['reordered sources', { ...validManifest, sources: [...validManifest.sources].reverse() }],
      ['uppercase hash', { ...validManifest, pdfSha256: validManifest.pdfSha256.toUpperCase() }]
    ];
    for (const [name, value] of cases) {
      fs.writeFileSync(manifestPath, `${JSON.stringify(value)}\n`);
      const result = checkResumeFreshness({ rootDir });
      assert.ok(issueFor(result, 'MANIFEST_SCHEMA'), `${name}: ${result.failures.join('\n')}`);
    }
  } finally {
    cleanupFixture(rootDir);
  }
});

test('freshness detects a source edit without artifact regeneration', () => {
  const rootDir = makeFixture();
  try {
    assert.ok(checkResumeFreshness({ rootDir }).ok);
    const resumePath = path.join(rootDir, 'data/resume.json');
    const resume = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
    resume.summary = `${resume.summary} (edited without rebuild)`;
    fs.writeFileSync(resumePath, JSON.stringify(resume, null, 2));

    const result = checkResumeFreshness({ rootDir });
    assertIssue(result, 'SOURCE_HASH_MISMATCH', 'data');
  } finally {
    cleanupFixture(rootDir);
  }
});

test('freshness rejects missing, symlinked, non-regular, and oversized artifact paths', () => {
  const cases = [
    {
      name: 'missing PDF',
      artifact: 'docs/resume.pdf',
      code: 'ARTIFACT_MISSING',
      mutate(rootDir) { fs.unlinkSync(path.join(rootDir, 'docs/resume.pdf')); }
    },
    {
      name: 'symlinked PDF',
      artifact: 'docs/resume.pdf',
      code: 'ARTIFACT_SYMLINK',
      mutate(rootDir) {
        const file = path.join(rootDir, 'docs/resume.pdf');
        fs.unlinkSync(file);
        fs.symlinkSync(path.join(projectRoot, 'docs/resume.pdf'), file);
      }
    },
    {
      name: 'directory in place of DOCX',
      artifact: 'docs/resume.docx',
      code: 'ARTIFACT_NON_REGULAR',
      mutate(rootDir) {
        const file = path.join(rootDir, 'docs/resume.docx');
        fs.unlinkSync(file);
        fs.mkdirSync(file);
      }
    },
    {
      name: 'oversized sparse PDF',
      artifact: 'docs/resume.pdf',
      code: 'ARTIFACT_OVERSIZED',
      mutate(rootDir) { fs.truncateSync(path.join(rootDir, 'docs/resume.pdf'), MAX_PDF_BYTES + 1); }
    },
    {
      name: 'missing manifest',
      artifact: 'docs/resume.manifest.json',
      code: 'MANIFEST_MISSING',
      mutate(rootDir) { fs.unlinkSync(path.join(rootDir, 'docs/resume.manifest.json')); }
    },
    {
      name: 'symlinked manifest',
      artifact: 'docs/resume.manifest.json',
      code: 'MANIFEST_SYMLINK',
      mutate(rootDir) {
        const file = path.join(rootDir, 'docs/resume.manifest.json');
        fs.unlinkSync(file);
        fs.symlinkSync(path.join(projectRoot, 'docs/resume.manifest.json'), file);
      }
    },
    {
      name: 'oversized sparse manifest',
      artifact: 'docs/resume.manifest.json',
      code: 'MANIFEST_OVERSIZED',
      mutate(rootDir) { fs.truncateSync(path.join(rootDir, 'docs/resume.manifest.json'), MAX_MANIFEST_BYTES + 1); }
    }
  ];

  for (const entry of cases) {
    const rootDir = makeFixture();
    try {
      entry.mutate(rootDir);
      const result = checkResumeFreshness({ rootDir });
      assertIssue(result, entry.code, entry.artifact);
    } finally {
      cleanupFixture(rootDir);
    }
  }
});

test('freshness rejects malformed PDF and DOCX structures before trusting their hashes', () => {
  const rootDir = makeFixture();
  try {
    fs.writeFileSync(path.join(rootDir, 'docs/resume.pdf'), 'replaced pdf bytes');
    fs.writeFileSync(path.join(rootDir, 'docs/resume.docx'), 'replaced docx bytes');

    const result = checkResumeFreshness({ rootDir });
    assertIssue(result, 'ARTIFACT_INVALID', 'docs/resume.pdf');
    assertIssue(result, 'ARTIFACT_INVALID', 'docs/resume.docx');
    assert.equal(issueFor(result, 'ARTIFACT_HASH_MISMATCH'), undefined);
  } finally {
    cleanupFixture(rootDir);
  }
});

test('artifact validators enforce PDF boundary markers and DOCX central/core resource bounds', () => {
  const pdfBytes = fs.readFileSync(path.join(projectRoot, 'docs/resume.pdf'));
  const badMagic = Buffer.from(pdfBytes);
  badMagic[1] ^= 0x01;
  assert.throws(() => validatePdfBytes(badMagic), /magic header/);
  const eofOffset = pdfBytes.lastIndexOf(Buffer.from('%%EOF', 'ascii'));
  assert.ok(eofOffset > 0);
  assert.throws(() => validatePdfBytes(pdfBytes.subarray(0, eofOffset)), /EOF marker/);

  const docxBytes = fs.readFileSync(path.join(projectRoot, 'docs/resume.docx'));
  assert.throws(() => validateDocxBytes(docxBytes.subarray(0, -1)), /end-of-central-directory/);

  const missingCore = replaceAsciiEverywhere(
    docxBytes,
    'word/document.xml',
    'word/xocument.xml'
  );
  assert.ok(missingCore.count >= 2, 'local and central core-entry names were replaced');
  assert.throws(() => validateDocxBytes(missingCore.bytes), /missing required ZIP entry word\/document\.xml/);

  const declaredBomb = Buffer.from(docxBytes);
  const eocdOffset = declaredBomb.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const centralOffset = declaredBomb.readUInt32LE(eocdOffset + 16);
  assert.equal(declaredBomb.readUInt32LE(centralOffset), 0x02014b50);
  declaredBomb.writeUInt32LE(129 * 1024 * 1024, centralOffset + 24);
  assert.throws(() => validateDocxBytes(declaredBomb), /declared uncompressed content exceeds/);
});

test('freshness hashes the exact structurally validated PDF and DOCX bytes', () => {
  const rootDir = makeFixture();
  try {
    const pdfPath = path.join(rootDir, 'docs/resume.pdf');
    const docxPath = path.join(rootDir, 'docs/resume.docx');
    const pdfBytes = fs.readFileSync(pdfPath);
    pdfBytes[8] ^= 0x01;
    fs.writeFileSync(pdfPath, pdfBytes);
    fs.writeFileSync(docxPath, mutateDocxPayload(fs.readFileSync(docxPath)));

    const result = checkResumeFreshness({ rootDir });
    assertIssue(result, 'ARTIFACT_HASH_MISMATCH', 'docs/resume.pdf');
    assertIssue(result, 'ARTIFACT_HASH_MISMATCH', 'docs/resume.docx');
    assert.equal(issueFor(result, 'ARTIFACT_INVALID'), undefined, result.failures.join('\n'));
  } finally {
    cleanupFixture(rootDir);
  }
});

test('stable artifact reads detect deletion and replacement races after bytes are read', () => {
  for (const mode of ['delete', 'replace']) {
    const rootDir = makeFixture();
    const pdfPath = path.join(rootDir, 'docs/resume.pdf');
    try {
      const result = checkResumeFreshness({
        rootDir,
        afterArtifactRead({ relativePath }) {
          if (relativePath !== 'docs/resume.pdf') return;
          if (mode === 'delete') {
            fs.unlinkSync(pdfPath);
          } else {
            const oldPath = `${pdfPath}.old`;
            fs.renameSync(pdfPath, oldPath);
            fs.copyFileSync(path.join(projectRoot, 'docs/resume.pdf'), pdfPath);
          }
        }
      });
      assertIssue(result, 'ARTIFACT_CHANGED', 'docs/resume.pdf');
    } finally {
      cleanupFixture(rootDir);
    }
  }
});

test('PDF exporter bounds each Playwright stage and forces cleanup', { timeout: 5000 }, async () => {
  const stages = ['loadChromium', 'launch', 'newPage', 'setContent', 'pdf', 'page.close', 'browser.close'];

  for (const stalledStage of stages) {
    const deadline = createManualDeadline();
    let notifyReached;
    const reached = new Promise((resolve) => { notifyReached = resolve; });
    let releaseStall;
    const calls = {
      launch: 0,
      newPage: 0,
      setContent: 0,
      pdf: 0,
      pageClose: 0,
      browserClose: 0
    };
    let launchOptions;
    let setContentOptions;
    let pdfOptions;

    function resultFor(stage, value) {
      if (stalledStage !== stage) return Promise.resolve(value);
      notifyReached();
      return new Promise((resolve) => {
        releaseStall = () => resolve(value);
      });
    }

    const page = {
      setContent(_html, options) {
        calls.setContent += 1;
        setContentOptions = options;
        return resultFor('setContent');
      },
      pdf(options) {
        calls.pdf += 1;
        pdfOptions = options;
        return resultFor('pdf');
      },
      close(options) {
        calls.pageClose += 1;
        assert.deepEqual(options, { runBeforeUnload: false }, `${stalledStage}: forced page close options`);
        return resultFor('page.close');
      }
    };
    const browser = {
      newPage() {
        calls.newPage += 1;
        return resultFor('newPage', page);
      },
      close() {
        calls.browserClose += 1;
        return resultFor('browser.close');
      }
    };
    const chromium = {
      launch(options) {
        calls.launch += 1;
        launchOptions = options;
        return resultFor('launch', browser);
      }
    };

    const timeoutMs = 731;
    const exportPromise = exportPdf('<!doctype html><title>deadline test</title>', '/tmp/unpublished.pdf', {
      timeoutMs,
      loadChromiumImpl: () => resultFor('loadChromium', chromium),
      setTimeoutImpl: deadline.setTimeoutImpl,
      clearTimeoutImpl: deadline.clearTimeoutImpl
    });

    await withTimeout(reached, 500, `${stalledStage} stall entry`);
    deadline.fire();
    await assert.rejects(exportPromise, (error) => {
      assert.ok(error instanceof ResumeExportTimeoutError, `${stalledStage}: typed timeout error`);
      assert.equal(error.code, 'ERR_RESUME_EXPORT_TIMEOUT');
      assert.equal(error.timeoutMs, timeoutMs);
      assert.match(error.message, /^PDF export timed out after 731ms$/);
      return true;
    });
    releaseStall();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(deadline.timeoutMs, timeoutMs, `${stalledStage}: one configured wall deadline`);
    assert.equal(deadline.clearCalls, 1, `${stalledStage}: deadline timer is cleared`);
    if (stages.indexOf(stalledStage) >= stages.indexOf('launch')) {
      assert.deepEqual(launchOptions, { headless: true, timeout: timeoutMs });
    }
    if (stages.indexOf(stalledStage) >= stages.indexOf('setContent')) {
      assert.deepEqual(setContentOptions, { waitUntil: 'networkidle', timeout: timeoutMs });
    }
    if (stages.indexOf(stalledStage) >= stages.indexOf('pdf')) {
      assert.equal(pdfOptions.path, '/tmp/unpublished.pdf');
      assert.equal(pdfOptions.format, 'A4');
      assert.equal(pdfOptions.printBackground, true);
    }
    const stalledIndex = stages.indexOf(stalledStage);
    assert.equal(calls.launch, stalledIndex >= stages.indexOf('launch') ? 1 : 0, `${stalledStage}: launch boundary`);
    assert.equal(calls.newPage, stalledIndex >= stages.indexOf('newPage') ? 1 : 0, `${stalledStage}: page boundary`);
    assert.equal(
      calls.setContent,
      stalledIndex >= stages.indexOf('setContent') ? 1 : 0,
      `${stalledStage}: content boundary`
    );
    assert.equal(calls.pdf, stalledIndex >= stages.indexOf('pdf') ? 1 : 0, `${stalledStage}: PDF boundary`);
    const pageWasAcquired = stalledIndex >= stages.indexOf('newPage');
    const browserWasAcquired = stalledIndex >= stages.indexOf('launch');
    assert.equal(calls.pageClose, pageWasAcquired ? 1 : 0, `${stalledStage}: acquired page cleanup`);
    assert.equal(calls.browserClose, browserWasAcquired ? 1 : 0, `${stalledStage}: acquired browser cleanup`);
  }
});

test('DOCX hard timeout uses SIGKILL and aborts build without publication', async () => {
  const rootDir = makeFixture({ includeDocs: false });
  const timeoutMs = 947;
  let invocation;
  let perRunDirectory;
  const timeoutCause = Object.assign(new Error('synthetic pandoc timeout'), {
    code: 'ETIMEDOUT',
    stderr: Buffer.alloc(0)
  });

  try {
    await assert.rejects(
      buildResume({
        rootDir,
        exportTimeoutMs: timeoutMs,
        log: () => {},
        exportPdfImpl(_html, outputPath, options) {
          assert.equal(options.timeoutMs, timeoutMs);
          perRunDirectory = path.dirname(outputPath);
          fs.copyFileSync(path.join(projectRoot, 'docs/resume.pdf'), outputPath);
        },
        exportDocxImpl(htmlPath, outputPath, options) {
          assert.equal(options.timeoutMs, timeoutMs, 'build propagates the configured DOCX deadline');
          assert.equal(path.dirname(htmlPath), perRunDirectory);
          assert.equal(path.dirname(outputPath), perRunDirectory);
          return exportDocx(htmlPath, outputPath, {
            timeoutMs: options.timeoutMs,
            execFileSyncImpl(command, args, execOptions) {
              invocation = { command, args, options: execOptions, htmlPath, outputPath };
              throw timeoutCause;
            }
          });
        }
      }),
      (error) => {
        assert.ok(error instanceof ResumeExportTimeoutError);
        assert.equal(error.code, 'ERR_RESUME_EXPORT_TIMEOUT');
        assert.equal(error.timeoutMs, timeoutMs);
        assert.equal(error.cause, timeoutCause);
        assert.match(error.message, /^DOCX export timed out after 947ms$/);
        return true;
      }
    );

    assert.equal(invocation.command, 'pandoc');
    assert.deepEqual(invocation.args, [
      invocation.htmlPath,
      '--from=html',
      '--to=docx',
      '--output',
      invocation.outputPath,
      '--metadata',
      'title=Leonard Wong Resume'
    ]);
    assert.deepEqual(invocation.options, {
      stdio: 'pipe',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: MAX_PANDOC_DIAGNOSTIC_BYTES
    });

    const paths = getResumePaths(rootDir);
    assert.equal(fs.existsSync(paths.buildLockPath), false, 'DOCX timeout releases the build lock');
    assert.equal(fs.existsSync(perRunDirectory), false, 'DOCX timeout removes PDF, HTML, and DOCX staging files');
    assert.equal(fs.existsSync(paths.htmlOutPath), false, 'HTML is not partially published');
    assert.equal(fs.existsSync(paths.pdfOutPath), false, 'the completed temporary PDF is not published');
    assert.equal(fs.existsSync(paths.docxOutPath), false, 'DOCX is not partially published');
    assert.equal(fs.existsSync(paths.manifestOutPath), false, 'manifest is not partially published');

    for (const invalidTimeout of [0, MAX_RESUME_EXPORT_TIMEOUT_MS + 1, Number.NaN]) {
      assert.throws(
        () => exportDocx('/tmp/resume-source.html', '/tmp/resume-output.docx', {
          timeoutMs: invalidTimeout,
          execFileSyncImpl: () => assert.fail('invalid deadlines must be rejected before process creation')
        }),
        /Resume export timeout must be a positive safe integer/
      );
    }
  } finally {
    cleanupFixture(rootDir);
  }
});

test('timed-out PDF export releases the build lock and cannot partially publish', { timeout: 5000 }, async () => {
  const rootDir = makeFixture({ includeDocs: false });
  const deadline = createManualDeadline();
  const timeoutMs = 863;
  let notifySetContentStarted;
  const setContentStarted = new Promise((resolve) => { notifySetContentStarted = resolve; });
  let rejectSetContent;
  const stalledSetContent = new Promise((_, reject) => { rejectSetContent = reject; });
  let perRunDirectory;
  let pageCloseCalls = 0;
  let browserCloseCalls = 0;

  const page = {
    setContent(_html, options) {
      assert.deepEqual(options, { waitUntil: 'networkidle', timeout: timeoutMs });
      notifySetContentStarted();
      return stalledSetContent;
    },
    pdf() {
      assert.fail('PDF rendering must not continue after the stalled content load');
    },
    close() {
      pageCloseCalls += 1;
      rejectSetContent(new Error('synthetic page closure'));
      return Promise.resolve();
    }
  };
  const browser = {
    newPage: async () => page,
    close() {
      browserCloseCalls += 1;
      return Promise.resolve();
    }
  };

  try {
    const buildPromise = buildResume({
      rootDir,
      exportTimeoutMs: timeoutMs,
      log: () => {},
      exportPdfImpl(html, outputPath, options) {
        perRunDirectory = path.dirname(outputPath);
        assert.equal(options.timeoutMs, timeoutMs, 'build propagates one exporter deadline budget');
        return exportPdf(html, outputPath, {
          timeoutMs: options.timeoutMs,
          loadChromiumImpl: async () => ({
            launch(launchOptions) {
              assert.deepEqual(launchOptions, { headless: true, timeout: timeoutMs });
              return Promise.resolve(browser);
            }
          }),
          setTimeoutImpl: deadline.setTimeoutImpl,
          clearTimeoutImpl: deadline.clearTimeoutImpl
        });
      },
      exportDocxImpl() {
        assert.fail('DOCX exporter must not run after the timed-out PDF exporter');
      }
    });
    buildPromise.catch(() => {});

    await withTimeout(setContentStarted, 500, 'stalled PDF content load');
    deadline.fire();
    await assert.rejects(buildPromise, (error) => {
      assert.ok(error instanceof ResumeExportTimeoutError);
      assert.equal(error.code, 'ERR_RESUME_EXPORT_TIMEOUT');
      assert.equal(error.timeoutMs, timeoutMs);
      assert.equal(error.message, 'PDF export timed out after 863ms');
      return true;
    });

    const paths = getResumePaths(rootDir);
    assert.equal(deadline.timeoutMs, timeoutMs);
    assert.equal(deadline.clearCalls, 1);
    assert.equal(pageCloseCalls, 1, 'timeout forces page cleanup');
    assert.equal(browserCloseCalls, 1, 'timeout forces browser cleanup');
    assert.equal(fs.existsSync(paths.buildLockPath), false, 'timeout releases the exclusive build lock');
    assert.equal(fs.existsSync(perRunDirectory), false, 'timeout removes the per-run export directory');
    assert.equal(fs.existsSync(paths.htmlOutPath), false, 'HTML is not partially published');
    assert.equal(fs.existsSync(paths.pdfOutPath), false, 'PDF is not partially published');
    assert.equal(fs.existsSync(paths.docxOutPath), false, 'DOCX is not partially published');
    assert.equal(fs.existsSync(paths.manifestOutPath), false, 'manifest is not partially published');

    await buildResume({ rootDir, htmlOnly: true, log: () => {} });
    assert.equal(fs.existsSync(paths.buildLockPath), false, 'a later build can reacquire and release the lock');
  } finally {
    rejectSetContent?.(new Error('test cleanup'));
    cleanupFixture(rootDir);
  }
});

test('build lock excludes concurrent publication and keeps one coherent artifact bundle', { timeout: 5000 }, async () => {
  const rootDir = makeFixture({ includeDocs: false });
  let unblockPdf;
  let notifyPdfStarted;
  const pdfStarted = new Promise((resolve) => { notifyPdfStarted = resolve; });
  const pdfUnblocked = new Promise((resolve) => { unblockPdf = resolve; });
  let perRunDirectory;

  try {
    const firstBuild = buildResume({
      rootDir,
      log: () => {},
      async exportPdfImpl(html, outputPath, { htmlPath }) {
        perRunDirectory = path.dirname(outputPath);
        assert.equal(path.dirname(htmlPath), perRunDirectory);
        assert.equal(fs.readFileSync(htmlPath, 'utf8'), html);
        notifyPdfStarted();
        await withTimeout(pdfUnblocked, 1500, 'PDF exporter unblock');
        fs.copyFileSync(path.join(projectRoot, 'docs/resume.pdf'), outputPath);
      },
      exportDocxImpl(htmlPath, outputPath) {
        assert.equal(path.dirname(htmlPath), perRunDirectory, 'Pandoc receives the per-run HTML path');
        assert.ok(fs.readFileSync(htmlPath, 'utf8').startsWith('<!DOCTYPE html>'));
        fs.copyFileSync(path.join(projectRoot, 'docs/resume.docx'), outputPath);
      }
    });
    firstBuild.catch(() => {});

    await withTimeout(pdfStarted, 1500, 'PDF exporter start');
    try {
      await assert.rejects(
        buildResume({ rootDir, htmlOnly: true, log: () => {} }),
        /Resume build lock is already held or unsafe/
      );
    } finally {
      unblockPdf();
    }

    const { html, manifest, paths } = await withTimeout(firstBuild, 1500, 'first resume build completion');
    assert.equal(fs.existsSync(paths.buildLockPath), false, 'exclusive lock is cleaned');
    assert.equal(fs.existsSync(perRunDirectory), false, 'per-run exporter directory is cleaned');
    assert.equal(fs.readFileSync(paths.htmlOutPath, 'utf8'), html);
    assert.equal(computeBytesSha256(fs.readFileSync(paths.pdfOutPath)), manifest.pdfSha256);
    assert.equal(computeBytesSha256(fs.readFileSync(paths.docxOutPath)), manifest.docxSha256);
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.manifestOutPath, 'utf8')), manifest);
    const freshness = checkResumeFreshness({ rootDir });
    assert.ok(freshness.ok, freshness.failures.join('\n'));
  } finally {
    unblockPdf?.();
    cleanupFixture(rootDir);
  }
});

test('build failure cleans its lock and all per-run files without partial publication', async () => {
  const rootDir = makeFixture({ includeDocs: false });
  let perRunDirectory;
  try {
    await assert.rejects(
      buildResume({
        rootDir,
        log: () => {},
        exportPdfImpl(_html, outputPath) {
          perRunDirectory = path.dirname(outputPath);
          throw new Error('synthetic exporter failure');
        },
        exportDocxImpl() {
          assert.fail('DOCX exporter must not run after PDF failure');
        }
      }),
      /synthetic exporter failure/
    );
    const paths = getResumePaths(rootDir);
    assert.equal(fs.existsSync(paths.buildLockPath), false);
    assert.equal(fs.existsSync(perRunDirectory), false);
    assert.equal(fs.existsSync(paths.htmlOutPath), false);
    assert.equal(fs.existsSync(paths.pdfOutPath), false);
    assert.equal(fs.existsSync(paths.docxOutPath), false);
    assert.equal(fs.existsSync(paths.manifestOutPath), false);
  } finally {
    cleanupFixture(rootDir);
  }
});

test('nth publication failure restores the exact prior bundle and leaves no temporary files', async () => {
  const rootDir = makeFixture();
  const paths = getResumePaths(rootDir);
  const outputPaths = [paths.htmlOutPath, paths.pdfOutPath, paths.docxOutPath, paths.manifestOutPath];
  const before = new Map(outputPaths.map((filePath) => [filePath, snapshotFile(filePath)]));
  let publicationWrites = 0;
  let perRunDirectory;
  try {
    const resumePath = path.join(rootDir, 'data/resume.json');
    const resume = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
    resume.summary = `${resume.summary} transaction rollback probe`;
    fs.writeFileSync(resumePath, `${JSON.stringify(resume, null, 2)}\n`);

    await assert.rejects(
      buildResume({
        rootDir,
        log: () => {},
        exportPdfImpl(_html, outputPath) {
          perRunDirectory = path.dirname(outputPath);
          const bytes = fs.readFileSync(path.join(projectRoot, 'docs/resume.pdf'));
          bytes[8] ^= 0x01;
          fs.writeFileSync(outputPath, bytes);
        },
        exportDocxImpl(_htmlPath, outputPath) {
          fs.writeFileSync(
            outputPath,
            mutateDocxPayload(fs.readFileSync(path.join(projectRoot, 'docs/resume.docx')))
          );
        },
        publishFileImpl(rootPath, filePath, bytes, label) {
          publicationWrites += 1;
          if (publicationWrites === 4) throw new Error('synthetic fourth-publication failure');
          writeFileNoFollow(rootPath, filePath, bytes, label);
        }
      }),
      /synthetic fourth-publication failure/
    );

    assert.equal(publicationWrites, 4, 'failure occurs after three successful atomic publications');
    for (const filePath of outputPaths) assertSnapshot(filePath, before.get(filePath));
    assert.equal(fs.existsSync(paths.buildLockPath), false, 'build lock is cleaned after rollback');
    assert.equal(fs.existsSync(perRunDirectory), false, 'per-run exporter directory is cleaned after rollback');
    for (const directory of [paths.artifactsDir, path.dirname(paths.pdfOutPath)]) {
      const leaked = fs.readdirSync(directory).filter((name) => name.startsWith('.safe-output-'));
      assert.deepEqual(leaked, [], `no atomic-write temporary files leaked in ${directory}`);
    }
  } finally {
    cleanupFixture(rootDir);
  }
});

test('build lock preserves stale and replacement ownership', async () => {
  const rootDir = makeFixture({ includeDocs: false });
  const paths = getResumePaths(rootDir);
  fs.mkdirSync(paths.artifactsDir, { recursive: true });
  fs.writeFileSync(paths.buildLockPath, 'owned by an unknown prior process\n');
  try {
    await assert.rejects(
      buildResume({ rootDir, htmlOnly: true, log: () => {} }),
      /Resume build lock is already held or unsafe/
    );
    assert.equal(fs.readFileSync(paths.buildLockPath, 'utf8'), 'owned by an unknown prior process\n');

    fs.unlinkSync(paths.buildLockPath);
    const movedOwnedLockPath = `${paths.buildLockPath}.moved-owned`;
    const externalLockBytes = Buffer.from('external replacement lock\n');
    const operationError = new Error('synthetic locked operation failure');
    await assert.rejects(
      withResumeBuildLock({ rootDir }, async () => {
        fs.renameSync(paths.buildLockPath, movedOwnedLockPath);
        fs.writeFileSync(paths.buildLockPath, externalLockBytes);
        throw operationError;
      }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.match(error.message, /operation failed and the build lock could not be safely released/);
        assert.equal(error.errors.length, 2);
        assert.equal(error.errors[0], operationError, 'operation failure is preserved first');
        assert.match(error.errors[1].message, /changed ownership before release/);
        return true;
      }
    );
    assert.deepEqual(
      fs.readFileSync(paths.buildLockPath),
      externalLockBytes,
      'release refuses to remove the externally replaced lock path'
    );
    assert.equal(fs.existsSync(movedOwnedLockPath), true, 'the displaced owned lock is not confused with the replacement');
  } finally {
    cleanupFixture(rootDir);
  }
});
