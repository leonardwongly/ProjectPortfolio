import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { normalizePublicHttpsUrl, requestPinnedHttpsBytes } from './lib/network-safety.mjs';
import { decodeHtmlAttributeEntities, scanHtmlAttributes } from './lib/html-attributes.mjs';
import { assertSha } from './resolve-production-deployment.mjs';

const PRODUCTION_ORIGIN = 'https://leonardwong.tech';
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_MARKER_BYTES = 4096;
const MAX_ARTIFACT_FILES = 512;
const MAX_ARTIFACT_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_DEPENDENCY_REFERENCES = 8192;
const MAX_ARTIFACT_CONCURRENCY = 8;
const MAX_VERIFICATION_MS = 240000;
const MAX_SOURCE_READ_MS = 30000;
const MARKER_ROUTE = '/.well-known/deployment.json';
const ARTIFACTS = new Map([
  ['/', 'index.html'], ['/work', 'work.html'],
  ['/case-study-agentforge', 'case-study-agentforge.html'],
  ['/case-study-agentic', 'case-study-agentic.html'],
  ['/case-study-apple-calendar-mcp', 'case-study-apple-calendar-mcp.html'],
  ['/reading', 'reading.html'], ['/offline', 'offline.html'],
  ['/.well-known/service-doc', '.well-known/service-doc.html'],
  ['/js/main.js', 'js/main.js'], ['/js/site.js', 'js/site.js'],
  ['/css/custom.css', 'css/custom.css'], ['/pwabuilder-sw.js', 'pwabuilder-sw.js'],
  // Workbox constructs module URLs at runtime. Its reviewed local publish bundle
  // is explicit rather than evaluating candidate JavaScript to discover imports.
  ['/js/vendor/workbox-sw.js', 'js/vendor/workbox-sw.js'],
  ['/js/vendor/workbox/workbox-core.prod.js', 'js/vendor/workbox/workbox-core.prod.js'],
  ['/js/vendor/workbox/workbox-navigation-preload.prod.js', 'js/vendor/workbox/workbox-navigation-preload.prod.js'],
  ['/js/vendor/workbox/workbox-routing.prod.js', 'js/vendor/workbox/workbox-routing.prod.js'],
  ['/js/vendor/workbox/workbox-strategies.prod.js', 'js/vendor/workbox/workbox-strategies.prod.js']
]);

function normalizePreviewOrigin(raw) {
  const parsed = normalizePublicHttpsUrl(raw, { fieldPath: 'immutable deployment preview' });
  if (!/^[0-9a-f]{8}\.projectportfolio\.pages\.dev$/.test(parsed.hostname) ||
      parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Expected an immutable ProjectPortfolio Pages preview origin');
  }
  return parsed.origin;
}

