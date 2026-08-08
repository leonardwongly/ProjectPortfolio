import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  buildSite,
  collectInlineScriptHashes,
  hashInlineScript,
  injectCspScriptHashes,
  loadPartials,
  MAX_BUILD_INPUT_BYTES,
  MAX_SITE_OUTPUT_BYTES,
  publishSiteBundle,
  readBuildText,
  readJson,
  renderCspScriptHashesDirective,
  renderReadingGrid,
  renderProfileSchema,
  sanitizeHref,
  sanitizeAssetPath,
  validateReadingAssetInventory,
  validateDataCollections,
  withSiteBuildLock
} = require('../../scripts/build.js');
const { writeFileNoFollow } = require('../../scripts/lib/safe-output.cjs');
const {
  readStableFileSnapshotNoFollow,
  sameFileSnapshot
} = require('../../scripts/lib/safe-input.cjs');
const { stripTrailingWhitespace } = require('../../scripts/lib/static-rendering.cjs');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function makeValidProfile() {
  return {
    person: {
      name: 'Example Person',
      job_title: 'Software Engineer',
      location: 'Singapore',
      url: 'https://example.com/',
      works_for: 'Example Org',
      client_context: 'Serving Example Client as an IT vendor',
      same_as: ['https://linkedin.com/in/example'],
      knows_about: ['Security', 'Responsible AI']
    },
    hero: {
      eyebrow: 'Software Engineer · Singapore',
      headline: 'Building secure platforms.',
      lead: 'Software engineer focused on secure, data-driven platforms.',
      actions: [
        { label: 'Resume', href: 'docs/resume.pdf', variant: 'primary' },
        { label: 'Contact', href: '#contact', variant: 'ghost' }
      ],
      highlights: [{ label: 'Focus', value: 'Security', href: '#experience' }],
      current: {
        label: 'Currently',
        value: 'Software Engineer @ Example Org',
        sub: 'Serving Example Client as an IT vendor'
      }
    },
    education: [
      {
        institution: 'Example Polytechnic',
        credential: 'Diploma in Secure Systems',
        dates: '2014–2017'
      }
    ],
    publication: {
      title: 'Security for the Masses',
      venue: 'ExampleConf 2025',
      date: 'May 1, 2025',
      note: 'Best paper nominee',
      authors: 'Example Person & Collaborator',
      links: [{ label: 'Paper', url: 'https://example.com/paper' }]
    },
    articles: [
      {
        title: 'Security write-up',
        published: 'Jan 1, 2026',
        summary: 'A short public analysis.',
        link: 'https://linkedin.com/pulse/security-write-up',
        tags: ['Security']
      }
    ],
    honors: [
      {
        title: 'Director’s List',
        issuer: 'Example Polytechnic',
        issued: 'May 2017',
        description: 'Awarded to top students.'
      }
    ],
    languages: [
      {
        name: 'English',
        proficiency: 'Professional working proficiency'
      }
    ],
    community: [
      {
        id: 'EXAMPLE',
        organization: 'Example Community',
        logo: 'images/example-30.jpg',
        logo_alt: 'Example Community logo',
        roles: [
          {
            title: 'Mentor',
            dates: '2025'
          }
        ],
        responsibilities: ['Supported students during weekly sessions.']
      }
    ],
    site_engineering: {
      eyebrow: 'Site Engineering',
      headline: 'Built as a small static system.',
      lede: 'Generated content and automated validation keep releases reviewable.',
      items: [
        {
          title: 'Static generation',
          detail: 'Structured content generates committed HTML.'
        }
      ]
    },
    contact: {
      eyebrow: 'Contact',
      headline: 'Open to secure platform work.',
      lede: 'Reach out directly.',
      actions: [{ label: 'Email', href: 'https://email.example.com', variant: 'primary' }],
      meta: ['Based in Singapore']
    }
  };
}

