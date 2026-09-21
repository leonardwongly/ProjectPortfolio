import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  collectInlineScriptHashes,
  hashInlineScript,
  injectCspScriptHashes,
  renderProfileSchema
} = require('../../../scripts/build.js');
const { stripTrailingWhitespace } = require('../../../scripts/lib/static-rendering.cjs');

const buildScript = path.resolve(import.meta.dirname, '../../../scripts/build.js');

// ---------------------------------------------------------------------------
// buildSite() helpers: scripts/build.js resolves data paths against
// process.cwd() at import time, so end-to-end behavior is exercised by
// running the build against a temp copy of the project skeleton.
// ---------------------------------------------------------------------------

function makeSandbox() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildjs-adversarial-'));
  // Safe publication requires the destination parent to exist as a real directory.
  for (const dir of ['src/.well-known', '.well-known', 'partials', 'data']) {
    fs.mkdirSync(path.join(rootDir, dir), { recursive: true });
  }
  // The build copies this required static input; no remote key lookup occurs.
  fs.writeFileSync(path.join(rootDir, 'src', '.well-known', 'http-message-signatures-directory'), '{"keys":[]}\n');
  fs.writeFileSync(path.join(rootDir, 'partials', 'nav.html'), '<nav>NAV</nav>');
  fs.writeFileSync(path.join(rootDir, 'partials', 'footer.html'), '<footer>FOOTER</footer>');
  fs.writeFileSync(
    path.join(rootDir, 'src', '_headers.template'),
    'Content-Security-Policy: script-src \'self\'{{CSP_SCRIPT_HASHES}};\n'
  );
  const pageTemplate = [
    '<!DOCTYPE html>',
    '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'{{CSP_SCRIPT_HASHES}};">',
    '<script src="js/main.js" defer></script>',
    '<script>{"safe":true}</script>',
    '{{PROFILE_SCHEMA}}',
    '{{HERO}}'
  ].join('\n');
  for (const page of ['index.html', 'work.html', 'reading.html', 'offline.html']) {
    fs.writeFileSync(path.join(rootDir, 'src', page), pageTemplate);
  }
  fs.writeFileSync(path.join(rootDir, 'src', 'case-study.html'), [
    '<!DOCTYPE html>',
    '<title>{{CASE_STUDY_TITLE}}</title>',
    '{{CASE_STUDY_DESCRIPTION}}',
    '{{CASE_STUDY_CANONICAL}}',
    '{{CASE_STUDY}}'
  ].join('\n'));
  return rootDir;
}

function makeValidProfile() {
  return {
    person: {
      name: 'Example Person',
      job_title: 'Software Engineer',
      location: 'Singapore',
      url: 'https://example.com/',
      works_for: 'Example Org',
      client_context: 'Serving Example Client',
      same_as: ['https://linkedin.com/in/example'],
      knows_about: ['Security']
    },
    hero: {
      eyebrow: 'Eyebrow',
      headline: 'Headline',
      lead: 'Lead',
      actions: [{ label: 'Contact', href: '#contact', variant: 'primary' }],
      highlights: [{ label: 'Focus', value: 'Security', href: '#experience' }],
      current: { label: 'Currently', value: 'Engineer', sub: 'Sub' }
    },
    education: [{ institution: 'Example Poly', credential: 'Diploma', dates: '2014–2017' }],
    publication: {
      title: 'Publication',
      venue: 'Venue',
      date: 'May 1, 2025',
      authors: 'Example Person & Collaborator',
      links: [{ label: 'Paper', url: 'https://example.com/paper' }]
    },
    articles: [],
    honors: [],
    languages: [],
    community: [],
    site_engineering: {
      eyebrow: 'Site Engineering',
      headline: 'Built deterministically.',
      lede: 'Generated content is validated.',
      items: [{ title: 'Static generation', detail: 'Structured content generates HTML.' }]
    },
    contact: {
      eyebrow: 'Contact',
      headline: 'Reach out.',
      lede: 'Direct contact only.',
      actions: [{ label: 'Email', href: 'https://email.example.com', variant: 'primary' }],
      meta: ['Singapore']
    }
  };
}