function dependencyPath(raw, parentFile) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error(`Invalid dependency path in ${parentFile}`);
  const value = raw.trim();
  if (!value || /^(?:data:|mailto:|tel:|#)/i.test(value)) return null;
  if (/^https:/i.test(value)) {
    const absolute = /^https:\/\/[^/?#]+(.*)$/i.exec(value);
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error(`Invalid HTTPS dependency path in ${parentFile}: ${value}`); }
    if (!absolute) throw new Error(`Unsafe local dependency path in ${parentFile}: ${value}`);
    if (parsed.origin !== PRODUCTION_ORIGIN) return null;
    if (parsed.username || parsed.password) throw new Error(`Unsafe local dependency path in ${parentFile}: ${value}`);
    return dependencyPath(absolute[1] || '/', parentFile);
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || /[\u0000-\u0020\u007f\\]/.test(value)) {
    throw new Error(`Unsafe local dependency path in ${parentFile}: ${value}`);
  }
  const pathname = value.split(/[?#]/, 1)[0];
  if (!pathname) return null;
  if (pathname.includes('//')) throw new Error(`Ambiguous local dependency path in ${parentFile}: ${value}`);
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new Error(`Invalid URL encoding in dependency path: ${value}`); }
  // Permit the repository's CSS ../fonts references, but reject root escape,
  // encoded separators/dot segments, and paths that can be decoded twice.
  if (decoded.includes('%') || /[\u0000-\u0020\u007f\\?#]/.test(decoded) ||
      (decoded !== pathname && (decoded.split('/').some((part) => part === '.' || part === '..') || decoded.split('/').length !== pathname.split('/').length))) {
    throw new Error(`Unsafe encoded dependency path in ${parentFile}: ${value}`);
  }
  const parts = decoded.startsWith('/') ? [] : path.posix.dirname(parentFile).split('/').filter((part) => part !== '.');
  for (const segment of decoded.replace(/^\//, '').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) throw new Error(`Dependency path traversal escapes the publish root: ${value}`);
      parts.pop();
    } else {
      if (!/^[a-z\d_.-]+$/i.test(segment)) throw new Error(`Unsupported local dependency path in ${parentFile}: ${value}`);
      parts.push(segment);
    }
  }
  return parts.join('/');
}

function resourceReferences(file, bytes) {
  if (!/\.(?:html|svg|css)$/.test(file) && file !== 'manifest.json' && file !== 'pwabuilder-sw.js') return [];
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/\.(?:html|svg)$/.test(file)) {
    const references = [];
    const { attributes, findings } = scanHtmlAttributes(source, {
      attributeNames: ['href', 'xlink:href', 'src', 'srcset', 'poster', 'data', 'style'],
      maxAttributes: 10000, maxBytes: MAX_ARTIFACT_BYTES,
      onStyleElement: ({ start, end, svg }) => {
        const css = source.slice(start, end);
        references.push(...cssReferences(svg ? decodeHtmlAttributeEntities(css) : css, file));
      }
    });
    if (findings.length) throw new Error(`Cannot inventory malformed ${file}: ${findings.join('; ')}`);
    for (const attribute of attributes) {
      if (attribute.tagName === 'base') throw new Error(`Cannot inventory a document with a base URL: ${file}`);
      const value = decodeHtmlAttributeEntities(attribute.value);
      if (attribute.name === 'style') references.push(...cssReferences(value, file));
      else if (attribute.name === 'srcset') {
        // Read URL tokens before descriptors: commas inside data: URLs belong
        // to that URL and must not hide a subsequent local candidate.
        let cursor = 0;
        while (cursor < value.length) {
          while (/[\s,]/.test(value[cursor] ?? '') && cursor < value.length) cursor += 1;
          const start = cursor;
          while (cursor < value.length && !/\s/.test(value[cursor])) cursor += 1;
          let url = value.slice(start, cursor);
          if (!url) break;
          if (url.endsWith(',')) {
            let end = url.length;
            while (end > 0 && url[end - 1] === ',') end -= 1;
            url = url.slice(0, end);
          }
          else {
            const descriptorStart = cursor;
            while (cursor < value.length && value[cursor] !== ',') cursor += 1;
            const descriptor = value.slice(descriptorStart, cursor).trim();
            if (descriptor && !/^(?:\d+(?:\.\d+)?x|\d+w)$/.test(descriptor)) throw new Error(`Malformed srcset in ${file}`);
          }
          references.push(url);
        }
      } else references.push(value);
    }
    return references;
  }
  if (file.endsWith('.css')) return cssReferences(source, file);
  if (file === 'manifest.json') {
    const manifest = JSON.parse(source);
    if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new Error('Manifest must be a JSON object');
    const references = [manifest.start_url, manifest.scope].filter((value) => value !== undefined);
    for (const field of ['icons', 'screenshots', 'shortcuts']) {
      if (manifest[field] === undefined) continue;
      if (!Array.isArray(manifest[field]) || manifest[field].length > MAX_DEPENDENCY_REFERENCES) throw new Error(`Invalid manifest ${field}`);
      for (const item of manifest[field]) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid manifest ${field} entry`);
        if (field === 'shortcuts') {
          references.push(item.url);
          for (const icon of item.icons ?? []) references.push(icon.src);
        } else references.push(item.src);
      }
    }
    return references;
  }
  const references = [];
  const imports = /\bimportScripts\s*\(/g;
  while (imports.exec(source)) {
    let cursor = imports.lastIndex;
    while (true) {
      cursor = skipWhitespace(source, cursor);
      if (source[cursor] !== '"' && source[cursor] !== "'") {
        throw new Error('Service worker imports must be static literal paths for deployment inventory');
      }
      const end = quotedEnd(source, cursor, 'service worker import');
      const literal = source.slice(cursor + 1, end - 1);
      if (literal.includes('\\')) throw new Error('Service worker imports must be static literal paths for deployment inventory');
      references.push(literal);
      cursor = skipWhitespace(source, end);
      if (source[cursor] === ')') { imports.lastIndex = cursor + 1; break; }
      if (source[cursor] !== ',') throw new Error('Unterminated or malformed service worker import');
      cursor += 1;
    }
  }
  return references;
}

function skipWhitespace(source, cursor) {
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  return cursor;
}

function quotedEnd(source, start, label) {
  const quote = source[start];
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === quote) return cursor + 1;
    cursor += source[cursor] === '\\' ? 2 : 1;
  }
  throw new Error(`Unterminated ${label} string`);
}

function cssReferences(source, file) {
  const commentTokens = /\/\*|["']/g;
  const parts = [];
  let copied = 0;
  let token;
  while ((token = commentTokens.exec(source))) {
    if (token[0] !== '/*') {
      commentTokens.lastIndex = quotedEnd(source, token.index, 'CSS');
      continue;
    }
    const end = source.indexOf('*/', commentTokens.lastIndex);
    if (end === -1) throw new Error(`Unterminated CSS comment in ${file}`);
    parts.push(source.slice(copied, token.index));
    copied = end + 2;
    commentTokens.lastIndex = copied;
  }
  parts.push(source.slice(copied));
  const css = parts.join('');
  const references = [];
  const tokens = /["'\\]|@import\b|\burl\s*\(/gi;
  const importUrl = /url\s*\(/iy;
  while ((token = tokens.exec(css))) {
    if (token[0] === '"' || token[0] === "'") {
      tokens.lastIndex = quotedEnd(css, token.index, 'CSS');
      continue;
    }
    // Content strings may contain escapes. Escaped identifiers could hide a
    // resource token; escaped URL values remain rejected by dependencyPath.
    if (token[0] === '\\') throw new Error(`Escaped CSS syntax is unsupported for deployment inventory: ${file}`);
    let cursor = skipWhitespace(css, tokens.lastIndex);
    if (token[0].toLowerCase() === '@import') {
      if (css[cursor] === '"' || css[cursor] === "'") {
        const end = quotedEnd(css, cursor, 'CSS import');
        references.push(css.slice(cursor + 1, end - 1));
        tokens.lastIndex = end;
        continue;
      }
      importUrl.lastIndex = cursor;
      if (!importUrl.exec(css)) throw new Error(`Unsupported CSS import in ${file}`);
      cursor = skipWhitespace(css, importUrl.lastIndex);
    }
    let value;
    if (css[cursor] === '"' || css[cursor] === "'") {
      const end = quotedEnd(css, cursor, 'CSS URL');
      value = css.slice(cursor + 1, end - 1);
      cursor = skipWhitespace(css, end);
      if (css[cursor] !== ')') throw new Error(`Malformed CSS URL in ${file}`);
    } else {
      const end = css.indexOf(')', cursor);
      if (end === -1) throw new Error(`Malformed CSS URL in ${file}`);
      value = css.slice(cursor, end).trim();
      cursor = end;
    }
    references.push(value);
    tokens.lastIndex = cursor + 1;
  }
  return references;
}

function readTrackedArtifacts({ repositoryRoot, sha, git = execFileSync, now = Date.now,
  deadline = now() + MAX_SOURCE_READ_MS } = {}) {
  assertSha(sha);
  const root = path.resolve(repositoryRoot);
  const invoke = (args, options = {}) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Committed dependency inventory exceeded its time limit');
    return git('git', ['--no-replace-objects', '-C', root, ...args], {
      maxBuffer: MAX_ARTIFACT_BYTES, timeout: Math.min(10000, remaining), ...options
    });
  };
  if (invoke(['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== sha) {
    throw new Error('Artifact checkout HEAD does not match the verified deployment SHA');
  }
  const entries = invoke(['ls-tree', '-r', '-l', '-z', sha], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).split('\0').filter(Boolean);
  if (entries.length > 8192) throw new Error('Committed publish tree exceeds its entry limit');
  const regularFiles = new Map();
  for (const entry of entries) {
    const match = /^100644 blob ([0-9a-f]{40})\s+(\d+)\t(.+)$/.exec(entry);
    if (match) regularFiles.set(match[3], { oid: match[1], size: Number(match[2]) });
  }
  const canonicalRoutes = new Map([...ARTIFACTS].map(([route, file]) => [file, route]));
  // Cloudflare's public HTML routes omit .html. Resolve source-file references
  // to those canonical routes without accepting or following HTTP redirects.
  const pending = [...ARTIFACTS];
  const fileBytes = new Map();
  const expected = new Map();
  let totalBytes = 0;
  let referenceCount = 0;
  for (let index = 0; index < pending.length; index += 1) {
    if (now() >= deadline) throw new Error('Committed dependency inventory exceeded its time limit');
    const [route, file] = pending[index];
    if (expected.has(route)) continue;
    if (expected.size >= MAX_ARTIFACT_FILES) throw new Error(`Critical dependency graph exceeds ${MAX_ARTIFACT_FILES} artifact limit`);
    const entry = regularFiles.get(file);
    if (!entry) throw new Error(`Published artifact ${file} must be a tracked regular file`);
    let bytes = fileBytes.get(file);
    if (!bytes) {
      if (entry.size > MAX_ARTIFACT_BYTES) throw new Error(`Published artifact ${file} exceeds its byte limit`);
      totalBytes += entry.size;
      if (totalBytes > MAX_ARTIFACT_TOTAL_BYTES) throw new Error('Critical dependency graph exceeds its total byte limit');
      bytes = invoke(['cat-file', 'blob', entry.oid]);
      if (!Buffer.isBuffer(bytes) || bytes.length !== entry.size) throw new Error(`Published artifact ${file} has invalid committed bytes`);
      fileBytes.set(file, bytes);
      for (const reference of resourceReferences(file, bytes)) {
        referenceCount += 1;
        if (referenceCount > MAX_DEPENDENCY_REFERENCES) throw new Error('Critical dependency graph exceeds its reference limit');
        let dependency = dependencyPath(reference, file);
        if (dependency === null) continue;
        if (!dependency) dependency = 'index.html';
        else if (!regularFiles.has(dependency) && regularFiles.has(`${dependency}.html`)) dependency += '.html';
        pending.push([canonicalRoutes.get(dependency) ?? `/${dependency}`, dependency]);
      }
    }
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
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const started = now();
  const deadline = started + MAX_VERIFICATION_MS;
  assertSha(sha);
  const preview = normalizePreviewOrigin(previewOrigin);
  const retries = boundedInteger(attempts, 'Artifact verification attempts', 3);
  const timeout = boundedInteger(timeoutMs, 'Artifact verification timeout', 10000);
  const delay = boundedInteger(retryDelayMs, 'Artifact verification retry delay', 10000);
  const expected = readArtifacts({ repositoryRoot, sha, now, deadline: Math.min(deadline, started + MAX_SOURCE_READ_MS) });
  const artifacts = [...expected];
  const request = async (url, options) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Deployment artifact verification exceeded its overall time limit');
    return await requestImpl(url, { ...options, timeoutMs: Math.min(timeout, remaining) });
  };
  const evidence = [];
  const findings = [];
  for (const origin of [preview, PRODUCTION_ORIGIN]) {
    let lastFindings = [];
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const currentFindings = [];
      const currentEvidence = [];
      const markerUrl = new URL(MARKER_ROUTE, `${origin}/`).toString();
      try {
        const markerResponse = await request(markerUrl, { fieldPath: 'deployed version marker',
          allowedHosts: [new URL(origin).hostname], maxBytes: MAX_MARKER_BYTES,
          headers: { 'user-agent': 'ProjectPortfolio-deployment-verification/1.0', 'cache-control': 'no-cache' } });
        const marker = validateDeploymentMarker(markerResponse, { sha, previewOrigin: preview });
        currentEvidence.push({ origin, route: MARKER_ROUTE, sha: marker.sha, branch: marker.branch, preview_origin: marker.previewOrigin });
      } catch (error) {
        currentFindings.push(`${markerUrl}: ${error?.message || 'deployment marker request failed'}`);
      }
      let cursor = 0;
      const responses = new Array(artifacts.length);
      const worker = async () => {
        while (cursor < artifacts.length) {
          const index = cursor++;
          const [route, bytes] = artifacts[index];
          const url = new URL(route, `${origin}/`).toString();
          try {
            const actual = await request(url, { fieldPath: 'deployed artifact',
              allowedHosts: [new URL(origin).hostname], maxBytes: Math.max(1, bytes.length),
              headers: { 'user-agent': 'ProjectPortfolio-deployment-verification/1.0', 'cache-control': 'no-cache' } });
            if (actual.status !== 200) throw new Error(`Expected HTTP 200 without redirects, received ${actual.status}`);
            if (!Buffer.isBuffer(actual.bytes) || !bytes.equals(actual.bytes)) {
              throw new Error(`Deployed bytes differ from committed artifact at ${sha}; investigate deployment drift or edge injection`);
            }
            responses[index] = { evidence: { origin, route, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length } };
          } catch (error) {
            responses[index] = { finding: `${url}: ${error?.message || 'artifact request failed'}` };
          }
        }
      };
      // Artifact correspondence cannot establish version identity without this
      // origin's marker. Separate workflow smoke checks retain health evidence.
      if (currentFindings.length === 0) {
        await Promise.all(Array.from({ length: Math.min(MAX_ARTIFACT_CONCURRENCY, artifacts.length) }, worker));
        for (const response of responses) {
          if (response.finding) currentFindings.push(response.finding);
          else currentEvidence.push(response.evidence);
        }
      }
      lastFindings = currentFindings;
      if (currentFindings.length === 0) { evidence.push(...currentEvidence); break; }
      if (now() >= deadline) break;
      if (attempt < retries) await sleep(Math.min(delay, deadline - now()));
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

export { ARTIFACTS, MARKER_ROUTE, MAX_ARTIFACT_BYTES, MAX_MARKER_BYTES, MAX_ARTIFACT_FILES,
  MAX_ARTIFACT_TOTAL_BYTES, MAX_DEPENDENCY_REFERENCES, MAX_ARTIFACT_CONCURRENCY, MAX_VERIFICATION_MS, PRODUCTION_ORIGIN,
  normalizePreviewOrigin, parseArgs, readTrackedArtifacts, validateDeploymentMarker, verifyDeploymentArtifacts };
