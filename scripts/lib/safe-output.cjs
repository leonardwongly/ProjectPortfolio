const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

function isContained(rootPath, candidatePath) {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

function safeRealpath(filePath, fieldPath) {
  try {
    return fs.realpathSync(filePath);
  } catch (error) {
    throw new Error(`Unsafe ${fieldPath}: could not resolve ${filePath}: ${error.message}`);
  }
}

function assertSafeDestination(resolvedFile, fieldPath) {
  try {
    const destinationStats = fs.lstatSync(resolvedFile);
    if (destinationStats.isSymbolicLink()) {
      throw new Error(`Unsafe ${fieldPath}: refusing to follow an output symlink`);
    }
    if (!destinationStats.isFile()) {
      throw new Error(`Unsafe ${fieldPath}: destination is not a regular file`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function inspectSafeOutputPath(rootPath, filePath, fieldPath) {
  const lexicalRoot = path.resolve(rootPath);
  const resolvedRoot = safeRealpath(lexicalRoot, `${fieldPath} root`);
  const resolvedFile = path.resolve(filePath);
  if (!isContained(lexicalRoot, resolvedFile)) {
    throw new Error(`Unsafe ${fieldPath}: path escapes its allowed root`);
  }

  const parentPath = path.dirname(resolvedFile);
  const realParent = safeRealpath(parentPath, `${fieldPath} parent`);
  if (!isContained(resolvedRoot, realParent)) {
    throw new Error(`Unsafe ${fieldPath}: parent resolves outside its allowed root`);
  }

  let parentStats;
  try {
    parentStats = fs.statSync(realParent);
  } catch (error) {
    throw new Error(`Unsafe ${fieldPath} parent: could not inspect ${realParent}: ${error.message}`);
  }
  if (!parentStats.isDirectory()) {
    throw new Error(`Unsafe ${fieldPath}: output parent is not a directory`);
  }

  assertSafeDestination(resolvedFile, fieldPath);

  return {
    parentDevice: parentStats.dev,
    parentInode: parentStats.ino,
    parentPath,
    realParent,
    resolvedFile
  };
}

function assertSafeOutputPath(rootPath, filePath, fieldPath = 'output') {
  return inspectSafeOutputPath(rootPath, filePath, fieldPath).resolvedFile;
}

function assertParentUnchanged(outputState, fieldPath) {
  let currentRealParent;
  try {
    currentRealParent = fs.realpathSync(outputState.parentPath);
  } catch (error) {
    throw new Error(`Unsafe ${fieldPath}: output parent changed during write: ${error.message}`);
  }

  if (currentRealParent !== outputState.realParent) {
    throw new Error(`Unsafe ${fieldPath}: output parent changed during write`);
  }

  let currentStats;
  try {
    currentStats = fs.statSync(currentRealParent);
  } catch (error) {
    throw new Error(`Unsafe ${fieldPath}: output parent changed during write: ${error.message}`);
  }
  if (
    !currentStats.isDirectory() ||
    currentStats.dev !== outputState.parentDevice ||
    currentStats.ino !== outputState.parentInode
  ) {
    throw new Error(`Unsafe ${fieldPath}: output parent changed during write`);
  }
}

function sameFileIdentity(stats, identity) {
  return stats.dev === identity.device && stats.ino === identity.inode;
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function assertExpectedDestination(resolvedFile, expectedDestination, fieldPath) {
  if (expectedDestination === undefined) return;

  let currentStats;
  try {
    currentStats = fs.lstatSync(resolvedFile, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT' && expectedDestination.existed === false) return;
    if (error.code === 'ENOENT') {
      throw new Error(`Unsafe ${fieldPath}: destination changed before publish (expected an existing file)`);
    }
    throw error;
  }

  if (expectedDestination.existed === false) {
    throw new Error(`Unsafe ${fieldPath}: destination changed before publish (expected no file)`);
  }
  if (!currentStats.isFile() || currentStats.isSymbolicLink() ||
      !sameFileSnapshot(expectedDestination.stats, currentStats)) {
    throw new Error(`Unsafe ${fieldPath}: destination changed before publish`);
  }
}

function validateWriteOptions(options) {
  if (options === undefined) return {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Safe output options must be an object.');
  }
  const { expectedDestination, beforeFinalDestinationCheck } = options;
  if (beforeFinalDestinationCheck !== undefined && typeof beforeFinalDestinationCheck !== 'function') {
    throw new TypeError('beforeFinalDestinationCheck must be a function when provided.');
  }
  if (expectedDestination !== undefined) {
    if (!expectedDestination || typeof expectedDestination !== 'object' ||
        typeof expectedDestination.existed !== 'boolean') {
      throw new TypeError('expectedDestination must declare whether the destination existed.');
    }
    if (expectedDestination.existed &&
        (!expectedDestination.stats || typeof expectedDestination.stats !== 'object')) {
      throw new TypeError('An existing expectedDestination requires verified stats.');
    }
  }
  return { expectedDestination, beforeFinalDestinationCheck };
}

function assertTemporaryPathOwned(temporaryPath, identity, fieldPath) {
  let currentStats;
  try {
    currentStats = fs.lstatSync(temporaryPath, { bigint: true });
  } catch (error) {
    throw new Error(`Unsafe ${fieldPath}: temporary destination changed during write: ${error.message}`);
  }
  if (!currentStats.isFile() || !sameFileIdentity(currentStats, identity)) {
    throw new Error(`Unsafe ${fieldPath}: temporary destination changed during write`);
  }
}

function cleanupOwnedTemporaryPath(temporaryPath, identity, error) {
  if (temporaryPath === undefined || identity === undefined) return;

  let currentStats;
  try {
    currentStats = fs.lstatSync(temporaryPath, { bigint: true });
  } catch (cleanupError) {
    if (cleanupError.code !== 'ENOENT') error.cleanupInspectError = cleanupError;
    return;
  }

  if (!currentStats.isFile() || !sameFileIdentity(currentStats, identity)) return;

  // Without unlinkat, a final syscall-sized swap window remains between this
  // identity check and unlinkSync; suspicious identities are always retained.
  try {
    fs.unlinkSync(temporaryPath);
  } catch (cleanupError) {
    if (cleanupError.code !== 'ENOENT') error.unlinkError = cleanupError;
  }
}

function writeFileNoFollow(rootPath, filePath, bytes, fieldPath = 'output', options) {
  const { expectedDestination, beforeFinalDestinationCheck } = validateWriteOptions(options);
  const outputState = inspectSafeOutputPath(rootPath, filePath, fieldPath);
  const { parentPath, resolvedFile } = outputState;
  assertExpectedDestination(resolvedFile, expectedDestination, fieldPath);
  const flags = fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  let publishedStats;
  let temporaryIdentity;
  let temporaryPath;

  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidatePath = path.join(
        parentPath,
        `.safe-output-${process.pid}-${crypto.randomBytes(16).toString('hex')}.tmp`
      );
      try {
        descriptor = fs.openSync(candidatePath, flags, 0o644);
        temporaryPath = candidatePath;
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }

    if (descriptor === undefined) {
      throw new Error(`Unsafe ${fieldPath}: could not reserve a temporary output file`);
    }

    const stats = fs.fstatSync(descriptor, { bigint: true });
    if (!stats.isFile()) {
      throw new Error(`Unsafe ${fieldPath}: temporary destination is not a regular file`);
    }
    temporaryIdentity = { device: stats.dev, inode: stats.ino };
    assertParentUnchanged(outputState, fieldPath);
    assertTemporaryPathOwned(temporaryPath, temporaryIdentity, fieldPath);

    fs.writeFileSync(descriptor, bytes);
    publishedStats = fs.fstatSync(descriptor, { bigint: true });
    if (!publishedStats.isFile() || publishedStats.nlink !== 1n ||
        !sameFileIdentity(publishedStats, temporaryIdentity)) {
      throw new Error(`Unsafe ${fieldPath}: temporary destination changed during write`);
    }
    fs.closeSync(descriptor);
    descriptor = undefined;

    assertParentUnchanged(outputState, fieldPath);
    assertSafeDestination(resolvedFile, fieldPath);
    assertTemporaryPathOwned(temporaryPath, temporaryIdentity, fieldPath);
    assertParentUnchanged(outputState, fieldPath);
    if (beforeFinalDestinationCheck) {
      beforeFinalDestinationCheck({ destinationPath: resolvedFile, temporaryPath });
    }
    assertParentUnchanged(outputState, fieldPath);
    assertExpectedDestination(resolvedFile, expectedDestination, fieldPath);
    assertTemporaryPathOwned(temporaryPath, temporaryIdentity, fieldPath);
    assertParentUnchanged(outputState, fieldPath);

    // Node does not expose openat/renameat here, so a final syscall-sized path-swap
    // window remains between this revalidation and renameSync.
    fs.renameSync(temporaryPath, resolvedFile);
    temporaryPath = undefined;
    temporaryIdentity = undefined;
    return { stats: publishedStats };
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch (cleanupError) {
        error.closeError = cleanupError;
      }
    }
    cleanupOwnedTemporaryPath(temporaryPath, temporaryIdentity, error);
    throw error;
  }
}

module.exports = { assertSafeOutputPath, writeFileNoFollow };
