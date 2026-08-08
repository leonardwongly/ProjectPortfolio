import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadManifest } from './check-vendor-governance.mjs';
import {
  compareSemver,
  ensureRegistryPackageName,
  parseSemver
} from './lib/vendor-policy.mjs';
import {
  fetchInjectedHttpsBytes,
  requestPinnedHttpsBytes
} from './lib/network-safety.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 500;
const MAX_TIMEOUT_MS = 60000;
const MAX_ATTEMPTS = 5;
const MAX_REGISTRY_METADATA_BYTES = 2 * 1024 * 1024;
const NPM_REGISTRY_HOSTS = new Set(['registry.npmjs.org']);

function fail(message) {
  throw new Error(message);
}

function ensureString(value, fieldPath) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`Invalid manifest at ${fieldPath}: expected non-empty string`);
  }
  return value.trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--timeout-ms') {
      const nextValue = argv[index + 1];
      if (!nextValue || !/^\d+$/.test(nextValue)) {
        fail('Expected integer value after --timeout-ms');
      }
      options.timeoutMs = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }

    if (arg === '--max-attempts') {
      const nextValue = argv[index + 1];
      if (!nextValue || !/^\d+$/.test(nextValue)) {
        fail('Expected integer value after --max-attempts');
      }
      options.maxAttempts = Number.parseInt(nextValue, 10);
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
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts <= 0) {
    fail('Max attempts must be a positive integer');
  }
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts > MAX_ATTEMPTS) {
    fail(`Max attempts must not exceed ${MAX_ATTEMPTS}`);
  }

  return options;
}

function compareVersions(leftRaw, rightRaw) {
  return compareSemver(leftRaw, rightRaw);
}

function listTrackedRegistryDependencies(manifest) {
  if (!manifest || !Array.isArray(manifest.dependencies)) {
    fail('Invalid manifest: expected dependencies array');
  }

  return manifest.dependencies
    .map((dependency, dependencyIndex) => {
      if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)) {
        fail(`Invalid manifest at manifest.dependencies[${dependencyIndex}]: expected object`);
      }

      const registryPackage = dependency.registry_package == null
        ? null
        : ensureRegistryPackageName(dependency.registry_package, `manifest.dependencies[${dependencyIndex}].registry_package`);

      if (!registryPackage) {
        return null;
      }

      return {
        dependencyIndex,
        name: ensureString(dependency.name, `manifest.dependencies[${dependencyIndex}].name`),
        version: parseSemver(dependency.version, `manifest.dependencies[${dependencyIndex}].version`),
        registryPackage
      };
    })
    .filter(Boolean);
}

function shouldRetryResponse(response) {
  return response.status === 429 || response.status >= 500;
}

function shouldRetryError(error) {
  return error?.retryable === true;
}

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function getBackoffDelayMs(attempt) {
  return DEFAULT_INITIAL_BACKOFF_MS * (2 ** Math.max(0, attempt - 1));
}

