import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  collectVendoredFiles,
  loadManifest,
  MAX_VENDOR_FILE_BYTES,
  MAX_VENDOR_MANIFEST_BYTES,
  validateVendorGovernance
} from './check-vendor-governance.mjs';
import {
  ALLOWED_VENDOR_UPSTREAM_HOSTS,
  ensureVendorHttpsUrl,
  ensureVendorSourceMatchesVersion,
  ensureVendorUpstreamMatchesSource
} from './lib/vendor-policy.mjs';
import {
  fetchInjectedHttpsBytes,
  requestPinnedHttpsBytes
} from './lib/network-safety.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 60000;
const VENDOR_REFRESH_LOCK_NAME = '.vendor-refresh.lock';
const require = createRequire(import.meta.url);
const { assertSafeOutputPath, writeFileNoFollow } = require('./lib/safe-output.cjs');
const { StableFileReadError, readStableFileNoFollow } = require('./lib/safe-input.cjs');

function fail(message) {
  throw new Error(message);
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function ensureObject(value, fieldPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`Invalid manifest at ${fieldPath}: expected object`);
  }
  return value;
}

function ensureString(value, fieldPath) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`Invalid manifest at ${fieldPath}: expected non-empty string`);
  }
  return value.trim();
}


function ensureVendorPath(rawPath, fieldPath) {
  const relativePath = ensureString(rawPath, fieldPath);
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    fail(`Invalid manifest at ${fieldPath}: expected relative path`);
  }
  if (relativePath.includes('\\')) {
    fail(`Invalid manifest at ${fieldPath}: path must not contain backslashes`);
  }

  const normalized = path.posix.normalize(relativePath);
  if (normalized !== relativePath) {
    fail(`Invalid manifest at ${fieldPath}: path must already be normalized`);
  }
  if (normalized === 'js/vendor' || !normalized.startsWith('js/vendor/')) {
    fail(`Invalid manifest at ${fieldPath}: path must stay under js/vendor/`);
  }
  if (normalized.includes('../') || normalized === '..') {
    fail(`Invalid manifest at ${fieldPath}: path traversal is not allowed`);
  }

  return normalized;
}

function ensureHttpsUrl(rawUrl, fieldPath) {
  const urlString = ensureString(rawUrl, fieldPath);
  try {
    return ensureVendorHttpsUrl(urlString, fieldPath);
  } catch (error) {
    fail(error?.message?.startsWith('Invalid ')
      ? error.message.replace(/^Invalid /, 'Invalid manifest at ')
      : `Invalid manifest at ${fieldPath}: malformed URL`);
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    write: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    today: new Date().toISOString().slice(0, 10)
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--write') {
      options.write = true;
      continue;
    }

    if (arg === '--timeout-ms') {
      const nextValue = argv[index + 1];
      if (!nextValue || !/^\d+$/.test(nextValue)) {
        fail('Expected integer value after --timeout-ms');
      }
      options.timeoutMs = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }

    if (arg === '--today') {
      const nextValue = argv[index + 1];
      if (!nextValue || !/^\d{4}-\d{2}-\d{2}$/.test(nextValue)) {
        fail('Expected YYYY-MM-DD value after --today');
      }
      options.today = nextValue;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    fail('Timeout must be a positive integer');
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs > MAX_TIMEOUT_MS) {
    fail(`Timeout must not exceed ${MAX_TIMEOUT_MS}ms`);
  }

  return options;
}

