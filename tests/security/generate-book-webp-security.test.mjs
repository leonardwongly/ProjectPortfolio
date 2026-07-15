import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  sanitizeCoverRelativePath,
  resolveProjectPath,
  writeGeneratedFileNoFollow,
  toWebpPath
} = require('../../scripts/generate-book-webp.js');
const { AssetPathValidationError } = require('../../scripts/lib/asset-paths.cjs');

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

test('writeGeneratedFileNoFollow rejects dangling output symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const outputDirectory = path.join(root, 'book');
  const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-external-'));
  const source = path.join(root, 'generated.webp');
  const target = path.join(outputDirectory, 'cover.webp');
  const escaped = path.join(externalDirectory, 'escaped.webp');
  fs.mkdirSync(outputDirectory);
  fs.writeFileSync(source, 'valid-generated-bytes');
  fs.symlinkSync(escaped, target);

  try {
    assert.throws(
      () => writeGeneratedFileNoFollow(source, target, root),
      (error) => error?.code === 'EEXIST' || error?.code === 'ELOOP'
    );
    assert.equal(fs.existsSync(escaped), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(externalDirectory, { recursive: true, force: true });
  }
});

test('writeGeneratedFileNoFollow creates a regular file inside the project root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const outputDirectory = path.join(root, 'book');
  const source = path.join(root, 'generated.webp');
  const target = path.join(outputDirectory, 'cover.webp');
  fs.mkdirSync(outputDirectory);
  fs.writeFileSync(source, 'valid-generated-bytes');

  try {
    writeGeneratedFileNoFollow(source, target, root);
    assert.equal(fs.readFileSync(target, 'utf8'), 'valid-generated-bytes');
    assert.equal(fs.lstatSync(target).isFile(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('writeGeneratedFileNoFollow allows targets located directly in the project root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const source = path.join(root, 'generated.webp');
  const target = path.join(root, 'cover.webp');
  fs.writeFileSync(source, 'root-level-bytes');

  try {
    writeGeneratedFileNoFollow(source, target, root);
    assert.equal(fs.readFileSync(target, 'utf8'), 'root-level-bytes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeGeneratedFileNoFollow refuses to overwrite an existing regular file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const outputDirectory = path.join(root, 'book');
  const source = path.join(root, 'generated.webp');
  const target = path.join(outputDirectory, 'cover.webp');
  fs.mkdirSync(outputDirectory);
  fs.writeFileSync(source, 'new-bytes');
  fs.writeFileSync(target, 'existing-bytes');

  try {
    assert.throws(
      () => writeGeneratedFileNoFollow(source, target, root),
      (error) => error?.code === 'EEXIST'
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'existing-bytes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeGeneratedFileNoFollow rejects target directories that resolve outside the project root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-external-'));
  const source = path.join(root, 'generated.webp');
  const linkedDirectory = path.join(root, 'book');
  const target = path.join(linkedDirectory, 'cover.webp');
  fs.writeFileSync(source, 'valid-generated-bytes');
  fs.symlinkSync(externalDirectory, linkedDirectory);

  try {
    assert.throws(
      () => writeGeneratedFileNoFollow(source, target, root),
      (error) => error instanceof AssetPathValidationError &&
        /target parent resolves outside project root/.test(error.message)
    );
    assert.equal(fs.existsSync(path.join(externalDirectory, 'cover.webp')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(externalDirectory, { recursive: true, force: true });
  }
});

test('writeGeneratedFileNoFollow preserves binary content exactly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const outputDirectory = path.join(root, 'book');
  const source = path.join(root, 'generated.webp');
  const target = path.join(outputDirectory, 'cover.webp');
  fs.mkdirSync(outputDirectory);
  const binaryBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x80, 0x01]);
  fs.writeFileSync(source, binaryBytes);

  try {
    writeGeneratedFileNoFollow(source, target, root);
    assert.deepEqual(fs.readFileSync(target), binaryBytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
