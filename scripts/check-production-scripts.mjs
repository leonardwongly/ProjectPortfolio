import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import safeInput from './lib/safe-input.cjs';
import { HTML_NAMESPACE, SVG_NAMESPACE, parseHtmlDocument } from './lib/html-document.mjs';
import { assertPublicHttpsUrl } from './lib/network-safety.mjs';
import {
  normalizeSmokeOptions,
  parseArgs,
  requestProductionPage
} from './check-production-smoke.mjs';

const { readStableFileNoFollow } = safeInput;
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_HTML_BYTES = 1024 * 1024;
const APPROVED_SCRIPTS = ['/js/main.js', '/js/site.js'];
const PAGE_FILES = new Map([
  ['/', 'index.html'],
  ['/work', 'work.html'],
  ['/case-study-agentforge', 'case-study-agentforge.html'],
  ['/case-study-agentic', 'case-study-agentic.html'],
  ['/case-study-apple-calendar-mcp', 'case-study-apple-calendar-mcp.html'],
  ['/reading', 'reading.html'],
  ['/offline', 'offline.html'],
  ['/.well-known/service-doc', '.well-known/service-doc.html']
]);

function extractScripts(html) {
  const { elements, scripts } = parseHtmlDocument(html, { maxBytes: MAX_HTML_BYTES });
  const passiveSvgTags = new Set(['svg', 'symbol', 'g', 'path', 'rect', 'circle', 'use']);
  for (const { tagName: name, namespace, attributes } of elements) {
    if (name === 'template' ||
        (namespace !== HTML_NAMESPACE && namespace !== SVG_NAMESPACE) ||
        (namespace === SVG_NAMESPACE && !passiveSvgTags.has(name))) {
      throw new Error('HTML foreign execution or ambiguous parsing context is not approved');
    }
    if (name === 'base') throw new Error('HTML base tags are not approved');
    if (name === 'iframe' || name === 'object' || name === 'embed') {
      throw new Error('HTML executable embedding is not approved');
    }
    for (const [attribute, rawValue] of attributes) {
      if (attribute.startsWith('on') || attribute === 'srcdoc') {
        throw new Error('HTML inline execution attributes are not approved');
      }
      if (namespace === SVG_NAMESPACE && ['href', 'xlink:href'].includes(attribute) && !rawValue.startsWith('#')) {
        throw new Error('SVG external resource references are not approved');
      }
      if (['href', 'src', 'xlink:href', 'action', 'formaction'].includes(attribute)) {
        const value = rawValue.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase();
        if (/^(?:javascript|vbscript|data):/.test(value)) {
          throw new Error('HTML executable URL schemes are not approved');
        }
      }
      if (name === 'meta' && attribute === 'http-equiv' && rawValue.toLowerCase() === 'refresh') {
        throw new Error('HTML refresh redirects are not approved');
      }
    }
  }
  return scripts;
}

function scriptIdentity(script, pageUrl, origin) {
  const { attributes, body } = script;
  const source = attributes.get('src');
  if (source !== undefined) {
    let resolved;
    try {
      resolved = new URL(source, pageUrl);
    } catch {
      throw new Error(`Invalid script source ${JSON.stringify(source)}`);
    }
    if (resolved.username || resolved.password || /[\u0000-\u0020\u007f\\]/.test(source) ||
        resolved.origin !== origin || resolved.search || resolved.hash ||
        !APPROVED_SCRIPTS.includes(resolved.pathname)) {
      throw new Error(`Unapproved external script ${JSON.stringify(source)}`);
    }
    if ([...attributes.keys()].some((name) => !['src', 'defer'].includes(name)) ||
        !attributes.has('defer') || attributes.get('defer') !== '' || body.trim()) {
      throw new Error(`External script ${JSON.stringify(source)} has unapproved attributes or inline content`);
    }
    return `src:${resolved.pathname}`;
  }
  if (attributes.size !== 1 || attributes.get('type') !== 'application/ld+json') {
    throw new Error('Unapproved inline script');
  }
  return `jsonld:${crypto.createHash('sha256').update(body).digest('hex')}`;
}

