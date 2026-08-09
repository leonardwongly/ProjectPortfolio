const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const READ_CHUNK_BYTES = 64 * 1024;

class StableFileReadError extends Error {
  constructor(reason, label, detail) {
    super(`${label}: ${detail}`);
    this.name = 'StableFileReadError';
    this.reason = reason;
  }
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileSnapshot(left, right) {
  return sameFileIdentity(left, right) &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function inspectDirectory(directoryPath, label, reason = 'unreadable') {
  let stats;
  try {
    stats = fs.lstatSync(directoryPath, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new StableFileReadError('missing', label, `parent directory is missing: ${directoryPath}`);
    }
    throw new StableFileReadError(reason, label, `could not inspect parent directory: ${error.message}`);
  }
  if (stats.isSymbolicLink()) {
    throw new StableFileReadError('symlink', label, `refusing symbolic link parent directory: ${directoryPath}`);
  }
  if (!stats.isDirectory()) {
    throw new StableFileReadError('non_regular', label, `parent path is not a directory: ${directoryPath}`);
  }
  return stats;
}

function inspectParentChain(rootDir, filePath, label) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedFile = path.resolve(filePath);
  const relativeFile = path.relative(resolvedRoot, resolvedFile);
  if (
    relativeFile === '' ||
    relativeFile === '..' ||
    relativeFile.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeFile)
  ) {
    throw new StableFileReadError('outside_root', label, 'file must stay inside the configured root');
  }

  const relativeParent = path.relative(resolvedRoot, path.dirname(resolvedFile));
  const snapshots = [];
  let current = resolvedRoot;
  snapshots.push({ path: current, stats: inspectDirectory(current, label) });
  if (relativeParent && relativeParent !== '.') {
    for (const segment of relativeParent.split(path.sep)) {
      current = path.join(current, segment);
      snapshots.push({ path: current, stats: inspectDirectory(current, label) });
    }
  }
  return { resolvedFile, snapshots };
}

function assertParentChainUnchanged(snapshots, label) {
  for (const snapshot of snapshots) {
    let current;
    try {
      current = fs.lstatSync(snapshot.path, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new StableFileReadError('changed', label, 'parent directory disappeared while the file was read');
      }
      throw new StableFileReadError('unreadable', label, `could not re-inspect parent directory: ${error.message}`);
    }
    if (current.isSymbolicLink() || !current.isDirectory() || !sameFileIdentity(snapshot.stats, current)) {
      throw new StableFileReadError('changed', label, 'parent directory changed while the file was read');
    }
  }
}

function inspectFile(filePath, label) {
  try {
    return fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new StableFileReadError('missing', label, 'file is missing');
    }
    throw new StableFileReadError('unreadable', label, `could not inspect file: ${error.message}`);
  }
}

function assertCurrentPathMatches(filePath, expectedStats, label, detail) {
  let current;
  try {
    current = fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new StableFileReadError('changed', label, 'path was deleted while the file was read');
    }
    throw new StableFileReadError('unreadable', label, `could not re-inspect file: ${error.message}`);
  }
  if (current.isSymbolicLink()) {
    throw new StableFileReadError('changed', label, detail);
  }
  if (current.nlink !== 1n) {
    throw new StableFileReadError('hardlink', label, 'file must have exactly one hard link');
  }
  if (!sameFileSnapshot(expectedStats, current)) {
    throw new StableFileReadError('changed', label, detail);
  }
}

