import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ensureRegistryPackageName,
  ensureVendorHttpsUrl,
  ensureVendorSourceMatchesVersion,
  ensureVendorUpstreamMatchesSource,
  parseSemver
} from './lib/vendor-policy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const vendorRoot = path.join(projectRoot, 'js', 'vendor');
const manifestPath = path.join(projectRoot, 'docs', 'security', 'vendor-dependencies.json');
const MAX_VENDOR_MANIFEST_BYTES = 256 * 1024;
const MAX_VENDOR_FILE_BYTES = 5 * 1024 * 1024;
// Bootstrap 5.3.8 dist/css/bootstrap.min.css with its sourceMappingURL footer removed.
// Keep this separate from the Workbox manifest: update-vendor.mjs only manages js/vendor/.
const PINNED_BOOTSTRAP_CSS = Object.freeze({
  path: 'css/bootstrap.min.css',
  version: '5.3.8',
  source: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css',
  license: 'MIT',
  last_reviewed: '2026-09-27',
  review_cadence: 'monthly',
  max_review_age_days: 45,
  sha256: '8f8173cb2d8f867274aeb0cb15328e60f490c7f272351e51a55f1dabb486e4ff'
});
const require = createRequire(import.meta.url);
const { readStableFileNoFollow } = require('./lib/safe-input.cjs');

function fail(message) {
  throw new Error(message);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function ensurePositiveInteger(value, fieldPath) {
  if (!Number.isInteger(value) || value <= 0) {
    fail(`Invalid manifest at ${fieldPath}: expected positive integer`);
  }
  return value;
}

function ensureArray(value, fieldPath) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`Invalid manifest at ${fieldPath}: expected non-empty array`);
  }
  return value;
}

function ensureAllowedKeys(value, fieldPath, allowedKeys) {
  const extras = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (extras.length > 0) {
    fail(`Invalid manifest at ${fieldPath}: unexpected key(s): ${extras.join(', ')}`);
  }
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
  const value = ensureString(rawUrl, fieldPath);
  try {
    return ensureVendorHttpsUrl(value, fieldPath);
  } catch (error) {
    fail(error?.message?.startsWith('Invalid ')
      ? error.message.replace(/^Invalid /, 'Invalid manifest at ')
      : `Invalid manifest at ${fieldPath}: malformed URL`);
  }
}

function parseIsoDate(rawDate, fieldPath) {
  const value = ensureString(rawDate, fieldPath);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`Invalid manifest at ${fieldPath}: expected YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`Invalid manifest at ${fieldPath}: invalid calendar date`);
  }
  return value;
}

function daysBetweenIsoDates(startDate, endDate) {
  const startMs = Date.parse(`${parseIsoDate(startDate, 'date.start')}T00:00:00.000Z`);
  const endMs = Date.parse(`${parseIsoDate(endDate, 'date.end')}T00:00:00.000Z`);
  return Math.floor((endMs - startMs) / 86400000);
}

function getTodayIsoDate() {
  return (process.env.VENDOR_GOVERNANCE_TODAY || new Date().toISOString().slice(0, 10)).trim();
}

function readRegularFileNoFollow(filePath, fieldPath = filePath, options = {}) {
  return readStableFileNoFollow(filePath, {
    label: `Vendored file ${fieldPath}`,
    rootDir: options.rootDir ?? path.dirname(path.resolve(filePath)),
    maxBytes: options.maxBytes ?? MAX_VENDOR_FILE_BYTES,
    minBytes: options.minBytes ?? 1,
    afterRead: options.afterRead
  });
}

function sha256File(filePath, options = {}) {
  return crypto.createHash('sha256').update(readRegularFileNoFollow(filePath, filePath, options)).digest('hex');
}

function validatePinnedBootstrapCss(rootDir = projectRoot, { today = getTodayIsoDate() } = {}) {
  const reviewAgeDays = daysBetweenIsoDates(PINNED_BOOTSTRAP_CSS.last_reviewed, today);
  if (reviewAgeDays < 0 || reviewAgeDays > PINNED_BOOTSTRAP_CSS.max_review_age_days) {
    fail(`Pinned Bootstrap CSS review age ${reviewAgeDays} day(s) is outside the allowed 0-${PINNED_BOOTSTRAP_CSS.max_review_age_days} days for ${PINNED_BOOTSTRAP_CSS.review_cadence} review`);
  }
  const absolutePath = path.join(path.resolve(rootDir), PINNED_BOOTSTRAP_CSS.path);
  const bytes = readRegularFileNoFollow(absolutePath, PINNED_BOOTSTRAP_CSS.path, { rootDir, maxBytes: MAX_VENDOR_FILE_BYTES });
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('Pinned Bootstrap CSS must contain valid UTF-8');
  }
  if (!content.includes(` * Bootstrap  v${PINNED_BOOTSTRAP_CSS.version} (https://getbootstrap.com/)`)) {
    fail(`Pinned Bootstrap CSS version must be ${PINNED_BOOTSTRAP_CSS.version}`);
  }
  if (!content.includes(` * Licensed under ${PINNED_BOOTSTRAP_CSS.license} (https://github.com/twbs/bootstrap/blob/main/LICENSE)`)) {
    fail(`Pinned Bootstrap CSS must preserve its ${PINNED_BOOTSTRAP_CSS.license} license notice`);
  }
  const actualSha = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actualSha !== PINNED_BOOTSTRAP_CSS.sha256) {
    fail(`Pinned CSS hash mismatch for ${PINNED_BOOTSTRAP_CSS.path}: expected ${PINNED_BOOTSTRAP_CSS.sha256}, found ${actualSha}`);
  }
  return PINNED_BOOTSTRAP_CSS.path;
}