function listManifestFiles(manifest) {
  const manifestObject = ensureObject(manifest, 'manifest');
  if (!Array.isArray(manifestObject.dependencies) || manifestObject.dependencies.length === 0) {
    fail('Invalid manifest at manifest.dependencies: expected non-empty array');
  }

  return manifestObject.dependencies.flatMap((dependency, dependencyIndex) => {
    const dependencyObject = ensureObject(dependency, `manifest.dependencies[${dependencyIndex}]`);
    const sourceFieldPath = `manifest.dependencies[${dependencyIndex}].source`;
    const sourceUrl = ensureVendorSourceMatchesVersion(
      ensureHttpsUrl(dependencyObject.source, sourceFieldPath),
      dependencyObject.version,
      sourceFieldPath
    );
    const files = dependencyObject.files;
    if (!Array.isArray(files) || files.length === 0) {
      fail(`Invalid manifest at manifest.dependencies[${dependencyIndex}].files: expected non-empty array`);
    }

    return files.map((fileEntry, fileIndex) => {
      const fieldPath = `manifest.dependencies[${dependencyIndex}].files[${fileIndex}]`;
      const fileObject = ensureObject(fileEntry, fieldPath);
      const upstreamUrl = ensureVendorUpstreamMatchesSource(
        ensureHttpsUrl(fileObject.upstream_url, `${fieldPath}.upstream_url`),
        sourceUrl,
        `${fieldPath}.upstream_url`
      );
      const relativePath = ensureVendorPath(fileObject.path, `${fieldPath}.path`);
      if (!Array.isArray(fileObject.signatures) || fileObject.signatures.length === 0) {
        fail(`Invalid manifest at ${fieldPath}.signatures: expected non-empty array`);
      }
      const signatures = fileObject.signatures.map((signature, signatureIndex) =>
        ensureString(signature, `${fieldPath}.signatures[${signatureIndex}]`)
      );
      if (new Set(signatures).size !== signatures.length) {
        fail(`Invalid manifest at ${fieldPath}.signatures: duplicate signatures are not allowed`);
      }

      return {
        dependencyIndex,
        fileIndex,
        path: relativePath,
        upstreamUrl,
        signatures
      };
    });
  });
}

async function fetchVendorFiles(manifest, options = {}) {
  const files = listManifestFiles(manifest);
  const results = [];

  for (const fileEntry of files) {
    const fieldPath = `manifest.dependencies[${fileEntry.dependencyIndex}].files[${fileEntry.fileIndex}].upstream_url`;
    const transportOptions = {
      fieldPath,
      allowedHosts: ALLOWED_VENDOR_UPSTREAM_HOSTS,
      lookupImpl: options.lookupImpl,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBytes: options.maxBytes ?? MAX_VENDOR_FILE_BYTES,
      headers: {
        accept: 'application/javascript, text/javascript, text/plain;q=0.9, */*;q=0.1',
        'user-agent': 'ProjectPortfolio-vendor-refresh/1.0'
      }
    };
    const response = options.fetchImpl
      ? await fetchInjectedHttpsBytes(fileEntry.upstreamUrl, {
          ...transportOptions,
          fetchImpl: options.fetchImpl
        })
      : await (options.requestBytesImpl ?? requestPinnedHttpsBytes)(fileEntry.upstreamUrl, {
          ...transportOptions,
          requestImpl: options.requestImpl
        });
    const responseOk = response.ok ?? (response.status >= 200 && response.status < 300);
    if (!responseOk) {
      fail(`Failed to fetch ${fileEntry.upstreamUrl}: ${response.status} ${response.statusText}`);
    }

    const buffer = response.bytes;
    const content = buffer.toString('utf8');
    fileEntry.signatures.forEach((signature) => {
      if (!content.includes(signature)) {
        fail(`Fetched upstream file ${fileEntry.upstreamUrl} is missing signature "${signature}"`);
      }
    });

    results.push({
      ...fileEntry,
      bytes: buffer,
      sha256: sha256Bytes(buffer)
    });
  }

  return results;
}

function readOptionalRefreshFile(filePath, {
  rootDir,
  label,
  maxBytes,
  afterRead
}) {
  try {
    return readStableFileNoFollow(filePath, {
      label,
      rootDir,
      maxBytes,
      minBytes: 0,
      afterRead
    });
  } catch (error) {
    if (error instanceof StableFileReadError && error.reason === 'missing') return null;
    throw error;
  }
}

function summarizeFetchedFiles(fetchedFiles, rootDir = projectRoot, options = {}) {
  return fetchedFiles.map((fileEntry) => {
    const absolutePath = path.join(rootDir, fileEntry.path);
    const currentBytes = readOptionalRefreshFile(absolutePath, {
      rootDir,
      label: `Current vendored file ${fileEntry.path}`,
      maxBytes: options.maxBytes ?? MAX_VENDOR_FILE_BYTES,
      afterRead: options.afterRead
    });
    const currentSha = currentBytes === null
      ? null
      : crypto.createHash('sha256').update(currentBytes).digest('hex');

    return {
      path: fileEntry.path,
      upstreamUrl: fileEntry.upstreamUrl,
      sha256: fileEntry.sha256,
      changed: currentSha !== fileEntry.sha256
    };
  });
}

