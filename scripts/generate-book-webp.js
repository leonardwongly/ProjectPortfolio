#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  AssetPathValidationError,
  resolveContainedPath,
  sanitizeRelativeAssetPath
} = require('./lib/asset-paths.cjs');

const projectRoot = process.cwd();
const dataPath = path.join(projectRoot, 'data', 'reading.json');
const COVER_FILE_PATTERN = /\.(jpe?g)$/i;

function sanitizeCoverRelativePath(rawValue, fieldPath = 'cover') {
  try {
    return sanitizeRelativeAssetPath(rawValue, fieldPath, {
      allowedExtensions: COVER_FILE_PATTERN
    });
  } catch (error) {
    if (error instanceof AssetPathValidationError && error.reason.startsWith('path must match')) {
      throw new AssetPathValidationError(fieldPath, 'cover path must end in .jpg or .jpeg');
    }
    throw error;
  }
}

function resolveProjectPath(rootPath, relativePath, fieldPath = 'cover') {
  return resolveContainedPath(rootPath, relativePath, fieldPath);
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