function collectVendoredFiles(rootDir = vendorRoot, baseDir = projectRoot) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const rootStats = fs.lstatSync(rootDir);
  const rootLabel = path.relative(baseDir, rootDir).split(path.sep).join('/') || '.';
  if (rootStats.isSymbolicLink()) {
    fail(`Unsafe vendored filesystem node: symlink not allowed at ${rootLabel}`);
  }
  if (!rootStats.isDirectory()) {
    fail(`Unsafe vendored filesystem node: expected directory at ${rootLabel}`);
  }

  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    const entries = fs.readdirSync(currentDir);

    entries.forEach((entryName) => {
      const absolutePath = path.join(currentDir, entryName);
      const relativePath = path.relative(baseDir, absolutePath).split(path.sep).join('/');
      const stats = fs.lstatSync(absolutePath);
      if (stats.isSymbolicLink()) {
        fail(`Unsafe vendored filesystem node: symlink not allowed at ${relativePath}`);
      }
      if (stats.isDirectory()) {
        queue.push(absolutePath);
        return;
      }
      if (stats.isFile()) {
        files.push(relativePath);
        return;
      }
      fail(`Unsafe vendored filesystem node: special node not allowed at ${relativePath}`);
    });
  }

  return files.sort();
}

function loadManifest(filePath = manifestPath, options = {}) {
  const resolvedFile = path.resolve(filePath);
  const defaultRoot = resolvedFile === path.resolve(manifestPath)
    ? projectRoot
    : path.dirname(resolvedFile);
  const text = readStableFileNoFollow(resolvedFile, {
    label: 'Vendor dependency manifest',
    rootDir: options.rootDir ?? defaultRoot,
    maxBytes: options.maxBytes ?? MAX_VENDOR_MANIFEST_BYTES,
    minBytes: 2,
    fatalUtf8: true,
    afterRead: options.afterRead
  });
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`Invalid vendor dependency manifest JSON: ${error.message}`);
  }
}

