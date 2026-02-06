import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  sanitizeHref,
  sanitizeAssetPath,
  validateDataCollections
} = require('../../scripts/build.js');

function makeValidData() {
  return {
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
});
