#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync: systemExecFileSync } = require('child_process');
const {
  AssetPathValidationError,
  resolveContainedPath,
  sanitizeRelativeAssetPath
} = require('./lib/asset-paths.cjs');

const projectRoot = process.cwd();
const COVER_FILE_PATTERN = /\.(jpe?g)$/i;
const DEFAULT_MAX_READING_DATA_BYTES = 1024 * 1024;
const DEFAULT_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_GENERATED_BYTES = 20 * 1024 * 1024;
const DEFAULT_CWEBP_TIMEOUT_MS = 30_000;
const READ_CHUNK_BYTES = 64 * 1024;

function isContained(rootPath, candidatePath) {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

function validatePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

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

function loadCoverPaths(readingEntries, logger = console) {
  const coverPaths = new Set();

  readingEntries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || !entry.cover) {
      return;
    }

    try {
      const sanitized = sanitizeCoverRelativePath(String(entry.cover), `reading[${index}].cover`);
      coverPaths.add(sanitized);
    } catch (error) {
      logger.warn(`[generate-book-webp] ${error.message}. Skipping entry.`);
    }
  });

  return coverPaths;
}

function buildSourceSet(coverPaths, logger = console) {
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
      logger.warn(`[generate-book-webp] ${error.message}. Skipping derived path.`);
    }
  });

  return sources;
}

function ensureCwebpAvailable(execFileSync = systemExecFileSync, timeoutMs = DEFAULT_CWEBP_TIMEOUT_MS) {
  try {
    execFileSync('cwebp', ['-version'], {
      stdio: 'ignore',
      timeout: timeoutMs,
      killSignal: 'SIGKILL'
    });
    return true;
  } catch (error) {
    return false;
  }
}

function pathEntryExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function readRegularSingleLinkFileWithinBudget(
  filePath,
  maxBytes,
  fieldLabel,
  { openSync = fs.openSync } = {}
) {
  validatePositiveInteger(maxBytes, `${fieldLabel} byte budget`);
  if (typeof openSync !== 'function') {
    throw new TypeError(`${fieldLabel} openSync must be a function`);
  }

  const flags = fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW || 0) |
    (fs.constants.O_NONBLOCK || 0);
  let descriptor;
  try {
    descriptor = openSync(filePath, flags);
  } catch (error) {
    throw new AssetPathValidationError(
      filePath,
      `${fieldLabel} must be a readable regular, non-symlink file (${error.code || error.message})`
    );
  }

  try {
    const initialStats = fs.fstatSync(descriptor);
    if (!initialStats.isFile()) {
      throw new AssetPathValidationError(filePath, `${fieldLabel} must be a regular file`);
    }
    if (initialStats.nlink !== 1) {
      throw new AssetPathValidationError(filePath, `${fieldLabel} must have exactly one hard link`);
    }
    if (initialStats.size === 0) {
      throw new AssetPathValidationError(filePath, `${fieldLabel} must not be empty`);
    }
    if (initialStats.size > maxBytes) {
      throw new AssetPathValidationError(
        filePath,
        `${fieldLabel} exceeds byte budget ${maxBytes} (found ${initialStats.size})`
      );
    }

    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const readCapacity = Math.min(READ_CHUNK_BYTES, maxBytes - totalBytes + 1);
      const chunk = Buffer.allocUnsafe(readCapacity);
      const bytesRead = fs.readSync(descriptor, chunk, 0, readCapacity, null);
      if (bytesRead === 0) {
        break;
      }

      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new AssetPathValidationError(
          filePath,
          `${fieldLabel} exceeds byte budget ${maxBytes} while being read`
        );
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }

    const finalStats = fs.fstatSync(descriptor);
    if (!finalStats.isFile() || finalStats.nlink !== 1) {
      throw new AssetPathValidationError(filePath, `${fieldLabel} changed type or link count while being read`);
    }

    return Buffer.concat(chunks, totalBytes);
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateTargetParent(targetPath, rootPath) {
  const lexicalRoot = path.resolve(rootPath);
  const lexicalTarget = path.resolve(targetPath);
  if (!isContained(lexicalRoot, lexicalTarget)) {
    throw new AssetPathValidationError(targetPath, 'target path escapes project root');
  }

  const realRoot = fs.realpathSync(rootPath);
  const realParent = fs.realpathSync(path.dirname(targetPath));
  if (!isContained(realRoot, realParent)) {
    throw new AssetPathValidationError(targetPath, 'target parent resolves outside project root');
  }
}