function readStableFileResult(filePath, {
  label = filePath,
  rootDir = path.dirname(path.resolve(filePath)),
  maxBytes,
  minBytes = 1,
  afterRead,
  fatalUtf8 = false,
  openSync = fs.openSync
} = {}, returnSnapshot = false) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('maxBytes must be a positive safe integer');
  }
  if (!Number.isSafeInteger(minBytes) || minBytes < 0 || minBytes > maxBytes) {
    throw new TypeError('minBytes must be a non-negative safe integer no greater than maxBytes');
  }
  if (afterRead !== undefined && typeof afterRead !== 'function') {
    throw new TypeError('afterRead must be a function when provided');
  }
  if (typeof fatalUtf8 !== 'boolean') {
    throw new TypeError('fatalUtf8 must be a boolean');
  }
  if (typeof openSync !== 'function') {
    throw new TypeError('openSync must be a function');
  }

  const { resolvedFile, snapshots: parentSnapshots } = inspectParentChain(rootDir, filePath, label);
  const initialStats = inspectFile(resolvedFile, label);
  if (initialStats.isSymbolicLink()) {
    throw new StableFileReadError('symlink', label, 'refusing to follow a symbolic link');
  }
  if (!initialStats.isFile()) {
    throw new StableFileReadError('non_regular', label, 'expected a regular file');
  }
  if (initialStats.nlink !== 1n) {
    throw new StableFileReadError('hardlink', label, 'file must have exactly one hard link');
  }
  if (initialStats.size < BigInt(minBytes)) {
    throw new StableFileReadError('too_small', label, `file is smaller than ${minBytes} bytes`);
  }
  if (initialStats.size > BigInt(maxBytes)) {
    throw new StableFileReadError('oversized', label, `file exceeds the ${maxBytes}-byte limit`);
  }

  const flags = fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW || 0) |
    (fs.constants.O_NONBLOCK || 0) |
    (fs.constants.O_CLOEXEC || 0);
  let descriptor;
  try {
    descriptor = openSync(resolvedFile, flags);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new StableFileReadError('changed', label, 'file disappeared before it could be opened');
    }
    if (error.code === 'ELOOP') {
      throw new StableFileReadError('symlink', label, 'refusing to follow a symbolic link');
    }
    throw new StableFileReadError('unreadable', label, `could not open file: ${error.message}`);
  }

  let bytes;
  let verifiedStats;
  try {
    const beforeReadStats = fs.fstatSync(descriptor, { bigint: true });
    if (!beforeReadStats.isFile()) {
      throw new StableFileReadError('non_regular', label, 'opened descriptor is not a regular file');
    }
    if (beforeReadStats.nlink === 0n) {
      throw new StableFileReadError('changed', label, 'opened file was removed before it could be read');
    }
    if (beforeReadStats.nlink !== 1n) {
      throw new StableFileReadError('hardlink', label, 'opened file must have exactly one hard link');
    }
    if (!sameFileSnapshot(initialStats, beforeReadStats)) {
      throw new StableFileReadError('changed', label, 'file changed between inspection and open');
    }
    assertParentChainUnchanged(parentSnapshots, label);
    assertCurrentPathMatches(
      resolvedFile,
      beforeReadStats,
      label,
      'path was replaced between inspection and open'
    );

    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const remaining = maxBytes - totalBytes;
      const capacity = remaining === 0 ? 1 : Math.min(READ_CHUNK_BYTES, remaining);
      const chunk = Buffer.allocUnsafe(capacity);
      const bytesRead = fs.readSync(descriptor, chunk, 0, capacity, totalBytes);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new StableFileReadError('oversized', label, `file exceeds the ${maxBytes}-byte limit while being read`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (BigInt(totalBytes) !== beforeReadStats.size) {
      throw new StableFileReadError('changed', label, 'file size changed while it was being read');
    }
    bytes = Buffer.concat(chunks, totalBytes);

    if (afterRead) afterRead({ filePath: resolvedFile, descriptor, bytes });

    const afterReadStats = fs.fstatSync(descriptor, { bigint: true });
    if (!afterReadStats.isFile() || afterReadStats.nlink === 0n) {
      throw new StableFileReadError('changed', label, 'opened file was removed or changed type while being read');
    }
    if (afterReadStats.nlink !== 1n) {
      throw new StableFileReadError('hardlink', label, 'opened file gained another hard link while being read');
    }
    if (!sameFileSnapshot(beforeReadStats, afterReadStats)) {
      throw new StableFileReadError('changed', label, 'opened file changed while it was being read');
    }
    assertParentChainUnchanged(parentSnapshots, label);
    assertCurrentPathMatches(resolvedFile, afterReadStats, label, 'path was replaced after the read');
    verifiedStats = afterReadStats;
  } finally {
    fs.closeSync(descriptor);
  }

  let result = bytes;
  if (fatalUtf8) {
    try {
      result = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      throw new StableFileReadError('invalid_utf8', label, `file is not valid UTF-8: ${error.message}`);
    }
  }
  return returnSnapshot ? { bytes: result, stats: verifiedStats } : result;
}

function readStableFileNoFollow(filePath, options) {
  return readStableFileResult(filePath, options, false);
}

function readStableFileSnapshotNoFollow(filePath, options) {
  return readStableFileResult(filePath, options, true);
}

module.exports = {
  READ_CHUNK_BYTES,
  StableFileReadError,
  readStableFileNoFollow,
  readStableFileSnapshotNoFollow,
  sameFileIdentity,
  sameFileSnapshot
};
