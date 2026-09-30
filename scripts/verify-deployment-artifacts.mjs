import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { normalizePublicHttpsUrl, requestPinnedHttpsBytes } from './lib/network-safety.mjs';
import { assertSha } from './resolve-production-deployment.mjs';

const PRODUCTION_ORIGIN = 'https://leonardwong.tech';
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_MARKER_BYTES = 4096;
const MARKER_ROUTE = '/.well-known/deployment.json';
const ARTIFACTS = new Map([
  ['/', 'index.html'], ['/work', 'work.html'],
  ['/case-study-agentforge', 'case-study-agentforge.html'],
  ['/case-study-agentic', 'case-study-agentic.html'],
  ['/case-study-apple-calendar-mcp', 'case-study-apple-calendar-mcp.html'],
  ['/reading', 'reading.html'], ['/offline', 'offline.html'],
  ['/.well-known/service-doc', '.well-known/service-doc.html'],
  ['/js/main.js', 'js/main.js'], ['/js/site.js', 'js/site.js'],
  ['/css/custom.css', 'css/custom.css'], ['/pwabuilder-sw.js', 'pwabuilder-sw.js']
]);

function normalizePreviewOrigin(raw) {
  const parsed = normalizePublicHttpsUrl(raw, { fieldPath: 'immutable deployment preview' });
  if (!/^[0-9a-f]{8}\.projectportfolio\.pages\.dev$/.test(parsed.hostname) ||
      parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Expected an immutable ProjectPortfolio Pages preview origin');
  }
  return parsed.origin;
}

function readTrackedArtifacts({ repositoryRoot, sha, git = execFileSync } = {}) {
  assertSha(sha);
  const root = path.resolve(repositoryRoot);
  const invoke = (args, options = {}) => git('git', ['--no-replace-objects', '-C', root, ...args], {
    maxBuffer: MAX_ARTIFACT_BYTES, timeout: 10000, ...options
  });
  if (invoke(['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== sha) {
    throw new Error('Artifact checkout HEAD does not match the verified deployment SHA');
  }
  const entries = invoke(['ls-tree', '-r', sha, '--', ...ARTIFACTS.values()], { encoding: 'utf8' }).trim().split('\n');
  const regularFiles = new Set(entries.filter((entry) => /^100644 blob [0-9a-f]{40}\t/.test(entry))
    .map((entry) => entry.split('\t')[1]));
  const expected = new Map();
  for (const [route, file] of ARTIFACTS) {
    if (!regularFiles.has(file)) throw new Error(`Published artifact ${file} must be a tracked regular file`);
    const bytes = invoke(['show', `${sha}:${file}`]);
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_ARTIFACT_BYTES) throw new Error(`Published artifact ${file} exceeds its byte limit`);
    expected.set(route, bytes);
  }
  return expected;
}

function boundedInteger(value, label, maximum) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
    throw new Error(`${label} must be a positive integer at most ${maximum}`);
  }
  return Number(value);
}