function unlinkIfSameFile(targetPath, expectedStats) {
  let currentStats;
  try {
    currentStats = fs.lstatSync(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  if (
    currentStats.isSymbolicLink() ||
    currentStats.dev !== expectedStats.dev ||
    currentStats.ino !== expectedStats.ino
  ) {
    return false;
  }

  fs.unlinkSync(targetPath);
  return true;
}

function writeGeneratedFileNoFollow(
  sourcePath,
  targetPath,
  rootPath = projectRoot,
  {
    maxBytes = DEFAULT_MAX_GENERATED_BYTES,
    beforeFinalTargetValidation,
    writeFileSync = fs.writeFileSync
  } = {}
) {
  if (
    beforeFinalTargetValidation !== undefined &&
    typeof beforeFinalTargetValidation !== 'function'
  ) {
    throw new TypeError('beforeFinalTargetValidation must be a function');
  }
  if (typeof writeFileSync !== 'function') {
    throw new TypeError('writeFileSync must be a function');
  }

  validateTargetParent(targetPath, rootPath);
  const generatedBytes = readRegularSingleLinkFileWithinBudget(
    sourcePath,
    maxBytes,
    'generated output'
  );
  validateTargetParent(targetPath, rootPath);
  if (beforeFinalTargetValidation) {
    beforeFinalTargetValidation();
  }
  // This revalidation catches deterministic parent changes before open. Node does not expose
  // openat(2), so a residual OS path-resolution-to-open race remains after this check.
  validateTargetParent(targetPath, rootPath);

  const flags = fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(targetPath, flags, 0o644);
  let targetStats;
  try {
    targetStats = fs.fstatSync(descriptor);
    if (!targetStats.isFile() || targetStats.nlink !== 1) {
      throw new AssetPathValidationError(targetPath, 'target must be a single-link regular file');
    }
    writeFileSync(descriptor, generatedBytes);
  } catch (error) {
    if (targetStats) {
      try {
        unlinkIfSameFile(targetPath, targetStats);
      } catch (cleanupError) {
        error.cleanupError = cleanupError;
      }
    }
    throw error;
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSafeSourceFile(
  sourcePath,
  rootPath = projectRoot,
  { maxBytes = DEFAULT_MAX_SOURCE_BYTES } = {}
) {
  validatePositiveInteger(maxBytes, 'source byte budget');
  const sourceStats = fs.lstatSync(sourcePath);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
    throw new AssetPathValidationError(sourcePath, 'source must be a regular, non-symlink file');
  }
  if (sourceStats.nlink !== 1) {
    throw new AssetPathValidationError(sourcePath, 'source must have exactly one hard link');
  }
  if (sourceStats.size === 0) {
    throw new AssetPathValidationError(sourcePath, 'source must not be empty');
  }
  if (sourceStats.size > maxBytes) {
    throw new AssetPathValidationError(
      sourcePath,
      `source exceeds byte budget ${maxBytes} (found ${sourceStats.size})`
    );
  }

  const realRoot = fs.realpathSync(rootPath);
  const realSource = fs.realpathSync(sourcePath);
  if (!isContained(realRoot, realSource)) {
    throw new AssetPathValidationError(sourcePath, 'source resolves outside project root');
  }

  return realSource;
}

function writeSourceSnapshot(sourcePath, temporaryPath, rootPath, maxBytes) {
  const realSource = assertSafeSourceFile(sourcePath, rootPath, { maxBytes });
  const sourceBytes = readRegularSingleLinkFileWithinBudget(realSource, maxBytes, 'source');
  assertSafeSourceFile(realSource, rootPath, { maxBytes });
  fs.writeFileSync(temporaryPath, sourceBytes, { flag: 'wx', mode: 0o600 });
}

function run({
  projectRoot: configuredProjectRoot = projectRoot,
  dataPath: configuredDataPath,
  temporaryRoot = os.tmpdir(),
  execFileSync = systemExecFileSync,
  openReadingDataSync = fs.openSync,
  writeGeneratedFileSync = fs.writeFileSync,
  maxReadingDataBytes = DEFAULT_MAX_READING_DATA_BYTES,
  maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES,
  maxGeneratedBytes = DEFAULT_MAX_GENERATED_BYTES,
  cwebpTimeoutMs = DEFAULT_CWEBP_TIMEOUT_MS,
  logger = console
} = {}) {
  validatePositiveInteger(maxReadingDataBytes, 'reading data byte budget');
  validatePositiveInteger(maxSourceBytes, 'source byte budget');
  validatePositiveInteger(maxGeneratedBytes, 'generated output byte budget');
  validatePositiveInteger(cwebpTimeoutMs, 'cwebp timeout');
  if (typeof openReadingDataSync !== 'function') {
    throw new TypeError('openReadingDataSync must be a function');
  }
  if (typeof writeGeneratedFileSync !== 'function') {
    throw new TypeError('writeGeneratedFileSync must be a function');
  }

  const rootPath = path.resolve(configuredProjectRoot);
  const dataPath = configuredDataPath || path.join(rootPath, 'data', 'reading.json');
  if (!pathEntryExists(dataPath)) {
    throw new Error(`Missing reading data: ${dataPath}`);
  }

  if (!ensureCwebpAvailable(execFileSync, cwebpTimeoutMs)) {
    throw new Error('cwebp is required. Install it with `brew install webp` and try again.');
  }

  const readingBytes = readRegularSingleLinkFileWithinBudget(
    dataPath,
    maxReadingDataBytes,
    'reading data',
    { openSync: openReadingDataSync }
  );
  const reading = JSON.parse(readingBytes.toString('utf8'));
  if (!Array.isArray(reading)) {
    throw new Error('reading.json must be an array');
  }

  const coverPaths = loadCoverPaths(reading, logger);
  const sources = buildSourceSet(coverPaths, logger);

  const missing = new Set();
  const converted = [];
  const skipped = [];

  sources.forEach((relativePath) => {
    if (!relativePath) {
      return;
    }

    if (!COVER_FILE_PATTERN.test(relativePath)) {
      logger.warn(`Skipping non-JPEG cover: ${relativePath}`);
      return;
    }

    let sourcePath;
    let targetPath;
    let targetRelative;
    try {
      sourcePath = resolveProjectPath(rootPath, relativePath, `source:${relativePath}`);
      targetRelative = toWebpPath(relativePath);
      targetPath = resolveProjectPath(rootPath, targetRelative, `target:${targetRelative}`);
    } catch (error) {
      logger.warn(`[generate-book-webp] ${error.message}. Skipping path.`);
      return;
    }

    if (!pathEntryExists(sourcePath)) {
      missing.add(relativePath);
      return;
    }

    try {
      sourcePath = assertSafeSourceFile(sourcePath, rootPath, { maxBytes: maxSourceBytes });
    } catch (error) {
      logger.warn(`[generate-book-webp] ${error.message}. Skipping path.`);
      return;
    }

    if (pathEntryExists(targetPath)) {
      skipped.push(targetRelative);
      return;
    }

    validateTargetParent(targetPath, rootPath);
    const realTemporaryRoot = fs.realpathSync(temporaryRoot);
    const temporaryDirectory = fs.mkdtempSync(path.join(realTemporaryRoot, 'projectportfolio-webp-'));
    const temporarySourcePath = path.join(
      temporaryDirectory,
      `source${path.extname(sourcePath).toLowerCase()}`
    );
    const temporaryPath = path.join(temporaryDirectory, 'output.webp');
    try {
      writeSourceSnapshot(sourcePath, temporarySourcePath, rootPath, maxSourceBytes);
      execFileSync(
        'cwebp',
        ['-q', '80', '-mt', temporarySourcePath, '-o', temporaryPath],
        {
          stdio: 'inherit',
          timeout: cwebpTimeoutMs,
          killSignal: 'SIGKILL'
        }
      );
      writeGeneratedFileNoFollow(temporaryPath, targetPath, rootPath, {
        maxBytes: maxGeneratedBytes,
        writeFileSync: writeGeneratedFileSync
      });
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
    converted.push(targetRelative);
  });

  if (missing.size > 0) {
    logger.warn(`Missing cover sources (${missing.size}):\n- ${Array.from(missing).join('\n- ')}`);
  }

  logger.log(`WebP generation complete. Created ${converted.length}, skipped ${skipped.length}, missing ${missing.size}.`);
  return {
    converted,
    skipped,
    missing: Array.from(missing)
  };
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_MAX_GENERATED_BYTES,
  DEFAULT_MAX_READING_DATA_BYTES,
  DEFAULT_MAX_SOURCE_BYTES,
  run,
  sanitizeCoverRelativePath,
  resolveProjectPath,
  writeGeneratedFileNoFollow,
  assertSafeSourceFile,
  derive2xPath,
  toWebpPath
};
