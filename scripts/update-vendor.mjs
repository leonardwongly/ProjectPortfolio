import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
      const signatures = Array.isArray(fileObject.signatures) ? fileObject.signatures.map((signature, signatureIndex) =>
        ensureString(signature, `${fieldPath}.signatures[${signatureIndex}]`)
      ) : fail(`Invalid manifest at ${fieldPath}.signatures: expected non-empty array`);

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

function writeFileAtomically(filePath, bytes) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tempFilePath = path.join(directory, `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}-${crypto.randomUUID()}`);

  try {
    fs.writeFileSync(tempFilePath, bytes);
    fs.renameSync(tempFilePath, filePath);
  } catch (error) {
    if (fs.existsSync(tempFilePath)) {
      fs.rmSync(tempFilePath, { force: true });
    }
    throw error;
  }
}

function persistVendorRefresh(manifestPath, manifest, fetchedFiles, rootDir = projectRoot) {
  fetchedFiles.forEach((fileEntry) => {
    writeFileAtomically(path.join(rootDir, fileEntry.path), fileEntry.bytes);
  });

  writeFileAtomically(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
}

async function runVendorRefresh(options = {}, dependencies = {}) {
  const manifestPath = dependencies.manifestPath || path.join(projectRoot, 'docs', 'security', 'vendor-dependencies.json');
  const rootDir = dependencies.rootDir || projectRoot;
  const manifest = loadManifest(manifestPath);

  listManifestFiles(manifest);

  const fetchedFiles = await fetchVendorFiles(manifest, {
    fetchImpl: dependencies.fetchImpl || fetch,
    lookupImpl: dependencies.lookupImpl,
    timeoutMs: options.timeoutMs
  });

  const summary = summarizeFetchedFiles(fetchedFiles, rootDir);
  const nextManifest = updateManifestHashes(manifest, fetchedFiles, options.today);

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
  updateManifestHashes
};