function makeValidData() {
  const data = {
    profile: makeValidProfile(),
    featured: [
      {
        id: 'project-alpha',
        featured: true,
        featured_order: 1,
        status: 'active',
        capabilities: ['Security Governance'],
        case_study: '/case-study-project-alpha.html',
        title: 'Project Alpha',
        timeframe: '2025',
        problem: 'Problem statement.',
        impact: 'Impact statement.',
        tech: ['Node.js', 'Security'],
        links: [{ label: 'GitHub', url: 'https://github.com/example/repo' }]
      },
      {
        id: 'project-beta',
        featured: true,
        featured_order: 2,
        status: 'maintained',
        capabilities: ['Platform Engineering'],
        case_study: '/case-study-project-beta.html',
        title: 'Project Beta',
        timeframe: '2025',
        problem: 'Second problem statement.',
        impact: 'Second impact statement.',
        tech: ['JavaScript'],
        links: []
      },
      {
        id: 'project-gamma',
        featured: true,
        featured_order: 3,
        status: 'completed',
        capabilities: ['Data Systems'],
        case_study: '/case-study-project-gamma.html',
        title: 'Project Gamma',
        timeframe: '2024',
        problem: 'Third problem statement.',
        impact: 'Third impact statement.',
        tech: ['SQL'],
        links: []
      }
    ],
    caseStudies: [],
    skills: [
      {
        category: 'Languages',
        items: ['JavaScript']
      }
    ],
    experience: [
      {
        org: 'Example Org',
        role: 'Software Engineer',
        dates: '2025',
        impact_bullets: ['Delivered secure platform updates.'],
        tech: ['Node.js']
      }
    ],
    certifications: [
      {
        title: 'Secure Systems',
        issuer: 'Example Institute',
        issued: 'Issued 2025',
        link: 'https://credentials.example.com/secure-systems',
        icon: 'images/example-30.jpg',
        icon_alt: 'Example logo'
      }
    ],
    reading: [
      {
        year: 2025,
        title: 'Secure Design',
        author: 'A. Author',
        isbn: '978-1-234567-89-7',
        cover: 'book/2025/secure-design-300.jpg',
        link: 'https://books.example.com/secure-design',
        tags: ['Security']
      }
    ]
  };
  data.caseStudies = data.featured.map((project) => ({
    id: project.id,
    project_id: project.id,
    slug: project.case_study.slice(1),
    eyebrow: 'Case Study · Secure Systems',
    title: project.title,
    summary: 'A governed system with explicit controls and evidence.',
    role: 'Principal engineer',
    timeframe: '2025 · Active',
    repository_url: 'https://github.com/example/repo',
    challenge: 'Create a useful system without weakening authorization, accountability, or operational evidence.',
    architecture_intro: 'Requests move through validation, policy, execution, and durable evidence boundaries.',
    architecture: [
      { label: 'Capture', detail: 'Accept a typed request.' },
      { label: 'Govern', detail: 'Apply deterministic policy.' },
      { label: 'Record', detail: 'Persist the outcome and evidence.' }
    ],
    ownership: ['Defined the boundary.', 'Designed the system.', 'Documented operations.'],
    decisions: [
      { title: 'Explicit authority', detail: 'Keep authorization visible.' },
      { title: 'Durable state', detail: 'Persist operating truth.' },
      { title: 'Fail closed', detail: 'Reject incomplete production configuration.' }
    ],
    controls: ['Authentication', 'Authorization', 'Validation', 'Audit trail'],
    validation: ['Unit coverage', 'Integration coverage', 'Operational smoke checks'],
    outcomes: ['Working implementation', 'Reviewable evidence', 'Documented limitations'],
    limitations: ['Depends on correct configuration.', 'Does not remove provider constraints.'],
    next_steps: ['Expand live validation.', 'Improve operator diagnostics.']
  }));
  return data;
}

function makeSiteBuildFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-site-build-'));
  for (const directory of ['data', 'partials', 'src']) {
    fs.cpSync(path.join(projectRoot, directory), path.join(rootDir, directory), { recursive: true });
  }

  const reading = JSON.parse(fs.readFileSync(path.join(rootDir, 'data/reading.json'), 'utf8'));
  new Set(reading.map((entry) => entry.cover).filter(Boolean)).forEach((cover) => {
    const coverPath = path.join(rootDir, cover);
    fs.mkdirSync(path.dirname(coverPath), { recursive: true });
    fs.writeFileSync(coverPath, 'fixture cover');
  });
  const caseStudies = JSON.parse(fs.readFileSync(path.join(rootDir, 'data/case-studies.json'), 'utf8'));
  return {
    rootDir,
    outputNames: [
      'index.html',
      'work.html',
      'reading.html',
      'offline.html',
      ...caseStudies.map((study) => study.slug),
      '_headers'
    ]
  };
}

test('build module import defers all project input reads', () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-build-import-'));
  try {
    let importError;
    try {
      execFileSync(
        process.execPath,
        ['-e', `process.chdir(${JSON.stringify(emptyRoot)}); require(${JSON.stringify(path.join(projectRoot, 'scripts/build.js'))});`],
        { stdio: 'pipe', timeout: 2000, killSignal: 'SIGKILL' }
      );
    } catch (error) {
      importError = error;
    }
    const timedOut = importError?.code === 'ETIMEDOUT' || importError?.signal === 'SIGKILL';
    assert.equal(
      importError,
      undefined,
      timedOut
        ? 'build module import exceeded the 2000 ms safety timeout (possible blocking input read)'
        : `build module import failed: ${importError?.stderr?.toString().trim() || importError?.message}`
    );
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
});

