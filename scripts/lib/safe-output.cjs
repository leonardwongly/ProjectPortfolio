const fs = require('node:fs');
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

function assertSafeOutputPath(rootPath, filePath, fieldPath = 'output') {
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

  try {
    if (fs.lstatSync(resolvedFile).isSymbolicLink()) {
      throw new Error(`Unsafe ${fieldPath}: refusing to follow an output symlink`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return resolvedFile;
}

function writeFileNoFollow(rootPath, filePath, bytes, fieldPath = 'output') {
  const resolvedFile = assertSafeOutputPath(rootPath, filePath, fieldPath);
  const flags = fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_TRUNC |
    (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(resolvedFile, flags, 0o644);

  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile()) {
      throw new Error(`Unsafe ${fieldPath}: destination is not a regular file`);
    }
    fs.writeFileSync(descriptor, bytes);
  } finally {
    fs.closeSync(descriptor);
  }
}

module.exports = { assertSafeOutputPath, writeFileNoFollow };