function validateDeploymentMarker(response, { sha, previewOrigin }) {
  if (response.status !== 200) throw new Error(`Deployment marker must return HTTP 200 without redirects, received ${response.status}`);
  const header = (name) => response.headers?.get?.(name) ?? response.headers?.[name];
  if (typeof header('content-type') !== 'string' || header('content-type').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new Error('Deployment marker must be served as application/json');
  }
  if (typeof header('cache-control') !== 'string' || !header('cache-control').split(',').some((part) => part.trim().toLowerCase() === 'no-store')) {
    throw new Error('Deployment marker must have Cache-Control: no-store');
  }
  if (!Buffer.isBuffer(response.bytes) || response.bytes.length > MAX_MARKER_BYTES) throw new Error('Deployment marker exceeds its byte limit');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(response.bytes);
  const marker = JSON.parse(source);
  const sourceKeys = [...source.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map((match) => match[1]).sort().join(',');
  if (!marker || Array.isArray(marker) || Object.keys(marker).sort().join(',') !== 'branch,previewOrigin,repository,schemaVersion,sha' ||
      sourceKeys !== 'branch,previewOrigin,repository,schemaVersion,sha' ||
      marker.schemaVersion !== 1 || marker.repository !== 'leonardwongly/ProjectPortfolio' ||
      marker.sha !== sha || marker.branch !== 'main' || marker.previewOrigin !== previewOrigin) {
    throw new Error('Deployment marker must bind this repository, exact SHA, main branch, and immutable preview');
  }
  return marker;
}

async function verifyDeploymentArtifacts({ repositoryRoot, sha, previewOrigin,
  requestImpl = requestPinnedHttpsBytes, readArtifacts = readTrackedArtifacts,
  attempts = 2, timeoutMs = 5000, retryDelayMs = 5000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  assertSha(sha);
  const preview = normalizePreviewOrigin(previewOrigin);
  const retries = boundedInteger(attempts, 'Artifact verification attempts', 3);
  const timeout = boundedInteger(timeoutMs, 'Artifact verification timeout', 10000);
  const delay = boundedInteger(retryDelayMs, 'Artifact verification retry delay', 10000);
  const expected = readArtifacts({ repositoryRoot, sha });
  const evidence = [];
  const findings = [];
  for (const origin of [preview, PRODUCTION_ORIGIN]) {
    let lastFindings = [];
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const currentFindings = [];
      const currentEvidence = [];
      const markerUrl = new URL(MARKER_ROUTE, `${origin}/`).toString();
      try {
        const markerResponse = await requestImpl(markerUrl, { fieldPath: 'deployed version marker',
          allowedHosts: [new URL(origin).hostname], timeoutMs: timeout, maxBytes: MAX_MARKER_BYTES,
          headers: { 'user-agent': 'ProjectPortfolio-deployment-verification/1.0', 'cache-control': 'no-cache' } });
        const marker = validateDeploymentMarker(markerResponse, { sha, previewOrigin: preview });
        currentEvidence.push({ origin, route: MARKER_ROUTE, sha: marker.sha, branch: marker.branch, preview_origin: marker.previewOrigin });
      } catch (error) {
        currentFindings.push(`${markerUrl}: ${error?.message || 'deployment marker request failed'}`);
      }
      for (const [route, bytes] of expected) {
        const url = new URL(route, `${origin}/`).toString();
        try {
          const actual = await requestImpl(url, { fieldPath: 'deployed artifact',
            allowedHosts: [new URL(origin).hostname], timeoutMs: timeout, maxBytes: MAX_ARTIFACT_BYTES,
            headers: { 'user-agent': 'ProjectPortfolio-deployment-verification/1.0', 'cache-control': 'no-cache' } });
          if (actual.status !== 200) throw new Error(`Expected HTTP 200 without redirects, received ${actual.status}`);
          if (!Buffer.isBuffer(actual.bytes) || !bytes.equals(actual.bytes)) {
            throw new Error(`Deployed bytes differ from committed artifact at ${sha}; investigate deployment drift or edge injection`);
          }
          currentEvidence.push({ origin, route, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
        } catch (error) {
          currentFindings.push(`${url}: ${error?.message || 'artifact request failed'}`);
        }
      }
      lastFindings = currentFindings;
      if (currentFindings.length === 0) { evidence.push(...currentEvidence); break; }
      if (attempt < retries) await sleep(delay);
    }
    findings.push(...lastFindings);
  }
  return { sha, preview_origin: preview, production_origin: PRODUCTION_ORIGIN,
    artifacts_per_origin: expected.size,
    production_alias_sha: evidence.some((entry) => entry.origin === PRODUCTION_ORIGIN && entry.route === MARKER_ROUTE) ? sha : null,
    identity_note: 'Version identity requires the provider-generated deployment marker and committed artifact correspondence. Missing or stale markers fail closed; provider build configuration is not inferred.',
    evidence, findings };
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = { sha: env.DEPLOYMENT_SHA, previewOrigin: env.PREVIEW_ORIGIN,
    repositoryRoot: env.DEPLOYMENT_ROOT,
    attempts: env.SMOKE_ATTEMPTS ?? 2, timeoutMs: env.SMOKE_TIMEOUT_MS ?? 5000,
    retryDelayMs: env.SMOKE_RETRY_DELAY_MS ?? 5000 };
  const fields = { '--sha': 'sha', '--preview-origin': 'previewOrigin', '--repository-root': 'repositoryRoot' };
  for (let index = 0; index < argv.length; index += 1) {
    const field = fields[argv[index]];
    if (!field || !argv[index + 1]) throw new Error(`Unknown or missing deployment verification argument: ${argv[index]}`);
    options[field] = argv[++index];
  }
  if (!options.repositoryRoot) throw new Error('An exact deployment artifact checkout is required');
  assertSha(options.sha);
  normalizePreviewOrigin(options.previewOrigin);
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyDeploymentArtifacts(parseArgs());
    console.log(JSON.stringify(result, null, 2));
    if (result.findings.length) process.exitCode = 1;
  } catch (error) {
    console.error(error?.message || 'Deployment artifact verification failed');
    process.exitCode = 1;
  }
}

export { ARTIFACTS, MARKER_ROUTE, MAX_ARTIFACT_BYTES, MAX_MARKER_BYTES, PRODUCTION_ORIGIN,
  normalizePreviewOrigin, parseArgs, readTrackedArtifacts, validateDeploymentMarker, verifyDeploymentArtifacts };
