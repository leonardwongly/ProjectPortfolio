import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import assetPaths from './lib/asset-paths.cjs';
import safeInput from './lib/safe-input.cjs';

const { resolveContainedPath, sanitizeRelativeAssetPath } = assetPaths;
const { readStableFileNoFollow } = safeInput;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const MAX_READING_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_COVER_FILE_BYTES = 20 * 1024 * 1024;
const COVER_EXTENSION_PATTERN = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const ALLOWED_DUPLICATE_COVER_GROUPS = new Set([
  [
    'book/2019/2019-22-300.jpg',
    'book/2020/2020-15-300.jpg'
  ].sort().join('|')
]);

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function fail(message) {
  throw new Error(message);
}

function readStableBoundedFile(rootDir, relativePath, maxBytes, fieldPath, { openSync = fs.openSync } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const absolutePath = resolveContainedPath(resolvedRoot, relativePath, fieldPath);
  return readStableFileNoFollow(absolutePath, {
    label: `Unsafe ${fieldPath}`,
    rootDir: resolvedRoot,
    maxBytes,
    minBytes: 0,
    openSync
  });
}

function readReadingData({ rootDir = projectRoot, openSync = fs.openSync } = {}) {
  return JSON.parse(
    readStableBoundedFile(
      rootDir,
      'data/reading.json',
      MAX_READING_METADATA_BYTES,
      'data/reading.json',
      { openSync }
    )
      .toString('utf8')
  );
}

function resolveSafeCoverPath(rootDir, rawCover, fieldPath) {
  const relativePath = sanitizeRelativeAssetPath(rawCover, fieldPath, {
    allowedExtensions: COVER_EXTENSION_PATTERN
  });
  if (!relativePath.startsWith('book/')) {
    throw new Error(`Invalid path at ${fieldPath}: cover must be inside book/`);
  }
  return {
    absolutePath: resolveContainedPath(rootDir, relativePath, fieldPath),
    relativePath
  };
}

function assertCoverHasSingleLink(stats, fieldPath) {
  if (stats.nlink !== 1n) {
    throw new Error(`Unsafe ${fieldPath}: cover must have exactly one hard link`);
  }
}

function sha256SafeCoverFile(rootDir, relativePath, fieldPath, {
  afterReadChunk,
  openSync = fs.openSync
} = {}) {
  if (typeof openSync !== 'function') {
    throw new TypeError('openSync must be a function');
  }
  const resolvedRoot = path.resolve(rootDir);
  const rootStats = fs.lstatSync(resolvedRoot, { bigint: true });
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`Unsafe ${fieldPath}: root must be a non-symlink directory`);
  }

  let current = resolvedRoot;
  let leafStats;
  const segments = relativePath.split('/');
  segments.forEach((segment, index) => {
    current = path.join(current, segment);
    const stats = fs.lstatSync(current, { bigint: true });
    if (stats.isSymbolicLink()) {
      throw new Error(`Unsafe ${fieldPath}: symlinks are not allowed`);
    }
    if (index < segments.length - 1 && !stats.isDirectory()) {
      throw new Error(`Unsafe ${fieldPath}: parent must be a directory`);
    }
    if (index === segments.length - 1) {
      leafStats = stats;
    }
  });

  if (!leafStats?.isFile()) {
    throw new Error(`Unsafe ${fieldPath}: cover must be a regular file`);
  }
  assertCoverHasSingleLink(leafStats, fieldPath);
  if (leafStats.size > BigInt(MAX_COVER_FILE_BYTES)) {
    throw new Error(`Unsafe ${fieldPath}: cover exceeds ${MAX_COVER_FILE_BYTES} byte limit`);
  }

  const realRoot = fs.realpathSync(resolvedRoot);
  const realFile = fs.realpathSync(current);
  const relativeRealPath = path.relative(realRoot, realFile);
  resolveContainedPath(realRoot, relativeRealPath, fieldPath);

  const flags = fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW || 0) |
    (fs.constants.O_NONBLOCK || 0) |
    (fs.constants.O_CLOEXEC || 0);
  const descriptor = openSync(current, flags);
  try {
    const openStats = fs.fstatSync(descriptor, { bigint: true });
    if (!openStats.isFile() || openStats.dev !== leafStats.dev || openStats.ino !== leafStats.ino) {
      throw new Error(`Unsafe ${fieldPath}: cover changed during validation`);
    }
    assertCoverHasSingleLink(openStats, fieldPath);

    const hash = crypto.createHash('sha256');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let totalBytes = 0;
    while (true) {
      const bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > MAX_COVER_FILE_BYTES) {
        throw new Error(`Unsafe ${fieldPath}: cover exceeds ${MAX_COVER_FILE_BYTES} byte limit`);
      }
      hash.update(chunk.subarray(0, bytesRead));
      afterReadChunk?.({ absolutePath: current, bytesRead, descriptor, totalBytes });
    }
    const afterStats = fs.fstatSync(descriptor, { bigint: true });
    const currentStats = fs.lstatSync(current, { bigint: true });
    const currentRealFile = fs.realpathSync(current);
    assertCoverHasSingleLink(afterStats, fieldPath);
    assertCoverHasSingleLink(currentStats, fieldPath);
    if (
      afterStats.dev !== openStats.dev || afterStats.ino !== openStats.ino ||
      afterStats.size !== openStats.size || afterStats.mtimeNs !== openStats.mtimeNs ||
      afterStats.ctimeNs !== openStats.ctimeNs || currentStats.isSymbolicLink() ||
      currentStats.dev !== openStats.dev || currentStats.ino !== openStats.ino ||
      currentRealFile !== realFile
    ) {
      throw new Error(`Unsafe ${fieldPath}: cover changed while it was being hashed`);
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
}

