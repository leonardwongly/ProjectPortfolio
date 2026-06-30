const path = require('node:path');

const MAX_RELATIVE_PATH_LENGTH = 512;

class AssetPathValidationError extends Error {
  constructor(fieldPath, reason) {
    super(`Invalid path at ${fieldPath}: ${reason}`);
    this.name = 'AssetPathValidationError';
    this.fieldPath = fieldPath;
    this.reason = reason;
  }
}

function failPathValidation(fieldPath, reason) {
  throw new AssetPathValidationError(fieldPath, reason);
}

function sanitizeRelativeAssetPath(rawValue, fieldPath = 'asset', {
  allowedExtensions
} = {}) {
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

  if (allowedExtensions && !allowedExtensions.test(normalized)) {
    failPathValidation(fieldPath, `path must match ${allowedExtensions}`);
  }

  return normalized;
}

function resolveContainedPath(rootPath, relativePath, fieldPath = 'asset') {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const rootPrefix = `${resolvedRoot}${path.sep}`;

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootPrefix)) {
    failPathValidation(fieldPath, 'resolved path escapes project root');
  }

  return resolvedPath;
}

module.exports = {
  AssetPathValidationError,
  MAX_RELATIVE_PATH_LENGTH,
  resolveContainedPath,
  sanitizeRelativeAssetPath
};