function updateManifestHashes(manifest, fetchedFiles, today) {
  const nextManifest = structuredClone(manifest);
  nextManifest.last_reviewed = today;

  fetchedFiles.forEach((fileEntry) => {
    nextManifest.dependencies[fileEntry.dependencyIndex].files[fileEntry.fileIndex].sha256 = fileEntry.sha256;
  });

  return nextManifest;
}

function ensureSafeDirectory(rootDir, directory, fieldPath) {
  const lexicalRoot = path.resolve(rootDir);
  const resolvedRoot = fs.realpathSync(lexicalRoot);
  const resolvedDirectory = path.resolve(directory);
  const lexicalRootPrefix = `${lexicalRoot}${path.sep}`;
  if (resolvedDirectory !== lexicalRoot && !resolvedDirectory.startsWith(lexicalRootPrefix)) {
    fail(`Unsafe ${fieldPath}: directory escapes allowed root`);
  }

  let current = resolvedRoot;
  const relative = path.relative(lexicalRoot, resolvedDirectory);
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const stats = fs.lstatSync(current);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        fail(`Unsafe ${fieldPath}: parent contains a non-directory or symlink`);
      }
    } else {
      fs.mkdirSync(current);
    }
  }
}

function writeFileAtomically(rootDir, filePath, bytes, fieldPath) {
  const directory = path.dirname(filePath);
  ensureSafeDirectory(rootDir, directory, fieldPath);
  assertSafeOutputPath(rootDir, filePath, fieldPath);
  const tempFilePath = path.join(directory, `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}-${crypto.randomUUID()}`);

  try {
    writeFileNoFollow(rootDir, tempFilePath, bytes, `${fieldPath} temporary file`);
    fs.renameSync(tempFilePath, filePath);
  } catch (error) {
    if (fs.existsSync(tempFilePath)) {
      fs.rmSync(tempFilePath, { force: true });
    }
    throw error;
  }
}

function assertVendorTreeHasNoSymlinks(rootDir) {
  collectVendoredFiles(path.join(rootDir, 'js', 'vendor'), rootDir);
}

function retainVendorRecoveryBundle(
  rootDir,
  backups,
  originalError,
  rollbackFailures,
  recoveryWriteImpl = writeFileNoFollow
) {
  const resolvedRoot = path.resolve(rootDir);
  const recoveryDirectory = fs.mkdtempSync(path.join(resolvedRoot, '.vendor-refresh-recovery-'));

  try {
    const failuresByPath = new Map(
      rollbackFailures.map(({ backup, error }) => [backup.path, error])
    );
    const entries = backups.map((backup, index) => {
      const resolvedPath = path.resolve(backup.path);
      const relativePath = path.relative(resolvedRoot, resolvedPath);
      if (
        relativePath === '' ||
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        fail(`Cannot retain recovery backup outside vendor root: ${backup.path}`);
      }

      const backupFile = backup.existed
        ? `${String(index).padStart(4, '0')}.bin`
        : null;
      if (backupFile) {
        recoveryWriteImpl(
          resolvedRoot,
          path.join(recoveryDirectory, backupFile),
          backup.bytesBefore,
          `vendor recovery backup ${index}`
        );
      }

      const rollbackError = failuresByPath.get(backup.path);
      return {
        path: relativePath.split(path.sep).join('/'),
        existed: backup.existed,
        backup_file: backupFile,
        rollback_status: rollbackError ? 'failed' : 'restored',
        rollback_error: rollbackError?.message ?? null
      };
    });
    const recoveryManifest = {
      version: 1,
      status: 'rollback_incomplete',
      original_error: originalError?.message ?? String(originalError),
      entries
    };
    recoveryWriteImpl(
      resolvedRoot,
      path.join(recoveryDirectory, 'recovery.json'),
      Buffer.from(`${JSON.stringify(recoveryManifest, null, 2)}\n`, 'utf8'),
      'vendor recovery manifest'
    );
    return recoveryDirectory;
  } catch (error) {
    error.recoveryDirectory = recoveryDirectory;
    throw error;
  }
}

function sameLockIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameLockSnapshot(left, right) {
  return sameLockIdentity(left, right) &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function assertVendorRefreshRoot(lockState) {
  let currentStats;
  let currentRealPath;
  try {
    currentStats = fs.lstatSync(lockState.rootDir, { bigint: true });
    currentRealPath = fs.realpathSync(lockState.rootDir);
  } catch (error) {
    fail(`Vendor refresh lock root changed while held: ${error.message}`);
  }
  if (
    currentStats.isSymbolicLink() ||
    !currentStats.isDirectory() ||
    !sameLockIdentity(currentStats, lockState.rootStats) ||
    currentRealPath !== lockState.realRoot
  ) {
    fail('Vendor refresh lock root changed while held');
  }
}

function assertVendorRefreshLock(lockState) {
  assertVendorRefreshRoot(lockState);

  let descriptorStats;
  let pathStats;
  try {
    descriptorStats = fs.fstatSync(lockState.descriptor, { bigint: true });
    pathStats = fs.lstatSync(lockState.lockPath, { bigint: true });
  } catch (error) {
    fail(`Vendor refresh lock changed while held: ${error.message}`);
  }
  if (
    !descriptorStats.isFile() ||
    descriptorStats.nlink !== 1n ||
    pathStats.isSymbolicLink() ||
    !pathStats.isFile() ||
    pathStats.nlink !== 1n ||
    !sameLockSnapshot(descriptorStats, lockState.lockStats) ||
    !sameLockSnapshot(pathStats, lockState.lockStats)
  ) {
    fail('Vendor refresh lock changed while held');
  }
}

function unlinkOwnedVendorRefreshLock(lockState) {
  let pathStats;
  try {
    pathStats = fs.lstatSync(lockState.lockPath, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (
    pathStats.isSymbolicLink() ||
    !pathStats.isFile() ||
    !sameLockSnapshot(pathStats, lockState.lockStats)
  ) {
    fail('Vendor refresh lock path was replaced; refusing to remove it');
  }
  fs.unlinkSync(lockState.lockPath);
}

function acquireVendorRefreshLock(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  let rootStats;
  let realRoot;
  try {
    rootStats = fs.lstatSync(resolvedRoot, { bigint: true });
    realRoot = fs.realpathSync(resolvedRoot);
  } catch (error) {
    fail(`Cannot acquire vendor refresh lock: invalid root: ${error.message}`);
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    fail('Cannot acquire vendor refresh lock: root must be a non-symlink directory');
  }

  const lockPath = path.join(resolvedRoot, VENDOR_REFRESH_LOCK_NAME);
  const flags = fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0) |
    (fs.constants.O_CLOEXEC || 0);
  let descriptor;
  let openedStats;
  const provisionalState = {
    descriptor: undefined,
    lockPath,
    lockStats: undefined,
    realRoot,
    rootDir: resolvedRoot,
    rootStats
  };

  try {
    descriptor = fs.openSync(lockPath, flags, 0o600);
    provisionalState.descriptor = descriptor;
    openedStats = fs.fstatSync(descriptor, { bigint: true });
    if (!openedStats.isFile() || openedStats.nlink !== 1n) {
      fail('Cannot acquire vendor refresh lock: opened lock is not a private regular file');
    }
    fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`);
    fs.fsyncSync(descriptor);
    provisionalState.lockStats = fs.fstatSync(descriptor, { bigint: true });
    assertVendorRefreshLock(provisionalState);
    return provisionalState;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch (closeError) {
        error.closeError = closeError;
      }
      if (openedStats) {
        try {
          const current = fs.lstatSync(lockPath, { bigint: true });
          if (!current.isSymbolicLink() && current.isFile() && sameLockIdentity(current, openedStats)) {
            fs.unlinkSync(lockPath);
          }
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') error.cleanupError = cleanupError;
        }
      }
    }
    if (error.code === 'EEXIST' || error.code === 'ELOOP') {
      fail(`Vendor refresh lock is already held or unsafe: ${lockPath}`);
    }
    throw error;
  }
}

function releaseVendorRefreshLock(lockState) {
  let validationError;
  try {
    assertVendorRefreshLock(lockState);
  } catch (error) {
    validationError = error;
  }
  try {
    fs.closeSync(lockState.descriptor);
  } catch (error) {
    if (!validationError) validationError = error;
    else validationError.closeError = error;
  }
  lockState.descriptor = undefined;
  if (validationError) throw validationError;

  assertVendorRefreshRoot(lockState);
  unlinkOwnedVendorRefreshLock(lockState);
}

async function withVendorRefreshLock(rootDir, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('callback must be a function');
  }
  const lockState = acquireVendorRefreshLock(rootDir);
  let result;
  let callbackError;
  try {
    result = await callback(lockState);
    assertVendorRefreshLock(lockState);
  } catch (error) {
    callbackError = error;
  }

  let releaseError;
  try {
    releaseVendorRefreshLock(lockState);
  } catch (error) {
    releaseError = error;
  }
  if (callbackError) {
    if (releaseError) callbackError.lockReleaseError = releaseError;
    throw callbackError;
  }
  if (releaseError) throw releaseError;
  return result;
}

function inspectRefreshFileSnapshot(filePath, label) {
  let stats;
  try {
    stats = fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    fail(`${label}: could not inspect stable file snapshot: ${error.message}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1n) {
    fail(`${label}: expected a single-link regular file snapshot`);
  }
  return stats;
}

function assertRefreshBackupUnchanged(backup) {
  const currentBytes = readOptionalRefreshFile(backup.path, {
    rootDir: backup.rootDir,
    label: `${backup.label} transaction preflight`,
    maxBytes: backup.maxBytes
  });
  if (!backup.existed) {
    if (currentBytes !== null) {
      fail(`${backup.label} changed after transaction backup; refusing to publish`);
    }
    return;
  }
  if (currentBytes === null) {
    fail(`${backup.label} disappeared after transaction backup; refusing to publish`);
  }
  const currentStats = inspectRefreshFileSnapshot(backup.path, `${backup.label} transaction preflight`);
  if (!sameLockSnapshot(backup.statsBefore, currentStats) || !backup.bytesBefore.equals(currentBytes)) {
    fail(`${backup.label} changed after transaction backup; refusing to publish`);
  }
}

function capturePublishedRefreshFile(backup) {
  const initialStats = inspectRefreshFileSnapshot(backup.path, `${backup.label} published output`);
  const publishedBytes = readOptionalRefreshFile(backup.path, {
    rootDir: backup.rootDir,
    label: `${backup.label} published output`,
    maxBytes: backup.maxBytes
  });
  if (publishedBytes === null) {
    fail(`Published ${backup.label} disappeared before verification`);
  }
  const publishedStats = inspectRefreshFileSnapshot(backup.path, `${backup.label} published output`);
  if (!sameLockSnapshot(initialStats, publishedStats) || !backup.bytes.equals(publishedBytes)) {
    fail(`Published ${backup.label} does not match the intended bytes`);
  }
  return { ...backup, publishedBytes, publishedStats };
}

function assertPublishedRefreshFileOwned(backup) {
  if (!backup.publishedStats || !backup.publishedBytes) {
    fail(`Published ${backup.label} ownership was not verified; refusing to alter it`);
  }
  const currentBytes = readOptionalRefreshFile(backup.path, {
    rootDir: backup.rootDir,
    label: `${backup.label} rollback ownership`,
    maxBytes: backup.maxBytes
  });
  if (currentBytes === null) {
    fail(`Published ${backup.label} disappeared before rollback; refusing to alter it`);
  }
  const currentStats = inspectRefreshFileSnapshot(backup.path, `${backup.label} rollback ownership`);
  if (
    !sameLockSnapshot(backup.publishedStats, currentStats) ||
    !backup.publishedBytes.equals(currentBytes)
  ) {
    fail(`Published ${backup.label} changed ownership or content before rollback; refusing to alter it`);
  }
}

function persistVendorRefresh(manifestPath, manifest, fetchedFiles, rootDir = projectRoot, options = {}) {
  const beforeWrite = options.beforeWrite ?? (() => {});
  if (typeof beforeWrite !== 'function') throw new TypeError('beforeWrite must be a function');
  if (options.afterPersist !== undefined && typeof options.afterPersist !== 'function') {
    throw new TypeError('afterPersist must be a function when provided');
  }
  if (options.backupAfterRead !== undefined && typeof options.backupAfterRead !== 'function') {
    throw new TypeError('backupAfterRead must be a function when provided');
  }
  const updates = [
    ...fetchedFiles.map((fileEntry) => ({
      path: path.join(rootDir, fileEntry.path),
      bytes: fileEntry.bytes,
      label: fileEntry.path,
      maxBytes: MAX_VENDOR_FILE_BYTES,
      rootDir
    })),
    {
      path: manifestPath,
      bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
      label: 'vendor manifest',
      maxBytes: MAX_VENDOR_MANIFEST_BYTES,
      rootDir
    }
  ];
  const backups = updates.map((update, index) => {
    const bytesBefore = readOptionalRefreshFile(update.path, {
      rootDir,
      label: `${update.label} transaction backup`,
      maxBytes: update.maxBytes,
      afterRead: options.backupAfterRead
        ? (details) => options.backupAfterRead({ ...details, index, label: update.label })
        : undefined
    });
    return {
      ...update,
      existed: bytesBefore !== null,
      bytesBefore,
      statsBefore: bytesBefore === null
        ? null
        : inspectRefreshFileSnapshot(update.path, `${update.label} transaction backup`)
    };
  });
  backups.forEach(assertRefreshBackupUnchanged);

  const committedBackups = [];
  try {
    updates.forEach((update, index) => {
      beforeWrite({ phase: 'persist', index, path: update.path, label: update.label });
      assertRefreshBackupUnchanged(backups[index]);
      writeFileAtomically(rootDir, update.path, update.bytes, update.label);
      // Record a tentative commit before any further filesystem operation. If
      // verification itself races with path replacement, rollback will retain
      // evidence and refuse to touch a path whose ownership was not proven.
      committedBackups.push({
        ...backups[index],
        publishedBytes: update.bytes,
        publishedStats: null
      });
      committedBackups[committedBackups.length - 1] = capturePublishedRefreshFile(backups[index]);
    });
    options.afterPersist?.();
  } catch (error) {
    const rollbackFailures = [];
    [...committedBackups].reverse().forEach((backup, index) => {
      try {
        beforeWrite({ phase: 'rollback', index, path: backup.path, label: backup.label });
        assertPublishedRefreshFileOwned(backup);
        if (backup.existed) {
          writeFileAtomically(rootDir, backup.path, backup.bytesBefore, `${backup.label} rollback`);
          const restoredBytes = readOptionalRefreshFile(backup.path, {
            rootDir,
            label: `${backup.label} rollback`,
            maxBytes: backup.maxBytes
          });
          if (restoredBytes === null || !backup.bytesBefore.equals(restoredBytes)) {
            fail(`Rollback of ${backup.label} did not restore the exact prior bytes`);
          }
        } else {
          fs.unlinkSync(backup.path);
          if (fs.existsSync(backup.path)) {
            fail(`Rollback of ${backup.label} did not remove the published file`);
          }
        }
      } catch (rollbackError) {
        rollbackFailures.push({ backup, error: rollbackError });
      }
    });

    if (rollbackFailures.length === 0) {
      throw error;
    }

    let recoveryDirectory = null;
    let recoveryError = null;
    try {
      recoveryDirectory = retainVendorRecoveryBundle(
        rootDir,
        committedBackups,
        error,
        rollbackFailures,
        options.recoveryWriteImpl
      );
    } catch (bundleError) {
      recoveryError = bundleError;
      recoveryDirectory = bundleError.recoveryDirectory ?? null;
    }

    const failedLabels = rollbackFailures.map(({ backup }) => backup.label).join(', ');
    let recoveryNote;
    if (recoveryError) {
      recoveryNote = recoveryDirectory
        ? ` Recovery directory created at ${recoveryDirectory}, but evidence retention was incomplete: ${recoveryError.message}.`
        : ` Recovery evidence retention failed: ${recoveryError.message}.`;
    } else {
      recoveryNote = ` Recovery evidence retained at ${recoveryDirectory}.`;
    }
    const aggregate = new AggregateError(
      [error, ...rollbackFailures.map(({ error: rollbackError }) => rollbackError), ...(recoveryError ? [recoveryError] : [])],
      `Vendor refresh failed and rollback was incomplete for: ${failedLabels}.${recoveryNote}`,
      { cause: error }
    );
    aggregate.recoveryDirectory = recoveryDirectory;
    aggregate.rollbackFailures = rollbackFailures.map(({ backup, error: rollbackError }) => ({
      path: backup.path,
      label: backup.label,
      error: rollbackError
    }));
    throw aggregate;
  }
}

function stageAndValidateRefresh(manifest, fetchedFiles, rootDir, today) {
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-vendor-stage-'));
  try {
    fs.cpSync(path.join(rootDir, 'js', 'vendor'), path.join(stageRoot, 'js', 'vendor'), { recursive: true, dereference: false });
    const nextManifest = updateManifestHashes(manifest, fetchedFiles, today);
    fetchedFiles.forEach((fileEntry) => {
      writeFileAtomically(stageRoot, path.join(stageRoot, fileEntry.path), fileEntry.bytes, `staged ${fileEntry.path}`);
    });
    const stagedManifestPath = path.join(stageRoot, 'docs', 'security', 'vendor-dependencies.json');
    writeFileAtomically(stageRoot, stagedManifestPath, Buffer.from(`${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8'), 'staged vendor manifest');
    validateVendorGovernance(nextManifest, { rootDir: stageRoot, today });
    return nextManifest;
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

async function runVendorRefresh(options = {}, dependencies = {}) {
  const manifestPath = dependencies.manifestPath || path.join(projectRoot, 'docs', 'security', 'vendor-dependencies.json');
  const rootDir = dependencies.rootDir || projectRoot;
  const executeRefresh = async (lockState = null) => {
    if (lockState && dependencies.afterLockAcquired) {
      await dependencies.afterLockAcquired({ lockPath: lockState?.lockPath });
    }
    if (lockState) assertVendorRefreshLock(lockState);

    const manifest = loadManifest(manifestPath, { rootDir });
    listManifestFiles(manifest);
    assertVendorTreeHasNoSymlinks(rootDir);

    const fetchedFiles = await fetchVendorFiles(manifest, {
      fetchImpl: dependencies.fetchImpl,
      lookupImpl: dependencies.lookupImpl,
      requestImpl: dependencies.requestImpl,
      requestBytesImpl: dependencies.requestBytesImpl,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBytes: dependencies.maxBytes ?? MAX_VENDOR_FILE_BYTES
    });

    const summary = summarizeFetchedFiles(fetchedFiles, rootDir, {
      afterRead: dependencies.comparisonAfterRead
    });
    const nextManifest = stageAndValidateRefresh(manifest, fetchedFiles, rootDir, options.today);

    if (options.write) {
      assertVendorRefreshLock(lockState);
      persistVendorRefresh(manifestPath, nextManifest, fetchedFiles, rootDir, {
        afterPersist() {
          assertVendorRefreshLock(lockState);
          validateVendorGovernance(loadManifest(manifestPath, { rootDir }), { rootDir, today: options.today });
          assertVendorRefreshLock(lockState);
        }
      });
    }

    return {
      write: options.write,
      summary,
      manifest: nextManifest
    };
  };

  return options.write
    ? withVendorRefreshLock(rootDir, executeRefresh)
    : executeRefresh();
}

function vendorRefreshExitCode(result) {
  if (!result || !Array.isArray(result.summary)) {
    fail('Invalid vendor refresh result');
  }
  return !result.write && result.summary.some((entry) => entry.changed) ? 1 : 0;
}

async function main() {
  const options = parseArgs();
  const result = await runVendorRefresh(options);
  const changedFiles = result.summary.filter((entry) => entry.changed);

  if (!options.write) {
    console.log(
      changedFiles.length === 0
        ? 'Vendor refresh dry-run complete: all vendored files already match upstream.'
        : `Vendor refresh dry-run complete: ${changedFiles.length} file(s) differ from upstream.`
    );
    changedFiles.forEach((entry) => {
      console.log(`- ${entry.path} <= ${entry.upstreamUrl}`);
    });
    process.exitCode = vendorRefreshExitCode(result);
    return;
  }

  console.log(`Vendor refresh complete: wrote ${result.summary.length} file(s) and updated manifest review date.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export {
  ensureHttpsUrl,
  ensureVendorPath,
  fetchVendorFiles,
  parseArgs,
  persistVendorRefresh,
  runVendorRefresh,
  summarizeFetchedFiles,
  updateManifestHashes,
  withVendorRefreshLock,
  assertVendorTreeHasNoSymlinks,
  vendorRefreshExitCode
};