function validateVendorGovernance(manifest, options = {}) {
  const {
    rootDir = projectRoot,
    today = getTodayIsoDate()
  } = options;

  const resolvedRoot = path.resolve(rootDir);
  const resolvedVendorRoot = path.join(resolvedRoot, 'js', 'vendor');
  const manifestObject = ensureObject(manifest, 'manifest');
  ensureAllowedKeys(manifestObject, 'manifest', ['last_reviewed', 'review_cadence', 'max_review_age_days', 'dependencies']);

  const lastReviewed = parseIsoDate(manifestObject.last_reviewed, 'manifest.last_reviewed');
  const reviewCadence = ensureString(manifestObject.review_cadence, 'manifest.review_cadence');
  const maxReviewAgeDays = ensurePositiveInteger(manifestObject.max_review_age_days, 'manifest.max_review_age_days');
  const dependencyList = ensureArray(manifestObject.dependencies, 'manifest.dependencies');
  const initialActualFiles = collectVendoredFiles(resolvedVendorRoot, resolvedRoot);

  const reviewAgeDays = daysBetweenIsoDates(lastReviewed, today);
  if (reviewAgeDays < 0) {
    fail(`Vendor manifest last_reviewed ${lastReviewed} is in the future relative to ${today}`);
  }
  if (reviewAgeDays > maxReviewAgeDays) {
    fail(
      `Vendor manifest review age is ${reviewAgeDays} day(s), exceeding ${maxReviewAgeDays} day(s) for cadence "${reviewCadence}"`
    );
  }

  const declaredFiles = [];
  const validatedFiles = [];

  dependencyList.forEach((dependency, dependencyIndex) => {
    const fieldPath = `manifest.dependencies[${dependencyIndex}]`;
    const dependencyObject = ensureObject(dependency, fieldPath);
    ensureAllowedKeys(dependencyObject, fieldPath, ['name', 'registry_package', 'source', 'version', 'files']);
    ensureString(dependencyObject.name, `${fieldPath}.name`);
    ensureRegistryPackageName(dependencyObject.registry_package, `${fieldPath}.registry_package`);
    const version = parseSemver(dependencyObject.version, `${fieldPath}.version`);
    const sourceFieldPath = `${fieldPath}.source`;
    const sourceUrl = ensureVendorSourceMatchesVersion(
      ensureHttpsUrl(dependencyObject.source, sourceFieldPath),
      version.raw,
      sourceFieldPath
    );

    ensureArray(dependencyObject.files, `${fieldPath}.files`).forEach((fileEntry, fileIndex) => {
      const filePath = `${fieldPath}.files[${fileIndex}]`;
      const fileObject = ensureObject(fileEntry, filePath);
      ensureAllowedKeys(fileObject, filePath, ['path', 'upstream_url', 'sha256', 'signatures']);

      const relativeFilePath = ensureVendorPath(fileObject.path, `${filePath}.path`);
      ensureVendorUpstreamMatchesSource(
        ensureHttpsUrl(fileObject.upstream_url, `${filePath}.upstream_url`),
        sourceUrl,
        `${filePath}.upstream_url`
      );
      const expectedSha = ensureString(fileObject.sha256, `${filePath}.sha256`).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(expectedSha)) {
        fail(`Invalid manifest at ${filePath}.sha256: expected 64 hex chars`);
      }

      const signatures = ensureArray(fileObject.signatures, `${filePath}.signatures`).map((signature, signatureIndex) =>
        ensureString(signature, `${filePath}.signatures[${signatureIndex}]`)
      );
      if (new Set(signatures).size !== signatures.length) {
        fail(`Invalid manifest at ${filePath}.signatures: duplicate signatures are not allowed`);
      }

      if (declaredFiles.includes(relativeFilePath)) {
        fail(`Duplicate vendored file declaration: ${relativeFilePath}`);
      }
      declaredFiles.push(relativeFilePath);

      const absoluteFilePath = path.join(resolvedRoot, relativeFilePath);
      if (!fs.existsSync(absoluteFilePath)) {
        fail(`Vendored file missing from repository: ${relativeFilePath}`);
      }
      const fileBytes = readRegularFileNoFollow(absoluteFilePath, relativeFilePath, {
        rootDir: resolvedRoot,
        maxBytes: MAX_VENDOR_FILE_BYTES
      });
      const actualSha = crypto.createHash('sha256').update(fileBytes).digest('hex');
      if (actualSha !== expectedSha) {
        fail(`Vendored file hash mismatch for ${relativeFilePath}: expected ${expectedSha}, found ${actualSha}`);
      }

      const fileContent = fileBytes.toString('utf8');
      signatures.forEach((signature) => {
        if (!new RegExp(escapeRegex(signature)).test(fileContent)) {
          fail(`Missing signature "${signature}" in ${relativeFilePath}`);
        }
      });
      validatedFiles.push({
        path: relativeFilePath,
        expectedSha
      });
    });
  });

  const actualFiles = collectVendoredFiles(resolvedVendorRoot, resolvedRoot);
  if (
    initialActualFiles.length !== actualFiles.length ||
    initialActualFiles.some((filePath, index) => actualFiles[index] !== filePath)
  ) {
    fail('Vendored file inventory changed during validation');
  }

  const unexpectedFiles = actualFiles.filter((filePath) => !declaredFiles.includes(filePath));
  if (unexpectedFiles.length > 0) {
    fail(`Unexpected vendored file(s) present: ${unexpectedFiles.join(', ')}`);
  }

  const missingFromVendorRoot = declaredFiles.filter((filePath) => !actualFiles.includes(filePath));
  if (missingFromVendorRoot.length > 0) {
    fail(`Manifest declares file(s) missing from js/vendor/: ${missingFromVendorRoot.join(', ')}`);
  }

  validatedFiles.forEach((fileEntry) => {
    const finalBytes = readRegularFileNoFollow(
      path.join(resolvedRoot, fileEntry.path),
      fileEntry.path,
      {
        rootDir: resolvedRoot,
        maxBytes: MAX_VENDOR_FILE_BYTES
      }
    );
    const finalSha = crypto.createHash('sha256').update(finalBytes).digest('hex');
    if (finalSha !== fileEntry.expectedSha) {
      fail(`Vendored file changed during validation: ${fileEntry.path}`);
    }
  });

  return {
    checkedAt: today,
    declaredFiles,
    actualFiles,
    reviewAgeDays
  };
}

async function main() {
  const result = validateVendorGovernance(loadManifest());
  const pinnedCssPath = validatePinnedBootstrapCss();
  console.log(
    `Vendor governance OK: ${result.declaredFiles.length} Workbox file(s) and ${pinnedCssPath} validated; review age ${result.reviewAgeDays} day(s).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export {
  collectVendoredFiles,
  daysBetweenIsoDates,
  getTodayIsoDate,
  loadManifest,
  MAX_VENDOR_FILE_BYTES,
  MAX_VENDOR_MANIFEST_BYTES,
  PINNED_BOOTSTRAP_CSS,
  readRegularFileNoFollow,
  sha256File,
  validatePinnedBootstrapCss,
  validateVendorGovernance
};