function validateScripts({ html, expectedHtml, pageUrl, origin }) {
  const expected = extractScripts(expectedHtml).map((script) => scriptIdentity(script, pageUrl, origin));
  const required = APPROVED_SCRIPTS.map((source) => `src:${source}`);
  const allowedExpected = new URL(pageUrl).pathname === '/'
    ? [...required, expected[2]]
    : ['/offline', '/.well-known/service-doc'].includes(new URL(pageUrl).pathname) ? [] : required;
  if (expected.length !== allowedExpected.length ||
      expected.some((identity, index) => identity !== allowedExpected[index]) ||
      (allowedExpected.length === 3 && !expected[2]?.startsWith('jsonld:'))) {
    throw new Error('Committed HTML does not match the approved script inventory');
  }
  const actual = extractScripts(html).map((script) => scriptIdentity(script, pageUrl, origin));
  if (expected.join('\n') !== actual.join('\n')) {
    return [`${pageUrl}: script inventory differs from committed HTML (expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)})`];
  }
  return [];
}

async function runProductionScriptCheck(inputOptions = parseArgs()) {
  const options = normalizeSmokeOptions(inputOptions);
  const rootDir = inputOptions.rootDir ?? ROOT_DIR;
  const useInjectedFetch = Object.hasOwn(inputOptions, 'fetchImpl');
  const sleepImpl = inputOptions.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (typeof sleepImpl !== 'function') throw new Error('Production script sleep implementation must be a function');
  if (useInjectedFetch && (typeof options.fetchImpl !== 'function' || typeof options.lookupImpl !== 'function')) {
    throw new Error('Injected script transport requires explicit fetch and DNS implementations');
  }
  // Resolve and bound local inputs before any network request.
  const readLocal = (filename) => readStableFileNoFollow(path.resolve(rootDir, filename), {
    rootDir: path.resolve(rootDir), label: filename, maxBytes: MAX_HTML_BYTES, minBytes: 0
  });
  const approvedPages = new Map([...PAGE_FILES].map(([pagePath, filename]) => [pagePath, readLocal(filename).toString('utf8')]));
  const approvedBytes = new Map(APPROVED_SCRIPTS.map((source) => [source, readLocal(source.slice(1))]));
  if (useInjectedFetch) {
    await assertPublicHttpsUrl(`${options.origin}/`, {
      fieldPath: 'production script origin',
      lookupImpl: options.lookupImpl
    });
  }
  let findings = [];
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    findings = [];
    for (const pagePath of PAGE_FILES.keys()) {
      const pageUrl = new URL(pagePath, `${options.origin}/`).toString();
      try {
        const expectedHtml = approvedPages.get(pagePath);
        const { response, body } = await requestProductionPage(pageUrl, options, useInjectedFetch);
        if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/html') {
          findings.push(`${pageUrl}: expected HTTP 200 HTML response, received ${response.status}`);
          continue;
        }
        findings.push(...validateScripts({ html: body, expectedHtml, pageUrl, origin: options.origin }));
      } catch (error) {
        findings.push(`${pageUrl}: ${error?.message || 'script inventory check failed'}`);
      }
    }
    for (const [source, expectedBytes] of approvedBytes) {
      const scriptUrl = new URL(source, options.origin).toString();
      try {
        const { response, body, bytes } = await requestProductionPage(scriptUrl, options, useInjectedFetch);
        if (response.status !== 200 || !['application/javascript', 'text/javascript'].includes(
          response.headers.get('content-type')?.split(';')[0].trim().toLowerCase())) {
          findings.push(`${scriptUrl}: expected HTTP 200 JavaScript response`);
        } else if (!(bytes ?? Buffer.from(body, 'utf8')).equals(expectedBytes)) {
          findings.push(`${scriptUrl}: JavaScript bytes differ from the reviewed local asset`);
        }
      } catch (error) {
        findings.push(`${scriptUrl}: ${error?.message || 'script content check failed'}`);
      }
    }
    if (findings.length === 0) return [];
    if (attempt < options.attempts) await sleepImpl(options.retryDelayMs);
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const findings = await runProductionScriptCheck();
    if (findings.length) {
      console.error('Production script inventory check failed:');
      findings.forEach((finding) => console.error(`- ${finding}`));
      process.exitCode = 1;
    } else {
      console.log('Production script inventory check passed.');
    }
  } catch (error) {
    console.error(error?.message || 'Production script inventory check failed.');
    process.exitCode = 1;
  }
}

export { APPROVED_SCRIPTS, PAGE_FILES, extractScripts, runProductionScriptCheck, validateScripts };
