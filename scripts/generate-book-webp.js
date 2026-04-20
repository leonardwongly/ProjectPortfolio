#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = process.cwd();
const dataPath = path.join(projectRoot, 'data', 'reading.json');
const COVER_FILE_PATTERN = /\.(jpe?g)$/i;
const MAX_RELATIVE_PATH_LENGTH = 512;

function failPathValidation(fieldPath, reason) {
  throw new Error(`Invalid path at ${fieldPath}: ${reason}`);
}

function sanitizeCoverRelativePath(rawValue, fieldPath = 'cover') {
  if (typeof rawValue !== 'string') {
    failPathValidation(fieldPath, 'expected a string path');
  }

  const value = rawValue.trim();
  if (!value) {
    failPathValidation(fieldPath, 'path cannot be empty');
  }
  if (value.length > MAX_RELATIVE_PATH_LENGTH) {
    failPathValidation(fieldPath, `path exceeds max length ${MAX_RELATIVE_PATH_LENGTH}`);
  }
  if (value.includes('\0') || value.includes('\\')) {
    failPathValidation(fieldPath, 'path contains disallowed characters');
  }
  if (value.startsWith('/') || value.startsWith('//')) {
    failPathValidation(fieldPath, 'path must be relative');
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) {
    failPathValidation(fieldPath, 'URI schemes are not allowed');
  }
  if (value.includes('?') || value.includes('#')) {
    failPathValidation(fieldPath, 'query strings and fragments are not allowed');
  }

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch (error) {
    failPathValidation(fieldPath, 'path contains invalid URL encoding');
  }

  const decodedSegments = decoded.split('/');
  if (decodedSegments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    failPathValidation(fieldPath, 'dot segments and empty segments are not allowed');
  }

  const normalized = path.posix.normalize(value);
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.startsWith('/')
  ) {
    failPathValidation(fieldPath, 'path traversal is not allowed');
  }

  if (!COVER_FILE_PATTERN.test(normalized)) {
    failPathValidation(fieldPath, 'cover path must end in .jpg or .jpeg');
  }

  return normalized;
}

function resolveProjectPath(rootPath, relativePath, fieldPath = 'cover') {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const rootPrefix = `${resolvedRoot}${path.sep}`;

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootPrefix)) {
    failPathValidation(fieldPath, 'resolved path escapes project root');
  }

  return resolvedPath;
}

function derive2xPath(coverPath) {
  let derived = coverPath.replace('-300.jpg', '.jpg').replace('-300.jpeg', '.jpeg');
  if (derived === coverPath) {
    derived = coverPath;
  }
  return derived;
}

function toWebpPath(coverPath) {
  return coverPath.replace(/\.(jpe?g)$/i, '.webp');
}

function loadCoverPaths(readingEntries) {
  const coverPaths = new Set();

  readingEntries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || !entry.cover) {
      return;
    }

    try {
      const sanitized = sanitizeCoverRelativePath(String(entry.cover), `reading[${index}].cover`);
      coverPaths.add(sanitized);
    } catch (error) {
      console.warn(`[generate-book-webp] ${error.message}. Skipping entry.`);
    }
  });

  return coverPaths;
}

function buildSourceSet(coverPaths) {
  const sources = new Set();

  coverPaths.forEach((cover) => {
    sources.add(cover);
    const derived = derive2xPath(cover);
    if (!derived) {
      return;
    }

    try {
      sources.add(sanitizeCoverRelativePath(derived, `derived:${cover}`));
    } catch (error) {
      console.warn(`[generate-book-webp] ${error.message}. Skipping derived path.`);
    }
  });

  return sources;
}

function ensureCwebpAvailable() {
  try {
    execFileSync('cwebp', ['-version'], { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

function run() {
  if (!fs.existsSync(dataPath)) {
    console.error(`Missing reading data: ${dataPath}`);
    process.exit(1);
  }

  if (!ensureCwebpAvailable()) {
    console.error('cwebp is required. Install it with `brew install webp` and try again.');
    process.exit(1);
  }

  const reading = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  if (!Array.isArray(reading)) {
    throw new Error('reading.json must be an array');
  }

  const coverPaths = loadCoverPaths(reading);
  const sources = buildSourceSet(coverPaths);

  const missing = new Set();
  const converted = [];
  const skipped = [];

  sources.forEach((relativePath) => {
    if (!relativePath) {
      return;
    }

    if (!COVER_FILE_PATTERN.test(relativePath)) {
      console.warn(`Skipping non-JPEG cover: ${relativePath}`);
      return;
    }

    let sourcePath;
    let targetPath;
    let targetRelative;
    try {
      sourcePath = resolveProjectPath(projectRoot, relativePath, `source:${relativePath}`);
      targetRelative = toWebpPath(relativePath);
      targetPath = resolveProjectPath(projectRoot, targetRelative, `target:${targetRelative}`);
    } catch (error) {
      console.warn(`[generate-book-webp] ${error.message}. Skipping path.`);
      return;
    }

    if (!fs.existsSync(sourcePath)) {
      missing.add(relativePath);
      return;
    }

    if (fs.existsSync(targetPath)) {
      skipped.push(targetRelative);
      return;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    execFileSync('cwebp', ['-q', '80', '-mt', sourcePath, '-o', targetPath], { stdio: 'inherit' });
    converted.push(targetRelative);
  });

  if (missing.size > 0) {
    console.warn(`Missing cover sources (${missing.size}):\n- ${Array.from(missing).join('\n- ')}`);
  }

  console.log(`WebP generation complete. Created ${converted.length}, skipped ${skipped.length}, missing ${missing.size}.`);
}

if (require.main === module) {
  run();
}

module.exports = {
  run,
  sanitizeCoverRelativePath,
  resolveProjectPath,
  derive2xPath,
  toWebpPath
};