function writeData(rootDir, overrides = {}) {
  const base = {
    profile: makeValidProfile(),
    'featured-projects': [],
    'case-studies': [],
    skills: [],
    experience: [],
    certifications: [],
    reading: []
  };
  Object.assign(base, overrides);
  for (const [name, value] of Object.entries(base)) {
    fs.writeFileSync(path.join(rootDir, 'data', `${name}.json`), JSON.stringify(value));
  }
}

function makeFeaturedProject(id, order) {
  return {
    id,
    featured: true,
    featured_order: order,
    status: 'active',
    capabilities: ['Security Governance'],
    case_study: `/case-study-${id}.html`,
    title: `Project ${id}`,
    timeframe: '2025',
    problem: 'Problem.',
    impact: 'Impact.',
    tech: ['Node.js'],
    links: [{ label: 'GitHub', url: 'https://github.com/example/repo' }]
  };
}

function makeCaseStudy(id) {
  return {
    id: `study-${id}`,
    project_id: id,
    slug: `case-study-${id}.html`,
    eyebrow: 'Eyebrow',
    title: 'Study',
    summary: 'Summary',
    role: 'Engineer',
    timeframe: '2025',
    repository_url: 'https://github.com/example/repo',
    challenge: 'Challenge',
    architecture_intro: 'Intro',
    ownership: ['O1', 'O2', 'O3'],
    architecture: [
      { label: 'Capture', detail: 'D1.' },
      { label: 'Govern', detail: 'D2.' },
      { label: 'Record', detail: 'D3.' }
    ],
    decisions: [
      { title: 'T1', detail: 'D1.' },
      { title: 'T2', detail: 'D2.' },
      { title: 'T3', detail: 'D3.' }
    ],
    controls: ['Authentication', 'Authorization', 'Validation', 'Audit trail'],
    validation: ['Unit coverage', 'Integration coverage', 'Smoke checks'],
    outcomes: ['Working implementation', 'Reviewable evidence', 'Documented limitations'],
    limitations: ['Depends on configuration.', 'Does not remove provider constraints.'],
    next_steps: ['Expand validation.', 'Improve diagnostics.']
  };
}