function auditReadingMetadata(reading, { rootDir = projectRoot } = {}) {
  if (!Array.isArray(reading)) {
    fail('Expected data/reading.json to contain an array');
  }

  const findings = [];
  const seen = new Map();
  const coverHashes = new Map();

  reading.forEach((entry, index) => {
    const context = `reading[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      findings.push(`${context}: expected an object`);
      return;
    }

    const title = normalize(entry.title);
    const isbn = normalize(entry.isbn);
    const year = normalize(entry.year);
    const author = normalize(entry.author);

    if (!title) findings.push(`${context}: missing title`);
    if (!author) findings.push(`${context}: missing author for "${entry.title}"`);
    if (!isbn) findings.push(`${context}: missing ISBN for "${entry.title}"`);
    if (!/^\d{4}$/.test(year)) findings.push(`${context}: invalid year "${entry.year}"`);

    [
      [`isbn:${isbn}`, isbn],
      [`title-year:${title}|${year}`, title && year]
    ].forEach(([key, enabled]) => {
      if (!enabled) return;
      if (seen.has(key)) {
        findings.push(`${context}: duplicate ${key} also appears at reading[${seen.get(key)}]`);
        return;
      }
      seen.set(key, index);
    });

    if (entry.cover !== undefined && entry.cover !== null && entry.cover !== '') {
      const fieldPath = `${context}.cover`;
      try {
        const cover = resolveSafeCoverPath(rootDir, entry.cover, fieldPath);
        const digest = sha256SafeCoverFile(rootDir, cover.relativePath, fieldPath);
        const duplicates = coverHashes.get(digest) || [];
        duplicates.forEach((duplicate) => {
          const duplicateGroup = [duplicate.cover, cover.relativePath].sort().join('|');
          if (!ALLOWED_DUPLICATE_COVER_GROUPS.has(duplicateGroup)) {
            findings.push(`${context}: cover duplicates reading[${duplicate.index}] by content hash: ${cover.relativePath}`);
          }
        });
        duplicates.push({ cover: cover.relativePath, index });
        coverHashes.set(digest, duplicates);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          findings.push(`${context}: declared cover is missing: ${String(entry.cover)}`);
        } else {
          findings.push(`${context}: ${error?.message || 'cover validation failed'}`);
        }
      }
    }
  });

  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const findings = auditReadingMetadata(readReadingData());
    if (findings.length > 0) {
      console.error(`Reading metadata audit failed with ${findings.length} finding(s):`);
      findings.forEach((finding) => console.error(`- ${finding}`));
      process.exitCode = 1;
    } else {
      console.log('Reading metadata audit OK.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export {
  ALLOWED_DUPLICATE_COVER_GROUPS,
  MAX_COVER_FILE_BYTES,
  MAX_READING_METADATA_BYTES,
  auditReadingMetadata,
  readReadingData,
  resolveSafeCoverPath,
  sha256SafeCoverFile
};
