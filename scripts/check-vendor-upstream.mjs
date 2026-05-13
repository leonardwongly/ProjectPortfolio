import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadManifest } from './check-vendor-governance.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 500;

function fail(message) {
  throw new Error(message);
}

function ensureString(value, fieldPath) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`Invalid manifest at ${fieldPath}: expected non-empty string`);
  }
  return value.trim();
}

function ensureRegistryPackageName(rawName, fieldPath) {
  const value = ensureString(rawName, fieldPath);
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)) {
    fail(`Invalid manifest at ${fieldPath}: unsupported npm package name`);
  }
  return value;
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
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts <= 0) {
    fail('Max attempts must be a positive integer');
  }

  return options;
}

function parseSemver(rawVersion, fieldPath = 'version') {
  const value = ensureString(rawVersion, fieldPath);
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    fail(`Invalid manifest at ${fieldPath}: expected semver x.y.z or x.y.z-prerelease`);
  }

  return {
    raw: value,
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ? match[4].split('.') : []
  };
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);

  if (leftNumeric && rightNumeric) {
    return Number.parseInt(left, 10) - Number.parseInt(right, 10);
  }
  if (leftNumeric) {
    return -1;
  }
  if (rightNumeric) {
    return 1;
  }
  return left.localeCompare(right);
}

function compareVersions(leftRaw, rightRaw) {
  const left = typeof leftRaw === 'string' ? parseSemver(leftRaw, 'version.left') : leftRaw;
  const right = typeof rightRaw === 'string' ? parseSemver(rightRaw, 'version.right') : rightRaw;

  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0;
  }
  if (left.prerelease.length === 0) {
    return 1;
  }
  if (right.prerelease.length === 0) {
    return -1;
  }

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];

    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }

    const delta = compareIdentifier(leftIdentifier, rightIdentifier);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
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

async function fetchWithTimeout(url, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'accept': 'application/json'
      }
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Timed out fetching ${url} after ${timeoutMs}ms`);
      timeoutError.retryable = true;
      throw timeoutError;
    }
    const fetchError = new Error(`Failed to fetch ${url}: ${error?.message || 'unknown network error'}`);
    fetchError.retryable = true;
    throw fetchError;
  } finally {
    clearTimeout(timer);
  }
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
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(registryUrl, options);
      if (!response.ok) {
        const error = new Error(`Failed to fetch npm metadata for ${packageName}: ${response.status} ${response.statusText}`);
        if (attempt < maxAttempts && shouldRetryResponse(response)) {
          lastError = error;
          await sleep(getBackoffDelayMs(attempt));
          continue;
        }
        throw error;
      }

      const metadata = await response.json();
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
      await sleep(getBackoffDelayMs(attempt));
    }
  }

  throw lastError ?? new Error(`Failed to fetch npm metadata for ${packageName}`);
}

async function checkVendorUpstreamVersions(options = {}, dependencies = {}) {
  const manifestPath = dependencies.manifestPath || path.join(projectRoot, 'docs', 'security', 'vendor-dependencies.json');
  const manifest = (dependencies.loadManifest || loadManifest)(manifestPath);
  const trackedDependencies = listTrackedRegistryDependencies(manifest);
  const results = [];

  for (const dependency of trackedDependencies) {
    const upstream = await fetchRegistryVersion(dependency.registryPackage, {
      fetchImpl: dependencies.fetchImpl || fetch,
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts
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
