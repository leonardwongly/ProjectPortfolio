import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  sanitizeCoverRelativePath,
  resolveProjectPath,
  toWebpPath
} = require('../../scripts/generate-book-webp.js');

test('sanitizeCoverRelativePath accepts safe relative JPEG paths', () => {
  assert.equal(
    sanitizeCoverRelativePath('book/2025/secure-design-300.jpg', 'reading[0].cover'),
    'book/2025/secure-design-300.jpg'
  );
  assert.equal(
    sanitizeCoverRelativePath('book/2025/secure-design.jpeg', 'reading[1].cover'),
    'book/2025/secure-design.jpeg'
  );
});

test('sanitizeCoverRelativePath rejects traversal and encoded traversal', () => {
  assert.throws(
    () => sanitizeCoverRelativePath('../etc/passwd.jpg', 'reading[0].cover'),
    /path traversal|dot segments/i
  );
  assert.throws(
    () => sanitizeCoverRelativePath('book/%2e%2e/secret.jpg', 'reading[1].cover'),
    /dot segments|path traversal/i
  );
});

test('sanitizeCoverRelativePath rejects absolute and scheme paths', () => {
  assert.throws(
    () => sanitizeCoverRelativePath('/tmp/cover.jpg', 'reading[0].cover'),
    /must be relative/i
  );
  assert.throws(
    () => sanitizeCoverRelativePath('file:///tmp/cover.jpg', 'reading[1].cover'),
    /URI schemes are not allowed/i
  );
  assert.throws(
    () => sanitizeCoverRelativePath('https://example.com/cover.jpg', 'reading[2].cover'),
    /URI schemes are not allowed/i
  );
});

test('sanitizeCoverRelativePath rejects non-jpeg and query paths', () => {
  assert.throws(
    () => sanitizeCoverRelativePath('book/2025/cover.png', 'reading[0].cover'),
    /must end in \.jpg or \.jpeg/i
  );
  assert.throws(
    () => sanitizeCoverRelativePath('book/2025/cover.jpg?download=1', 'reading[1].cover'),
    /query strings and fragments are not allowed/i
  );
});

test('resolveProjectPath enforces root containment', () => {
  const rootPath = path.resolve('/tmp/project-portfolio-test');
  const safe = resolveProjectPath(rootPath, 'book/2025/cover.jpg', 'source');

  assert.equal(safe, path.join(rootPath, 'book/2025/cover.jpg'));
  assert.throws(
    () => resolveProjectPath(rootPath, '../../etc/passwd', 'source'),
    /escapes project root/i
  );
});

test('toWebpPath preserves location and swaps extension', () => {
  assert.equal(toWebpPath('book/2025/cover-300.jpg'), 'book/2025/cover-300.webp');
  assert.equal(toWebpPath('book/2025/cover.jpeg'), 'book/2025/cover.webp');
});
