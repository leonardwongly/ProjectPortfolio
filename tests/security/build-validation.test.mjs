import assert from 'node:assert/strict';
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
  renderCspScriptHashesDirective,
  renderProfileSchema,
  sanitizeHref,
  sanitizeAssetPath,
  validateReadingAssetInventory,
  validateDataCollections
} = require('../../scripts/build.js');

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
      highlights: [{ label: 'Focus', value: 'Security' }],
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
  return {
    profile: makeValidProfile(),
    featured: [
      {
        id: 'project-alpha',
        title: 'Project Alpha',
        timeframe: '2025',
        problem: 'Problem statement.',
        impact: 'Impact statement.',
        tech: ['Node.js', 'Security'],
        links: [{ label: 'GitHub', url: 'https://github.com/example/repo' }]
      }
    ],
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
}

test('sanitizeHref allows https and safe relative links', () => {
  assert.equal(sanitizeHref('https://example.com/path?q=1', 'link'), 'https://example.com/path?q=1');
  assert.equal(sanitizeHref('docs/resume.pdf', 'link'), 'docs/resume.pdf');
  assert.equal(sanitizeHref('/reading.html', 'link'), '/reading.html');
  assert.equal(sanitizeHref('#contact', 'link'), '#contact');
});

test('sanitizeHref blocks dangerous schemes', () => {
  assert.throws(() => sanitizeHref('javascript:alert(1)', 'link'), /only https URLs are allowed/);
  assert.throws(() => sanitizeHref('data:text/html;base64,AAAA', 'link'), /only https URLs are allowed/);
  assert.throws(() => sanitizeHref('http://example.com', 'link'), /only https URLs are allowed/);
});

test('sanitizeAssetPath blocks traversal and absolute paths', () => {
  assert.equal(sanitizeAssetPath('book/2025/cover-300.jpg', 'cover'), 'book/2025/cover-300.jpg');
  assert.throws(() => sanitizeAssetPath('../secret.jpg', 'cover'), /path traversal/);
  assert.throws(() => sanitizeAssetPath('/etc/passwd', 'cover'), /must be relative/);
  assert.throws(() => sanitizeAssetPath('book/2025/../../secret.jpg', 'cover'), /path traversal/);
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

test('validateDataCollections rejects malformed payloads', () => {
  const badScheme = makeValidData();
  badScheme.featured[0].links[0].url = 'javascript:alert(1)';
  assert.throws(() => validateDataCollections(badScheme), /only https URLs are allowed/);

  const badShape = makeValidData();
  badShape.reading[0].year = 1500;
  assert.throws(() => validateDataCollections(badShape), /year in range 1900\.\.2100/);

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
});

test('validateReadingAssetInventory requires declared cover files to exist', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-covers-'));
  const coverPath = path.join(rootDir, 'book/2025/secure-design-300.jpg');
  fs.mkdirSync(path.dirname(coverPath), { recursive: true });
  fs.writeFileSync(coverPath, 'cover');

  const data = makeValidData();
  assert.doesNotThrow(() => validateReadingAssetInventory(data.reading, { rootDir }));

  fs.rmSync(coverPath);
  assert.throws(
    () => validateReadingAssetInventory(data.reading, { rootDir }),
    /missing declared cover asset/
  );
});

test('collectInlineScriptHashes only hashes inline scripts', () => {
  const html = [
    '<script src="js/main.js" defer></script>',
    '<script>console.log("first")</script>',
    '<script type="application/ld+json">{"@context":"https://schema.org"}</script>'
  ].join('');

  const hashes = collectInlineScriptHashes(html);

  assert.equal(hashes.length, 2);
  assert.ok(hashes.every((hash) => hash.startsWith('sha256-')));
});

test('collectInlineScriptHashes handles tolerant script end tags', () => {
  const html = [
    '<script src="js/main.js" defer></script >',
    '<script>console.log("first")</script >',
    '<script>console.log("second")</script\t\n bar>'
  ].join('');

  assert.deepEqual(collectInlineScriptHashes(html), [
    hashInlineScript('console.log("first")'),
    hashInlineScript('console.log("second")')
  ]);
});

test('collectInlineScriptHashes does not treat data-src as external src', () => {
  const html = '<script data-src="metadata">console.log("inline")</script>';

  assert.deepEqual(collectInlineScriptHashes(html), [hashInlineScript('console.log("inline")')]);
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
