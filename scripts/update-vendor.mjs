import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadManifest, validateVendorGovernance } from './check-vendor-governance.mjs';
import {
  assertPublicVendorUrl,
  ensureVendorHttpsUrl,
  ensureVendorUpstreamMatchesSource
} from './lib/vendor-policy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_TIMEOUT_MS = 15000;
const require = createRequire(import.meta.url);
const { assertSafeOutputPath, writeFileNoFollow } = require('./lib/safe-output.cjs');

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
  if (!normalized.startsWith('js/vendor/')) {
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

  return options;
}

function listManifestFiles(manifest) {
  return manifest.dependencies.flatMap((dependency, dependencyIndex) => {
    const dependencyObject = ensureObject(dependency, `manifest.dependencies[${dependencyIndex}]`);
    const sourceUrl = ensureHttpsUrl(dependencyObject.source, `manifest.dependencies[${dependencyIndex}].source`);
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

async function fetchWithTimeout(url, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'accept': 'application/javascript, text/javascript, text/plain;q=0.9, */*;q=0.1'
      }
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      fail(`Timed out fetching ${url} after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchVendorFiles(manifest, options = {}) {
  const files = listManifestFiles(manifest);
  const results = [];

  for (const fileEntry of files) {
    const safeUrl = await assertPublicVendorUrl(fileEntry.upstreamUrl, `manifest.dependencies[${fileEntry.dependencyIndex}].files[${fileEntry.fileIndex}].upstream_url`, {
      lookupImpl: options.lookupImpl
    });
    const response = await fetchWithTimeout(safeUrl, options);
    if (!response.ok) {
      fail(`Failed to fetch ${fileEntry.upstreamUrl}: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
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

function summarizeFetchedFiles(fetchedFiles, rootDir = projectRoot) {
  return fetchedFiles.map((fileEntry) => {
    const absolutePath = path.join(rootDir, fileEntry.path);
    const currentSha = fs.existsSync(absolutePath)
      ? crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex')
      : null;

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
  const vendorDir = path.join(rootDir, 'js', 'vendor');
  if (!fs.existsSync(vendorDir)) return;

  const queue = [vendorDir];
  while (queue.length > 0) {
    const current = queue.pop();
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink()) {
      fail(`Unsafe vendor tree: symlink not allowed at ${path.relative(rootDir, current)}`);
    }
    if (stats.isDirectory()) {
      fs.readdirSync(current).forEach((entry) => queue.push(path.join(current, entry)));
    }
  }
}

function persistVendorRefresh(manifestPath, manifest, fetchedFiles, rootDir = projectRoot) {
  const updates = [
    ...fetchedFiles.map((fileEntry) => ({ path: path.join(rootDir, fileEntry.path), bytes: fileEntry.bytes, label: fileEntry.path })),
    { path: manifestPath, bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'), label: 'vendor manifest' }
  ];
  const backups = updates.map((update) => ({
    ...update,
    existed: fs.existsSync(update.path),
    bytesBefore: fs.existsSync(update.path) ? fs.readFileSync(update.path) : null
  }));

  try {
    updates.forEach((update) => writeFileAtomically(rootDir, update.path, update.bytes, update.label));
  } catch (error) {
    backups.reverse().forEach((backup) => {
      if (backup.existed) writeFileAtomically(rootDir, backup.path, backup.bytesBefore, `${backup.label} rollback`);
      else if (fs.existsSync(backup.path)) fs.unlinkSync(backup.path);
    });
    throw error;
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
  const manifest = loadManifest(manifestPath);

  listManifestFiles(manifest);
  assertVendorTreeHasNoSymlinks(rootDir);

  const fetchedFiles = await fetchVendorFiles(manifest, {
    fetchImpl: dependencies.fetchImpl || fetch,
    lookupImpl: dependencies.lookupImpl,
    timeoutMs: options.timeoutMs
  });

  const summary = summarizeFetchedFiles(fetchedFiles, rootDir);
  const nextManifest = stageAndValidateRefresh(manifest, fetchedFiles, rootDir, options.today);

  if (options.write) {
    persistVendorRefresh(manifestPath, nextManifest, fetchedFiles, rootDir);
    validateVendorGovernance(loadManifest(manifestPath), { rootDir, today: options.today });
  }

  return {
    write: options.write,
    summary,
    manifest: nextManifest
  };
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
  runVendorRefresh,
  summarizeFetchedFiles,
  updateManifestHashes,
  assertVendorTreeHasNoSymlinks
};
