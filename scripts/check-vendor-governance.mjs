import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ensureVendorHttpsUrl, ensureVendorUpstreamMatchesSource } from './lib/vendor-policy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const vendorRoot = path.join(projectRoot, 'js', 'vendor');
const manifestPath = path.join(projectRoot, 'docs', 'security', 'vendor-dependencies.json');

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
  if (path.isAbsolute(relativePath)) {
    fail(`Invalid manifest at ${fieldPath}: expected relative path`);
  }

  const normalized = path.posix.normalize(relativePath);
  if (normalized !== relativePath) {
    fail(`Invalid manifest at ${fieldPath}: path must already be normalized`);
  }
  if (!normalized.startsWith('js/vendor/')) {
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

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectVendoredFiles(rootDir = vendorRoot, baseDir = projectRoot) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    entries.forEach((entry) => {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        return;
      }
      if (entry.isFile()) {
        files.push(path.relative(baseDir, absolutePath).split(path.sep).join('/'));
      }
    });
  }

  return files.sort();
}

function loadManifest(filePath = manifestPath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

  dependencyList.forEach((dependency, dependencyIndex) => {
    const fieldPath = `manifest.dependencies[${dependencyIndex}]`;
    const dependencyObject = ensureObject(dependency, fieldPath);
    ensureAllowedKeys(dependencyObject, fieldPath, ['name', 'registry_package', 'source', 'version', 'files']);
    ensureString(dependencyObject.name, `${fieldPath}.name`);
    ensureString(dependencyObject.registry_package, `${fieldPath}.registry_package`);
    const sourceUrl = ensureHttpsUrl(dependencyObject.source, `${fieldPath}.source`);
    ensureString(dependencyObject.version, `${fieldPath}.version`);

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

      if (declaredFiles.includes(relativeFilePath)) {
        fail(`Duplicate vendored file declaration: ${relativeFilePath}`);
      }
      declaredFiles.push(relativeFilePath);

      const absoluteFilePath = path.join(resolvedRoot, relativeFilePath);
      if (!fs.existsSync(absoluteFilePath)) {
        fail(`Vendored file missing from repository: ${relativeFilePath}`);
      }

      const actualSha = sha256File(absoluteFilePath);
      if (actualSha !== expectedSha) {
        fail(`Vendored file hash mismatch for ${relativeFilePath}: expected ${expectedSha}, found ${actualSha}`);
      }

      const fileContent = fs.readFileSync(absoluteFilePath, 'utf8');
      signatures.forEach((signature) => {
        if (!new RegExp(escapeRegex(signature)).test(fileContent)) {
          fail(`Missing signature "${signature}" in ${relativeFilePath}`);
        }
      });
    });
  });

  const actualFiles = collectVendoredFiles(resolvedVendorRoot, resolvedRoot);
  const unexpectedFiles = actualFiles.filter((filePath) => !declaredFiles.includes(filePath));
  if (unexpectedFiles.length > 0) {
    fail(`Unexpected vendored file(s) present: ${unexpectedFiles.join(', ')}`);
  }

  const missingFromVendorRoot = declaredFiles.filter((filePath) => !actualFiles.includes(filePath));
  if (missingFromVendorRoot.length > 0) {
    fail(`Manifest declares file(s) missing from js/vendor/: ${missingFromVendorRoot.join(', ')}`);
  }

  return {
    checkedAt: today,
    declaredFiles,
    actualFiles,
    reviewAgeDays
  };
}

async function main() {
  const result = validateVendorGovernance(loadManifest());
  console.log(
    `Vendor governance OK: ${result.declaredFiles.length} file(s) validated; review age ${result.reviewAgeDays} day(s).`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
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
  sha256File,
  validateVendorGovernance
};