test('build input readers enforce the byte boundary and reject linked or malformed sources', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-build-input-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-build-outside-'));
  try {
    fs.mkdirSync(path.join(rootDir, 'data'));
    fs.mkdirSync(path.join(rootDir, 'partials'));
    fs.mkdirSync(path.join(rootDir, 'src'));

    const sourcePath = path.join(rootDir, 'src/index.html');
    fs.writeFileSync(sourcePath, '');
    assert.throws(() => readBuildText('src/index.html', { rootDir }), /smaller than 1 byte/);
    fs.writeFileSync(sourcePath, Buffer.alloc(MAX_BUILD_INPUT_BYTES, 0x61));
    let sourceOpenFlags;
    const openSync = (file, flags, ...args) => {
      if (path.resolve(file) === sourcePath) sourceOpenFlags = flags;
      return fs.openSync(file, flags, ...args);
    };
    assert.equal(
      readBuildText('src/index.html', { rootDir, openSync }).length,
      MAX_BUILD_INPUT_BYTES
    );
    assert.equal(
      sourceOpenFlags & fs.constants.O_NOFOLLOW,
      fs.constants.O_NOFOLLOW,
      'stable build inputs are opened without following a replaced symlink'
    );
    assert.equal(
      sourceOpenFlags & fs.constants.O_NONBLOCK,
      fs.constants.O_NONBLOCK,
      'stable build inputs cannot block indefinitely on a special-file replacement'
    );
    const boundSnapshot = readStableFileSnapshotNoFollow(sourcePath, {
      rootDir,
      label: 'descriptor-bound build snapshot',
      maxBytes: MAX_BUILD_INPUT_BYTES
    });
    assert.equal(boundSnapshot.bytes.length, MAX_BUILD_INPUT_BYTES);
    assert.equal(
      sameFileSnapshot(boundSnapshot.stats, fs.lstatSync(sourcePath, { bigint: true })),
      true,
      'snapshot metadata is the exact descriptor state validated with the returned bytes'
    );
    fs.appendFileSync(sourcePath, 'b');
    assert.throws(
      () => readBuildText('src/index.html', { rootDir }),
      /exceeds the 2097152-byte limit/
    );

    const externalJson = path.join(outsideDir, 'profile.json');
    const linkedJson = path.join(rootDir, 'data/profile.json');
    fs.writeFileSync(externalJson, '{}');
    assert.throws(
      () => readBuildText(path.relative(rootDir, externalJson), { rootDir }),
      /inside the configured root/
    );
    fs.symlinkSync(externalJson, linkedJson);
    assert.throws(() => readJson('profile.json', { rootDir }), /symbolic link/);
    fs.unlinkSync(linkedJson);
    fs.linkSync(externalJson, linkedJson);
    assert.throws(() => readJson('profile.json', { rootDir }), /exactly one hard link/);

    fs.rmSync(path.join(rootDir, 'partials'), { recursive: true });
    const externalPartials = path.join(outsideDir, 'partials');
    fs.mkdirSync(externalPartials);
    fs.writeFileSync(path.join(externalPartials, 'nav.html'), '<nav></nav>');
    fs.writeFileSync(path.join(externalPartials, 'footer.html'), '<footer></footer>');
    fs.symlinkSync(externalPartials, path.join(rootDir, 'partials'));
    assert.throws(() => loadPartials({ rootDir }), /symbolic link/);

    fs.writeFileSync(path.join(rootDir, 'src/_headers.template'), Buffer.from([0xff, 0xfe]));
    assert.throws(
      () => readBuildText('src/_headers.template', { rootDir }),
      /valid UTF-8/
    );

    const racedSource = path.join(rootDir, 'src/raced.html');
    fs.writeFileSync(racedSource, 'stable before open');
    const originalOpenSync = fs.openSync;
    try {
      fs.openSync = function openAndUnlink(file, ...args) {
        const descriptor = originalOpenSync.call(this, file, ...args);
        if (path.resolve(file) === racedSource) fs.unlinkSync(racedSource);
        return descriptor;
      };
      assert.throws(
        () => readBuildText('src/raced.html', { rootDir }),
        (error) => error.reason === 'changed' && /removed before it could be read/.test(error.message)
      );
    } finally {
      fs.openSync = originalOpenSync;
    }
    assert.equal(fs.readFileSync(externalJson, 'utf8'), '{}');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('buildSite lock-scopes every rendered page and restores the bundle after an nth-write failure', () => {
  const { rootDir, outputNames } = makeSiteBuildFixture();
  const newlyIntroducedName = outputNames.at(-2);
  const before = new Map();

  try {
    outputNames.forEach((name, index) => {
      const filePath = path.join(rootDir, name);
      if (name === newlyIntroducedName) {
        before.set(name, null);
        return;
      }
      const bytes = Buffer.from(`prior ${name}\r\nline ${index}  \r\n`);
      fs.writeFileSync(filePath, bytes);
      before.set(name, bytes);
    });
    let publicationWrites = 0;
    const publicationLabels = [];

    assert.throws(
      () => buildSite({
        rootDir,
        log: () => assert.fail('failed build must not log completion'),
        writeFileImpl(rootPath, filePath, bytes, label, options) {
          publicationWrites += 1;
          publicationLabels.push(label);
          assert.equal(
            fs.existsSync(path.join(rootDir, 'artifacts/.site-build.lock')),
            true,
            'the site lock covers every publication write'
          );
          if (publicationWrites === 1) {
            assert.throws(
              () => withSiteBuildLock({ rootDir }, () => {}),
              /Site build lock is already held or unsafe/,
              'a second publisher cannot enter while the real build is publishing'
            );
          }
          if (publicationWrites === outputNames.length) {
            throw new Error('synthetic final-site-publication failure');
          }
          writeFileNoFollow(rootPath, filePath, bytes, label, options);
        }
      }),
      /synthetic final-site-publication failure/
    );

    assert.equal(
      publicationWrites,
      outputNames.length,
      'failure occurs at _headers after every generated page was atomically published'
    );
    assert.deepEqual(
      publicationLabels,
      outputNames.map((name) => `generated ${name}`),
      'the real build routes every page and _headers through one bundle publisher'
    );
    outputNames.forEach((name) => {
      const filePath = path.join(rootDir, name);
      const priorBytes = before.get(name);
      if (priorBytes === null) {
        assert.equal(fs.existsSync(filePath), false, `${name} did not exist and is removed`);
      } else {
        assert.deepEqual(fs.readFileSync(filePath), priorBytes, `${name} bytes are restored exactly`);
      }
    });
    assert.equal(
      fs.existsSync(path.join(rootDir, 'artifacts/.site-build.lock')),
      false,
      'the exclusive site lock is cleaned after rollback'
    );
    assert.deepEqual(
      fs.readdirSync(rootDir).filter((name) =>
        name.startsWith('.safe-output-') || name.includes('backup')),
      [],
      'publication and rollback leave no atomic-write temporary or backup files'
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('site rollback preserves a published path that changed ownership and still restores owned pages', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-site-ownership-'));
  const indexPath = path.join(rootDir, 'index.html');
  const workPath = path.join(rootDir, 'work.html');
  const headersPath = path.join(rootDir, '_headers');
  const priorIndex = Buffer.from('prior index\n');
  const priorWork = Buffer.from('prior work\n');
  const priorHeaders = Buffer.from('prior headers\n');
  const replacementWork = Buffer.from('replacement owned by another actor\n');

  try {
    fs.writeFileSync(indexPath, priorIndex);
    fs.writeFileSync(workPath, priorWork);
    fs.writeFileSync(headersPath, priorHeaders);
    let writes = 0;

    assert.throws(
      () => withSiteBuildLock({ rootDir }, () => publishSiteBundle({
        rootDir,
        entries: [
          { path: indexPath, bytes: 'new index\n', label: 'generated index.html', maxBytes: 1024 },
          { path: workPath, bytes: 'new work\n', label: 'generated work.html', maxBytes: 1024 },
          { path: headersPath, bytes: 'new headers\n', label: 'generated _headers', maxBytes: 1024 }
        ],
        writeFileImpl(rootPath, filePath, bytes, label, options) {
          writes += 1;
          if (writes === 3) {
            fs.unlinkSync(workPath);
            fs.writeFileSync(workPath, replacementWork);
            throw new Error('synthetic publication failure after ownership change');
          }
          writeFileNoFollow(rootPath, filePath, bytes, label, options);
        }
      })),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.match(error.message, /rollback operation\(s\) also failed/);
        assert.ok(error.errors.some((nested) => /changed ownership or content/.test(nested.message)));
        return true;
      }
    );

    assert.equal(writes, 3);
    assert.deepEqual(fs.readFileSync(indexPath), priorIndex, 'other transaction-owned pages still roll back');
    assert.deepEqual(fs.readFileSync(workPath), replacementWork, 'replacement ownership is preserved');
    assert.deepEqual(fs.readFileSync(headersPath), priorHeaders, 'unreached destination stays unchanged');
    assert.equal(fs.existsSync(path.join(rootDir, 'artifacts/.site-build.lock')), false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('site lock cleanup preserves a replacement lock and reports both operation and ownership failures', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-site-lock-ownership-'));
  const lockPath = path.join(rootDir, 'artifacts/.site-build.lock');
  const replacement = Buffer.from('replacement lock owned by another actor\n');

  try {
    assert.throws(
      () => withSiteBuildLock({ rootDir }, () => {
        fs.unlinkSync(lockPath);
        fs.writeFileSync(lockPath, replacement);
        throw new Error('synthetic site operation failure');
      }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.match(error.message, /build failed and its lock could not be released safely/);
        assert.ok(error.errors.some((nested) => /synthetic site operation failure/.test(nested.message)));
        assert.ok(error.errors.some((nested) => /lock changed ownership before release/.test(nested.message)));
        return true;
      }
    );
    assert.deepEqual(
      fs.readFileSync(lockPath),
      replacement,
      'cleanup refuses to unlink another actor\'s replacement lock'
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('site publication preflights every target and rejects destination or writer drift', () => {
  const roots = [];
  const makeRoot = (prefix) => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    roots.push(rootDir);
    return rootDir;
  };

  try {
    const preflightRoot = makeRoot('projectportfolio-site-preflight-');
    const preflightIndex = path.join(preflightRoot, 'index.html');
    fs.writeFileSync(preflightIndex, 'prior preflight index\n');
    let preflightWrites = 0;
    assert.throws(
      () => publishSiteBundle({
        rootDir: preflightRoot,
        entries: [
          { path: preflightIndex, bytes: 'new index\n', label: 'generated index.html', maxBytes: 1024 },
          {
            path: path.join(preflightRoot, 'missing-parent/work.html'),
            bytes: 'new work\n',
            label: 'generated work.html',
            maxBytes: 1024
          }
        ],
        writeFileImpl(...args) {
          preflightWrites += 1;
          writeFileNoFollow(...args);
        }
      }),
      /could not resolve .*missing-parent/
    );
    assert.equal(preflightWrites, 0, 'a late invalid target prevents every publication write');
    assert.equal(fs.readFileSync(preflightIndex, 'utf8'), 'prior preflight index\n');

    const driftRoot = makeRoot('projectportfolio-site-drift-');
    const driftIndex = path.join(driftRoot, 'index.html');
    const driftWork = path.join(driftRoot, 'work.html');
    const priorDriftIndex = Buffer.from('prior drift index\n');
    const externalWork = Buffer.from('external work update after snapshot\n');
    fs.writeFileSync(driftIndex, priorDriftIndex);
    fs.writeFileSync(driftWork, 'prior drift work\n');
    let driftWrites = 0;
    assert.throws(
      () => publishSiteBundle({
        rootDir: driftRoot,
        entries: [
          { path: driftIndex, bytes: 'new drift index\n', label: 'generated index.html', maxBytes: 1024 },
          { path: driftWork, bytes: 'new drift work\n', label: 'generated work.html', maxBytes: 1024 }
        ],
        writeFileImpl(rootPath, filePath, bytes, label, options) {
          driftWrites += 1;
          writeFileNoFollow(rootPath, filePath, bytes, label, options);
          if (driftWrites === 1) fs.writeFileSync(driftWork, externalWork);
        }
      }),
      /changed after publication preflight/
    );
    assert.equal(driftWrites, 1, 'snapshot drift is detected before the changed target is published');
    assert.deepEqual(fs.readFileSync(driftIndex), priorDriftIndex, 'owned first write rolls back');
    assert.deepEqual(fs.readFileSync(driftWork), externalWork, 'external target update is preserved');

    const writerRoot = makeRoot('projectportfolio-site-writer-');
    const writerIndex = path.join(writerRoot, 'index.html');
    const priorWriterIndex = Buffer.from('prior writer index\n');
    fs.writeFileSync(writerIndex, priorWriterIndex);
    assert.throws(
      () => publishSiteBundle({
        rootDir: writerRoot,
        entries: [
          { path: writerIndex, bytes: 'expected writer index\n', label: 'generated index.html', maxBytes: 1024 }
        ],
        writeFileImpl(rootPath, filePath, _bytes, label, options) {
          writeFileNoFollow(rootPath, filePath, 'wrong writer bytes\n', label, options);
        }
      }),
      /does not match its validated rendered bytes/
    );
    assert.deepEqual(
      fs.readFileSync(writerIndex),
      priorWriterIndex,
      'a faulty writer is detected and the exact prior output is restored'
    );

    const committedRoot = makeRoot('projectportfolio-site-committed-error-');
    const committedIndex = path.join(committedRoot, 'index.html');
    const priorCommittedIndex = Buffer.from('prior committed index\n');
    fs.writeFileSync(committedIndex, priorCommittedIndex);
    assert.throws(
      () => publishSiteBundle({
        rootDir: committedRoot,
        entries: [
          { path: committedIndex, bytes: 'committed intended index\n', label: 'generated index.html', maxBytes: 1024 }
        ],
        writeFileImpl(rootPath, filePath, bytes, label, options) {
          writeFileNoFollow(rootPath, filePath, bytes, label, options);
          throw new Error('synthetic writer error after atomic commit');
        }
      }),
      /synthetic writer error after atomic commit/
    );
    assert.deepEqual(
      fs.readFileSync(committedIndex),
      priorCommittedIndex,
      'an intended output committed before a writer error is still rolled back'
    );

    roots.forEach((rootDir) => {
      assert.deepEqual(
        fs.readdirSync(rootDir).filter((name) => name.startsWith('.safe-output-')),
        [],
        `no atomic-write temporary files leak from ${path.basename(rootDir)}`
      );
    });
  } finally {
    roots.forEach((rootDir) => fs.rmSync(rootDir, { recursive: true, force: true }));
  }
});

test('sanitizeHref allows https and safe relative links', () => {
  assert.equal(sanitizeHref('https://example.com/path?q=1', 'link'), 'https://example.com/path?q=1');
  assert.equal(sanitizeHref('docs/resume.pdf', 'link'), 'docs/resume.pdf');
  assert.equal(sanitizeHref('/reading.html', 'link'), '/reading.html');
  assert.equal(sanitizeHref('#contact', 'link'), '#contact');
});

test('sanitizeHref blocks dangerous schemes', () => {
  assert.throws(() => sanitizeHref('javascript:alert(1)', 'link'), /only https URLs are allowed/);
  for (const url of [
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    'java\rscript:alert(1)'
  ]) {
    assert.throws(() => sanitizeHref(url, 'link'), /ASCII control characters/);
  }
  assert.throws(() => sanitizeHref('data:text/html;base64,AAAA', 'link'), /only https URLs are allowed/);
  assert.throws(() => sanitizeHref('http://example.com', 'link'), /only https URLs are allowed/);
});

test('sanitizeAssetPath blocks traversal and absolute paths', () => {
  assert.equal(sanitizeAssetPath('book/2025/cover-300.jpg', 'cover'), 'book/2025/cover-300.jpg');
  assert.throws(() => sanitizeAssetPath('../secret.jpg', 'cover'), /path traversal|dot segments/);
  assert.throws(() => sanitizeAssetPath('/etc/passwd', 'cover'), /must be relative/);
  assert.throws(() => sanitizeAssetPath('book/2025/../../secret.jpg', 'cover'), /path traversal|dot segments/);
});

test('validateDataCollections accepts valid payload', () => {
  const data = makeValidData();
  assert.doesNotThrow(() => validateDataCollections(data));
});

test('validateDataCollections accepts certifications without public links', () => {
  const data = makeValidData();
  delete data.certifications[0].link;

  assert.doesNotThrow(() => validateDataCollections(data));
});

test('validateDataCollections accepts articles without public links', () => {
  const data = makeValidData();
  delete data.profile.articles[0].link;

  assert.doesNotThrow(() => validateDataCollections(data));
});

test('validateDataCollections rejects unknown top-level collections', () => {
  const data = makeValidData();
  data.unexpected = [];

  assert.throws(() => validateDataCollections(data), /Invalid data at data: unexpected key\(s\): unexpected/);
});

test('validateDataCollections rejects malformed payloads', () => {
  const badScheme = makeValidData();
  badScheme.featured[0].links[0].url = 'javascript:alert(1)';
  assert.throws(() => validateDataCollections(badScheme), /only https URLs are allowed/);

  const badShape = makeValidData();
  badShape.reading[0].year = 1500;
  assert.throws(() => validateDataCollections(badShape), /year in range 1900\.\.2100/);

  const nonCanonicalYear = makeValidData();
  nonCanonicalYear.reading[0].year = '2025" autofocus onfocus="alert(1)';
  assert.throws(() => validateDataCollections(nonCanonicalYear), /expected a four-digit year/);

  const unknownField = makeValidData();
  unknownField.skills[0].unexpected = 'value';
  assert.throws(() => validateDataCollections(unknownField), /unexpected key\(s\): unexpected/);

  const badArticle = makeValidData();
  badArticle.profile.articles[0].link = 'javascript:alert(1)';
  assert.throws(() => validateDataCollections(badArticle), /only https URLs are allowed/);

  const badHonor = makeValidData();
  badHonor.profile.honors[0].unexpected = 'value';
  assert.throws(() => validateDataCollections(badHonor), /unexpected key\(s\): unexpected/);

  const duplicateReading = makeValidData();
  duplicateReading.reading.push({ ...duplicateReading.reading[0], title: 'Different title' });
  assert.throws(() => validateDataCollections(duplicateReading), /duplicate reading record/);

  const badCommunityId = makeValidData();
  badCommunityId.profile.community[0].id = 'bad id';
  assert.throws(() => validateDataCollections(badCommunityId), /expected an identifier/);

  const duplicateFeaturedOrder = makeValidData();
  duplicateFeaturedOrder.featured[1].featured_order = 1;
  assert.throws(() => validateDataCollections(duplicateFeaturedOrder), /duplicate featured order/);

  const invalidProjectStatus = makeValidData();
  invalidProjectStatus.featured[0].status = 'unknown';
  assert.throws(() => validateDataCollections(invalidProjectStatus), /expected active, maintained/);

  const tooFewFeatured = makeValidData();
  tooFewFeatured.featured[2].featured = false;
  delete tooFewFeatured.featured[2].featured_order;
  delete tooFewFeatured.featured[2].case_study;
  assert.throws(() => validateDataCollections(tooFewFeatured), /expected exactly 3 featured projects/);
});

test('validateDataCollections rejects incomplete or mismatched case studies', () => {
  const missingStudy = makeValidData();
  missingStudy.caseStudies.pop();
  assert.throws(() => validateDataCollections(missingStudy), /one case study for each featured project/);

  const badSlug = makeValidData();
  badSlug.caseStudies[0].slug = '../case-study-project-alpha.html';
  assert.throws(() => validateDataCollections(badSlug), /expected case-study-<name>\.html/);

  const mismatchedProjectLink = makeValidData();
  mismatchedProjectLink.featured[0].case_study = '/case-study-wrong.html';
  assert.throws(() => validateDataCollections(mismatchedProjectLink), /expected \/case-study-project-alpha\.html/);

  const nonFeaturedStudy = makeValidData();
  nonFeaturedStudy.featured.push({
    id: 'project-delta',
    featured: false,
    status: 'active',
    capabilities: ['Tooling'],
    title: 'Project Delta',
    timeframe: '2025',
    problem: 'A problem.',
    impact: 'An outcome.',
    tech: [],
    links: []
  });
  nonFeaturedStudy.caseStudies[0].project_id = 'project-delta';
  assert.throws(() => validateDataCollections(nonFeaturedStudy), /restricted to featured projects/);
});

test('renderReadingGrid escapes data attribute filter values', () => {
  const html = renderReadingGrid([
    {
      year: 2025,
      title: 'Secure Design',
      author: 'A. Author',
      isbn: '978-1-234567-89-7',
      cover: 'book/2025/2025-1-300.jpg',
      tags: ['Security" autofocus onfocus="alert(1)']
    }
  ]);

  assert.match(html, /data-tags="security&quot; autofocus onfocus=&quot;alert\(1\)"/);
  assert.doesNotMatch(html, /data-tags="[^"]*" autofocus/);
});

test('rendered action links include privacy-safe telemetry annotations', () => {
  const html = renderProfileSchema(makeValidProfile(), []);
  assert.doesNotMatch(html, /data-telemetry/);

  const rendered = renderReadingGrid([
    {
      year: 2025,
      title: 'Secure Design',
      author: 'A. Author',
      isbn: '978-1-234567-89-7',
      cover: 'book/2025/2025-1-300.jpg',
      tags: ['Security']
    }
  ]);
  assert.match(rendered, /data-reading-count/);
});

test('validateReadingAssetInventory requires declared cover files to exist', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-covers-'));
  const coverPath = path.join(rootDir, 'book/2025/secure-design-300.jpg');
  try {
    fs.mkdirSync(path.dirname(coverPath), { recursive: true });
    fs.writeFileSync(coverPath, 'cover');

    const data = makeValidData();
    assert.doesNotThrow(() => validateReadingAssetInventory(data.reading, { rootDir }));

    fs.rmSync(coverPath);
    assert.throws(
      () => validateReadingAssetInventory(data.reading, { rootDir }),
      /missing declared cover asset/
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('validateReadingAssetInventory rejects symlinked and non-regular covers without following outside links', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-covers-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-covers-outside-'));
  const coverPath = path.join(rootDir, 'book/2025/secure-design-300.jpg');
  const externalCover = path.join(outsideDir, '2025/secure-design-300.jpg');
  const data = makeValidData();

  try {
    fs.mkdirSync(path.dirname(coverPath), { recursive: true });
    fs.mkdirSync(path.dirname(externalCover), { recursive: true });
    fs.writeFileSync(externalCover, 'outside cover must remain untouched');

    fs.symlinkSync(externalCover, coverPath);
    assert.throws(
      () => validateReadingAssetInventory(data.reading, { rootDir }),
      /must not contain symbolic links/
    );
    fs.unlinkSync(coverPath);
    fs.rmdirSync(path.dirname(coverPath));
    fs.rmdirSync(path.join(rootDir, 'book'));

    fs.symlinkSync(outsideDir, path.join(rootDir, 'book'));
    assert.throws(
      () => validateReadingAssetInventory(data.reading, { rootDir }),
      /must not contain symbolic links/
    );
    fs.unlinkSync(path.join(rootDir, 'book'));

    fs.mkdirSync(coverPath, { recursive: true });
    assert.throws(
      () => validateReadingAssetInventory(data.reading, { rootDir }),
      /not a regular file/
    );
    assert.equal(fs.readFileSync(externalCover, 'utf8'), 'outside cover must remain untouched');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('collectInlineScriptHashes only hashes inline scripts', () => {
  const html = [
    '<script src="js/main.js" defer></script>',
    '<script>console.log("first")</script>',
    '<script type="application/ld+json">{"@context":"https://schema.org"}</script>'
  ].join('');

  const hashes = collectInlineScriptHashes(html);

  assert.deepEqual(hashes, [
    hashInlineScript('console.log("first")'),
    hashInlineScript('{"@context":"https://schema.org"}')
  ]);
});

test('collectInlineScriptHashes treats quoted greater-than signs as attributes and finds src in either position', () => {
  const html = [
    '<p>\u0130</p>',
    '<script data-check="left > right">doubleQuoted()</script>',
    "<script data-check='left > right'>singleQuoted()</script>",
    '<script data-check="left > right" src="js/after.js">ignoredAfter()</script>',
    "<script src='js/before.js' data-check='left > right'>ignoredBefore()</script>"
  ].join('');

  assert.deepEqual(collectInlineScriptHashes(html), [
    hashInlineScript('doubleQuoted()'),
    hashInlineScript('singleQuoted()')
  ]);
});

test('collectInlineScriptHashes skips commented markup and handles script self-closing syntax like a browser', () => {
  const html = [
    '<!-- <script data-note="not > markup">ignoredComment()</script> -->',
    '<style>x::before{content:"<script>ignoredRawText()"}</style>',
    '<script>realAfterComment()</script>',
    '<script/>selfClosingSyntaxIsStillInline()</script>'
  ].join('');

  assert.deepEqual(collectInlineScriptHashes(html), [
    hashInlineScript('realAfterComment()'),
    hashInlineScript('selfClosingSyntaxIsStillInline()')
  ]);
});

test('collectInlineScriptHashes handles tolerant script end tags', () => {
  const html = [
    '<script src="js/main.js" defer></script >',
    '<script>console.log("first")</script >',
    '<script>console.log("second")</script\t\n bar>',
    '<script>console.log("slash")</script/>'
  ].join('');

  assert.deepEqual(collectInlineScriptHashes(html), [
    hashInlineScript('console.log("first")'),
    hashInlineScript('console.log("second")'),
    hashInlineScript('console.log("slash")')
  ]);
});

test('collectInlineScriptHashes distinguishes data-src from a valueless src attribute', () => {
  const html = [
    '<script data-src="metadata">console.log("inline")</script>',
    '<script src>console.log("not executed inline")</script>'
  ].join('');

  assert.deepEqual(collectInlineScriptHashes(html), [hashInlineScript('console.log("inline")')]);
});

test('collectInlineScriptHashes returns every exact hash for a large document', () => {
  const scriptCount = 6000;
  const scripts = Array.from(
    { length: scriptCount },
    (_, index) => `globalThis.value=${index}`
  );
  const html = scripts.map((content) => `<script>${content}</script>`).join('');

  assert.deepEqual(
    collectInlineScriptHashes(html),
    scripts.map((content) => hashInlineScript(content))
  );
});

test('stripTrailingWhitespace preserves mixed line endings while trimming each line', () => {
  const content = 'alpha  \r\nbeta\t \ngamma \rdelta\t';

  assert.equal(stripTrailingWhitespace(content), 'alpha\r\nbeta\ngamma\rdelta');
});

test('injectCspScriptHashes replaces the template token with computed hashes', () => {
  const html = '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'{{CSP_SCRIPT_HASHES}};">\n<script>{"safe":true}</script>';
  const injected = injectCspScriptHashes(html, html);
  const directive = renderCspScriptHashesDirective(html);

  assert.ok(directive.includes('sha256-'));
  assert.match(injected, new RegExp(`script-src 'self'${directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`));
  assert.doesNotMatch(injected, /\{\{CSP_SCRIPT_HASHES}}/);
});

test('renderProfileSchema escapes script-breaking JSON-LD content', () => {
  const profile = makeValidProfile();
  profile.articles[0].title = 'Safe </script><script>alert(1)</script> title';
  const schema = renderProfileSchema(profile, makeValidData().certifications);

  assert.doesNotMatch(schema, /<\/script>/i);
  assert.match(schema, /\\u003c\/script\\u003e/);
});
