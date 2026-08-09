'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class SafeOutputPathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SafeOutputPathError';
  }
}

function assertRelativePath(relativePath, field = 'path') {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new SafeOutputPathError(`${field} must be a non-empty relative path`);
  }
  if (relativePath.includes('\0') || relativePath.includes('\\') || path.isAbsolute(relativePath)) {
    throw new SafeOutputPathError(`${field} must be a safe relative path`);
  }

  const segments = relativePath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new SafeOutputPathError(`${field} contains an unsafe path segment`);
  }
  return segments;
}

function rootRealPath(rootPath) {
  let root;
  try {
    root = fs.realpathSync(rootPath);
  } catch (error) {
    throw new SafeOutputPathError(`Cannot resolve trusted root ${rootPath}: ${error.message}`);
  }
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    throw new SafeOutputPathError(`Trusted root is not a directory: ${rootPath}`);
  }
  return root;
}

function isWithinRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function ensureTrustedDirectory(root, relativeDirectory = '') {
  const segments = relativeDirectory ? assertRelativePath(relativeDirectory, 'directory') : [];
  let current = root;

  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new SafeOutputPathError(`Cannot inspect output directory ${current}: ${error.message}`);
      }
      try {
        fs.mkdirSync(current, { mode: 0o755 });
      } catch (mkdirError) {
        throw new SafeOutputPathError(`Cannot create trusted output directory ${current}: ${mkdirError.message}`);
      }
      stat = fs.lstatSync(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new SafeOutputPathError(`Output directory is not a trusted directory: ${current}`);
    }
    const realCurrent = fs.realpathSync(current);
    if (!isWithinRoot(root, realCurrent)) {
      throw new SafeOutputPathError(`Output directory escapes trusted root: ${current}`);
    }
  }

  return current;
}

function resolveTrustedDirectory(rootPath, relativeDirectory = '') {
  const root = rootRealPath(rootPath);
  const segments = relativeDirectory ? assertRelativePath(relativeDirectory, 'directory') : [];
  let current = root;

  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      throw new SafeOutputPathError(`Cannot inspect trusted directory ${current}: ${error.message}`);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new SafeOutputPathError(`Trusted path is not a regular directory: ${current}`);
    }
    const realCurrent = fs.realpathSync(current);
    if (!isWithinRoot(root, realCurrent)) {
      throw new SafeOutputPathError(`Trusted directory escapes root: ${current}`);
    }
    current = realCurrent;
  }

  return current;
}

function trustedTarget(rootPath, relativePath) {
  const root = rootRealPath(rootPath);
  const segments = assertRelativePath(relativePath);
  const parentSegments = segments.slice(0, -1);
  const basename = segments[segments.length - 1];
  const parentRelative = parentSegments.join('/');
  const parent = ensureTrustedDirectory(root, parentRelative);
  const parentReal = fs.realpathSync(parent);
  const target = path.join(parentReal, basename);
  const lexicalTarget = path.resolve(root, ...segments);
  if (lexicalTarget !== target || !isWithinRoot(root, target) || !isWithinRoot(root, parentReal)) {
    throw new SafeOutputPathError(`Path escapes trusted root: ${relativePath}`);
  }
  return { root, parent, parentReal, target };
}

function assertRegularSource(rootPath, relativePath) {
  const { root, target } = trustedTarget(rootPath, relativePath);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    throw new SafeOutputPathError(`Cannot inspect source file ${target}: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new SafeOutputPathError(`Source is not a regular file: ${target}`);
  }
  const realTarget = fs.realpathSync(target);
  if (!isWithinRoot(root, realTarget)) {
    throw new SafeOutputPathError(`Source escapes trusted root: ${target}`);
  }
  return target;
}

function readTrustedText(rootPath, relativePath, { maxBytes = Number.POSITIVE_INFINITY } = {}) {
  const source = assertRegularSource(rootPath, relativePath);
  let descriptor;
  try {
    descriptor = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new SafeOutputPathError(`Source is not a regular file: ${source}`);
    }
    if (stat.size > maxBytes) {
      throw new SafeOutputPathError(`Trusted source exceeds the ${maxBytes}-byte read limit: ${source}`);
    }
    return fs.readFileSync(descriptor, 'utf8');
  } catch (error) {
    if (error instanceof SafeOutputPathError) throw error;
    throw new SafeOutputPathError(`Cannot read trusted source ${source}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function assertWritableTarget(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new SafeOutputPathError(`Output is not a regular file: ${target}`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') return;
    if (error instanceof SafeOutputPathError) throw error;
    throw new SafeOutputPathError(`Cannot inspect output file ${target}: ${error.message}`);
  }
}

function writeTrustedBufferAtomic(rootPath, relativePath, content) {
  const { root, parent, parentReal, target } = trustedTarget(rootPath, relativePath);
  assertWritableTarget(target);

  const temporaryPath = path.join(parentReal, `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor;
  try {
    const flags = fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW || 0);
    descriptor = fs.openSync(temporaryPath, flags, 0o644);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;

    // Re-check the directory and destination immediately before replacement.
    const currentParent = fs.realpathSync(parent);
    if (currentParent !== parentReal || !isWithinRoot(root, currentParent)) {
      throw new SafeOutputPathError(`Output directory escapes trusted root: ${parent}`);
    }
    assertWritableTarget(target);
    fs.renameSync(temporaryPath, target);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.unlinkSync(temporaryPath); } catch {}
    if (error instanceof SafeOutputPathError) throw error;
    throw new SafeOutputPathError(`Cannot atomically write output ${target}: ${error.message}`);
  }
}

function writeTrustedTextAtomic(rootPath, relativePath, content) {
  if (typeof content !== 'string') {
    throw new SafeOutputPathError('Output content must be a string');
  }
  writeTrustedBufferAtomic(rootPath, relativePath, Buffer.from(content, 'utf8'));
}

function writeTrustedFileAtomic(rootPath, relativePath, sourcePath) {
  let stat;
  try {
    stat = fs.lstatSync(sourcePath);
  } catch (error) {
    throw new SafeOutputPathError(`Cannot inspect generated source ${sourcePath}: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new SafeOutputPathError(`Generated source is not a regular file: ${sourcePath}`);
  }
  let descriptor;
  try {
    descriptor = fs.openSync(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const openedStat = fs.fstatSync(descriptor);
    if (!openedStat.isFile()) {
      throw new SafeOutputPathError(`Generated source is not a regular file: ${sourcePath}`);
    }
    writeTrustedBufferAtomic(rootPath, relativePath, fs.readFileSync(descriptor));
  } catch (error) {
    if (error instanceof SafeOutputPathError) throw error;
    throw new SafeOutputPathError(`Cannot read generated source ${sourcePath}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

module.exports = {
  SafeOutputPathError,
  assertRegularSource,
  resolveTrustedDirectory,
  readTrustedText,
  writeTrustedBufferAtomic,
  writeTrustedTextAtomic,
  writeTrustedFileAtomic
};