function writeValidData(rootDir, overrides = {}) {
  const base = {
    profile: makeValidProfile(),
    'featured-projects': [makeFeaturedProject('alpha', 1), makeFeaturedProject('beta', 2), makeFeaturedProject('gamma', 3)],
    'case-studies': [makeCaseStudy('alpha'), makeCaseStudy('beta'), makeCaseStudy('gamma')],
    skills: [{ category: 'Languages', items: ['JavaScript'] }],
    experience: [
      {
        org: 'Example Org',
        role: 'Software Engineer',
        dates: '2025',
        impact_bullets: ['Delivered updates.'],
        tech: ['Node.js']
      }
    ],
    certifications: [
      { title: 'Secure Systems', issuer: 'Example Institute', issued: 'Issued 2025' }
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
  Object.assign(base, overrides);
  for (const [name, value] of Object.entries(base)) {
    fs.writeFileSync(path.join(rootDir, 'data', `${name}.json`), JSON.stringify(value));
  }
}

function createReadingCover(rootDir) {
  const coverPath = path.join(rootDir, 'book', '2025', 'secure-design-300.jpg');
  fs.mkdirSync(path.dirname(coverPath), { recursive: true });
  fs.writeFileSync(coverPath, 'cover');
}

function runBuild(rootDir) {
  try {
    return { ok: true, stdout: execFileSync(process.execPath, [buildScript], { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (caught) {
    return { ok: false, stderr: String(caught.stderr) };
  }
}

// ---------------------------------------------------------------------------
// readJson adversarial behavior
// ---------------------------------------------------------------------------

test('missing data file produces an error naming the actual missing file', () => {
  const rootDir = makeSandbox();
  writeValidData(rootDir);
  createReadingCover(rootDir);
  fs.rmSync(path.join(rootDir, 'data', 'featured-projects.json'));

  const result = runBuild(rootDir);
  assert.ok(!result.ok, 'expected build to fail');
  assert.match(result.stderr, /StableFileReadError: data\/featured-projects\.json: file is missing/);
  assert.doesNotMatch(result.stderr, /data[\\/](?:profile|case-studies|skills|experience|certifications|reading)\.json/);
  assert.equal(fs.existsSync(path.join(rootDir, 'index.html')), false, 'failed input validation must not publish output');
});

test('malformed JSON in a data file fails the build with a parse error', () => {
  const rootDir = makeSandbox();
  writeData(rootDir);
  fs.writeFileSync(path.join(rootDir, 'data', 'skills.json'), '{not-json');

  const result = runBuild(rootDir);
  assert.ok(!result.ok, 'expected build to fail');
  assert.match(result.stderr, /Error: Invalid JSON in build input data\/skills\.json:/);
  assert.equal(fs.existsSync(path.join(rootDir, 'index.html')), false, 'malformed input must not publish output');
});

// ---------------------------------------------------------------------------
// escapeHtml usage gaps: script-like data content vs CSP hash collection
// ---------------------------------------------------------------------------

test('script-like data content is escaped and does not create phantom CSP hashes in generated output', () => {
  const rootDir = makeSandbox();
  const profile = makeValidProfile();
  profile.hero.headline = 'Safe </script><script>alert(1)</script> headline';
  profile.hero.eyebrow = 'Eyebrow <script src="evil.js"></script>';
  writeValidData(rootDir, { profile });
  createReadingCover(rootDir);

  const result = runBuild(rootDir);
  assert.ok(result.ok, `expected build to succeed, stderr: ${result.stderr}`);
  const generatedIndex = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const generatedHeaders = fs.readFileSync(path.join(rootDir, '_headers'), 'utf8');

  // Data content must be escaped, not emitted as live markup.
  assert.doesNotMatch(generatedIndex, /<script>alert\(1\)<\/script>/);
  assert.match(generatedIndex, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(generatedIndex, /<script src="evil\.js"><\/script>/);

  // Only the real inline script may be hashed; escaped text must not add a hash.
  const expectedHashes = [hashInlineScript('{"safe":true}')];
  const expectedQuoted = expectedHashes.map((h) => `'${h}'`);
  const headerHashes = generatedHeaders.match(/'sha256-[^']+'/g) || [];
  assert.deepEqual(headerHashes, expectedQuoted);

  // The inline meta CSP on the generated index must match the headers hash set.
  const metaCsp = generatedIndex.match(/content="script-src 'self'([^"]*)"/)?.[1] ?? '';
  const metaHashes = metaCsp.match(/'sha256-[^']+'/g) || [];
  assert.deepEqual(metaHashes, expectedQuoted);
});

// ---------------------------------------------------------------------------
// CSP hash computation with unicode and CRLF line endings
// ---------------------------------------------------------------------------

test('CRLF line endings inside inline scripts produce a distinct byte-exact hash', () => {
  const lf = '<script>\nconsole.log("x");\n</script>';
  const crlf = '<script>\r\nconsole.log("x");\r\n</script>';

  const lfHashes = collectInlineScriptHashes(lf);
  const crlfHashes = collectInlineScriptHashes(crlf);

  assert.equal(lfHashes.length, 1);
  assert.equal(crlfHashes.length, 1);
  assert.notDeepEqual(lfHashes, crlfHashes, 'browsers hash raw script bytes, so CRLF must change the hash');
  assert.equal(crlfHashes[0], hashInlineScript('\r\nconsole.log("x");\r\n'));
});

test('unicode inline script content is hashed as UTF-8 bytes', () => {
  const body = 'const emoji = "🛡️";';
  const html = `<script>${body}</script>`;
  assert.deepEqual(collectInlineScriptHashes(html), [hashInlineScript(body)]);
});

test('CRLF-tolerant uppercase script tags are collected exactly once', () => {
  const html = '<SCRIPT TYPE="text/javascript">\r\nupper();\r\n</SCRIPT\t\n foo>';
  assert.deepEqual(collectInlineScriptHashes(html), [hashInlineScript('\r\nupper();\r\n')]);
});

// ---------------------------------------------------------------------------
// findScriptStartTag / findScriptEndTag adversarial inputs
// ---------------------------------------------------------------------------

test('commented scripts are ignored while stray end-tag fragments stay in the real script body', () => {
  const html = [
    '<!-- <script>alert("commented out")</script> -->',
    '<script type="application/ld+json">{"safe":true}</script>',
    '<SCRIPT >real()</SCRIPTEXAMPLE><script src="external.js" defer></script>',
    '<script src="external.js" defer></script>'
  ].join('');

  // Comments are inert. </SCRIPTEXAMPLE> is not an end tag, so the real body
  // includes the nested-looking opening tag through the next </script>.
  // The separate external script contributes no inline hash.
  assert.deepEqual(collectInlineScriptHashes(html), [
    hashInlineScript('{"safe":true}'),
    hashInlineScript('real()</SCRIPTEXAMPLE><script src="external.js" defer>')
  ]);
});

test('script-like tokens inside attributes and raw-text elements do not add CSP hashes', () => {
  const fragments = [
    '<div title="<script>not real()</script>">safe</div>',
    "<div title='<script>not real()</script>'>safe</div>",
    ...['style', 'textarea', 'title', 'xmp'].map((tag) => `<${tag}><script>not real()</script></${tag}>`)
  ];
  for (const fragment of fragments) {
    const html = `${fragment}<script>real()</script>`;
    assert.deepEqual(collectInlineScriptHashes(html), [hashInlineScript('real()')], fragment);
    assert.equal(
      injectCspScriptHashes("script-src 'self'{{CSP_SCRIPT_HASHES}};", html),
      `script-src 'self' '${hashInlineScript('real()')}';`
    );
  }
});

test('unterminated script tags stop hash collection without throwing', () => {
  assert.deepEqual(collectInlineScriptHashes('<script>never closed'), []);
  assert.deepEqual(collectInlineScriptHashes('<script>no end tag</script'), []);
  assert.deepEqual(collectInlineScriptHashes('<script src="x.js">'), []);
});

// ---------------------------------------------------------------------------
// stripTrailingWhitespace idempotence
// ---------------------------------------------------------------------------

test('stripTrailingWhitespace is idempotent across spaces, tabs, and blank lines', () => {
  const sample = [
    'line one   ',
    '\t\t',
    '',
    '  indented\t',
    'trailing \t mixed \r'
  ].join('\n');

  const firstPass = stripTrailingWhitespace(sample);
  const secondPass = stripTrailingWhitespace(firstPass);
  assert.equal(secondPass, firstPass, 'stripTrailingWhitespace must be idempotent');
  assert.equal(firstPass, 'line one\n\n\n  indented\ntrailing \t mixed\r');
  assert.equal(stripTrailingWhitespace('a \r\nb\t\rc \n'), 'a\r\nb\rc\n', 'preserve line endings while trimming spaces and tabs');
});

// ---------------------------------------------------------------------------
// Template placeholder collisions
// ---------------------------------------------------------------------------

test('data-supplied placeholder-like text is escaped by renderers, not re-expanded', () => {
  const profile = makeValidProfile();
  profile.publication.title = 'Pub </script>{{PROFILE_SCHEMA}}';
  profile.hero.headline = 'Headline {{PROFILE_SCHEMA}}';
  // A later token also must not be expanded after HERO inserts data into HTML.
  profile.hero.lead = 'Lead <safe> {{READING_GRID}}';

  // The renderer accepts these strings and escapes HTML delimiters, not braces.
  // The full build must preserve the same data, not mistake it for source tokens.
  const schema = renderProfileSchema(profile, [{ title: 'Cert', issuer: 'Issuer', issued: 'Issued 2025' }]);
  assert.ok(schema.includes('Pub \\u003c/script\\u003e{{PROFILE_SCHEMA}}'));
  assert.equal(JSON.parse(schema)['@graph'].find((node) => node['@type'] === 'ScholarlyArticle').headline, profile.publication.title);

  const rootDir = makeSandbox();
  writeValidData(rootDir, { profile });
  createReadingCover(rootDir);
  const minimalPage = [
    '<!DOCTYPE html>',
    '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'{{CSP_SCRIPT_HASHES}};">',
    '<script>{"safe":true}</script>',
    '{{HERO}}'
  ].join('\n');
  for (const page of ['index.html', 'work.html', 'reading.html', 'offline.html']) {
    fs.writeFileSync(path.join(rootDir, 'src', page), minimalPage);
  }

  const result = runBuild(rootDir);
  assert.ok(result.ok, `expected build to preserve literal data tokens, stderr: ${result.stderr}`);
  const generatedIndex = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  assert.ok(generatedIndex.includes('<h1>Headline {{PROFILE_SCHEMA}}</h1>'), 'data token text must survive literally');
  assert.ok(generatedIndex.includes('<p class="lead">Lead &lt;safe&gt; {{READING_GRID}}</p>'), 'later tokens must not expand data into markup');
  assert.doesNotMatch(generatedIndex, /\{\{CSP_SCRIPT_HASHES}}/);
});

test('placeholder collision test also verifies schema output keeps tokens inert', () => {
  const profile = makeValidProfile();
  profile.publication.title = 'Pub {{READING_GRID}}';
  const certifications = [{ title: 'Cert {{READING_GRID}}', issuer: 'Issuer', issued: 'Issued 2025' }];
  const schema = renderProfileSchema(profile, certifications);
  assert.ok(schema.includes('{{READING_GRID}}'), 'schema output must keep data tokens literal');
});

// ---------------------------------------------------------------------------
// Asset traversal paths
// ---------------------------------------------------------------------------

test('traversal and absolute paths in certification icons are rejected during build validation', () => {
  const rootDir = makeSandbox();
  writeValidData(rootDir, {
    certifications: [
      { title: 'T1', issuer: 'I', issued: 'Issued 2025', icon: '../outside/secret.png' },
      { title: 'T2', issuer: 'I', issued: 'Issued 2025', icon: '/absolute/path/icon.png' }
    ]
  });

  const result = runBuild(rootDir);
  assert.ok(!result.ok, 'expected build to fail');
  assert.match(result.stderr, /(path traversal|must be relative|dot segments)/i, `stderr was: ${result.stderr}`);
});

test('traversal paths in reading covers are rejected during build validation', () => {
  const rootDir = makeSandbox();
  const profile = makeValidProfile();
  writeValidData(rootDir, {
    profile,
    reading: [
      {
        year: 2025,
        title: 'Book',
        author: 'A. Author',
        isbn: '978-1-234567-89-7',
        cover: 'book/2025/../../outside.jpg',
        link: 'https://books.example.com/book',
        tags: ['Security']
      }
    ]
  });

  const result = runBuild(rootDir);
  assert.ok(!result.ok, 'expected build to fail');
  assert.match(result.stderr, /(path traversal|dot segments|missing declared cover asset)/i, `stderr was: ${result.stderr}`);
});

// ---------------------------------------------------------------------------
// Duplicate partial tokens
// ---------------------------------------------------------------------------

test('duplicate partial placeholders in a source page are each replaced exactly once', () => {
  const rootDir = makeSandbox();
  writeValidData(rootDir);
  createReadingCover(rootDir);
  fs.writeFileSync(path.join(rootDir, 'src', 'index.html'), [
    '<!DOCTYPE html>',
    '<nav>{{NAV}}</nav>{{NAV}}',
    '<script>{"safe":true}</script>'
  ].join('\n'));

  const result = runBuild(rootDir);
  assert.ok(result.ok, `expected build to succeed, stderr: ${result.stderr}`);
  const generatedIndex = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const occurrences = (generatedIndex.match(/<nav>NAV<\/nav>/g) || []).length;
  assert.equal(occurrences, 2, 'each duplicate placeholder occurrence must be replaced');
  assert.doesNotMatch(generatedIndex, /\{\{NAV}}/);
});