async function fetchRegistryVersion(registryPackage, options = {}) {
  const packageName = ensureRegistryPackageName(registryPackage, 'registryPackage');
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_REGISTRY_METADATA_BYTES;
  const sleepImpl = options.sleepImpl ?? sleep;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0 || maxAttempts > MAX_ATTEMPTS) {
    fail(`Max attempts must be an integer between 1 and ${MAX_ATTEMPTS}`);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    fail(`Timeout must be an integer between 1 and ${MAX_TIMEOUT_MS}ms`);
  }
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      let response;
      try {
        const transportOptions = {
          fieldPath: `npm.${packageName}`,
          allowedHosts: NPM_REGISTRY_HOSTS,
          lookupImpl: options.lookupImpl,
          timeoutMs,
          maxBytes,
          headers: {
            accept: 'application/json',
            'user-agent': 'ProjectPortfolio-vendor-upstream/1.0'
          }
        };
        response = options.fetchImpl
          ? await fetchInjectedHttpsBytes(registryUrl, {
              ...transportOptions,
              fetchImpl: options.fetchImpl
            })
          : await (options.requestBytesImpl ?? requestPinnedHttpsBytes)(registryUrl, {
              ...transportOptions,
              requestImpl: options.requestImpl
            });
      } catch (error) {
        if (
          error?.name === 'AbortError' ||
          error?.networkTransportError === true ||
          ['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.code)
        ) {
          const fetchError = new Error(`Failed to fetch ${registryUrl}: ${error.message}`);
          fetchError.name = error.name || 'Error';
          fetchError.code = error.code;
          fetchError.retryable = true;
          throw fetchError;
        }
        throw error;
      }

      const responseOk = response.ok ?? (response.status >= 200 && response.status < 300);
      if (!responseOk) {
        const error = new Error(`Failed to fetch npm metadata for ${packageName}: ${response.status} ${response.statusText}`);
        if (attempt < maxAttempts && shouldRetryResponse(response)) {
          lastError = error;
          await sleepImpl(getBackoffDelayMs(attempt));
          continue;
        }
        throw error;
      }

      let metadata;
      try {
        const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(response.bytes);
        metadata = JSON.parse(jsonText);
      } catch {
        fail(`Invalid npm metadata for ${packageName}: expected valid UTF-8 JSON`);
      }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        fail(`Invalid npm metadata for ${packageName}: expected object`);
      }

      const latestVersion = metadata['dist-tags']?.latest;
      return {
        packageName,
        latestVersion: parseSemver(latestVersion, `npm.${packageName}.dist-tags.latest`),
        registryUrl
      };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetryError(error)) {
        throw error;
      }
      await sleepImpl(getBackoffDelayMs(attempt));
    }
  }

  throw lastError ?? new Error(`Failed to fetch npm metadata for ${packageName}`);
}

async function checkVendorUpstreamVersions(options = {}, dependencies = {}) {
  const manifestPath = dependencies.manifestPath || path.join(projectRoot, 'docs', 'security', 'vendor-dependencies.json');
  const rootDir = dependencies.rootDir || projectRoot;
  const manifest = (dependencies.loadManifest || loadManifest)(manifestPath, { rootDir });
  const trackedDependencies = listTrackedRegistryDependencies(manifest);
  const results = [];

  for (const dependency of trackedDependencies) {
    const upstream = await fetchRegistryVersion(dependency.registryPackage, {
      fetchImpl: dependencies.fetchImpl,
      lookupImpl: dependencies.lookupImpl,
      requestImpl: dependencies.requestImpl,
      requestBytesImpl: dependencies.requestBytesImpl,
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts,
      maxBytes: dependencies.maxBytes ?? MAX_REGISTRY_METADATA_BYTES
    });

    const delta = compareVersions(upstream.latestVersion, dependency.version);
    results.push({
      name: dependency.name,
      registryPackage: dependency.registryPackage,
      currentVersion: dependency.version.raw,
      latestVersion: upstream.latestVersion.raw,
      registryUrl: upstream.registryUrl,
      updateAvailable: delta > 0
    });
  }

  return results;
}

function formatSummary(results) {
  if (results.length === 0) {
    return 'No registry-tracked vendored dependencies are configured.';
  }

  const staleDependencies = results.filter((entry) => entry.updateAvailable);
  if (staleDependencies.length === 0) {
    return `Vendored upstream review OK: ${results.length} tracked dependenc${results.length === 1 ? 'y is' : 'ies are'} on the latest declared npm release.`;
  }

  const lines = [
    `Vendored upstream review required: ${staleDependencies.length} tracked dependenc${staleDependencies.length === 1 ? 'y is' : 'ies are'} behind upstream.`
  ];
  staleDependencies.forEach((entry) => {
    lines.push(`- ${entry.name} (${entry.registryPackage}): pinned ${entry.currentVersion}, latest ${entry.latestVersion}`);
  });
  return lines.join('\n');
}

async function main() {
  const options = parseArgs();
  const results = await checkVendorUpstreamVersions(options);
  const output = formatSummary(results);
  const staleDependencies = results.filter((entry) => entry.updateAvailable);

  if (staleDependencies.length > 0) {
    console.error(output);
    process.exitCode = 1;
    return;
  }

  console.log(output);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export {
  checkVendorUpstreamVersions,
  compareVersions,
  ensureRegistryPackageName,
  fetchRegistryVersion,
  formatSummary,
  listTrackedRegistryDependencies,
  parseArgs,
  parseSemver
};
