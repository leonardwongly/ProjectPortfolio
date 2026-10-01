import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { decodeHtmlAttributeEntities } from './lib/html-attributes.mjs';
import { assertPublicHttpsUrl } from './lib/network-safety.mjs';
import {
  normalizeSmokeOptions,
  parseArgs,
  requestProductionPage
} from './check-production-smoke.mjs';

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

function nextTagEnd(html, start) {
  let quote = null;
  for (let cursor = start; cursor < html.length; cursor += 1) {
    const character = html[cursor];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return cursor;
    }
  }
  throw new Error('HTML contains an unterminated tag');
}

function parseAttributes(source) {
  const attributes = new Map();
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? '')) cursor += 1;
    if (cursor >= source.length) break;
    if (source[cursor] === '/') {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < source.length && !/[\s=/>]/.test(source[cursor])) cursor += 1;
    if (cursor === start) throw new Error('Script tag contains a malformed attribute');
    const name = source.slice(start, cursor).toLowerCase();
    if (attributes.has(name)) throw new Error(`Script tag repeats ${name} attribute`);
    while (/\s/.test(source[cursor] ?? '')) cursor += 1;
    let value = '';
    if (source[cursor] === '=') {
      cursor += 1;
      while (/\s/.test(source[cursor] ?? '')) cursor += 1;
      const quote = source[cursor] === '"' || source[cursor] === "'" ? source[cursor++] : null;
      const valueStart = cursor;
      if (quote) {
        while (cursor < source.length && source[cursor] !== quote) cursor += 1;
        if (cursor >= source.length) throw new Error(`Script ${name} attribute is unterminated`);
        value = source.slice(valueStart, cursor);
        cursor += 1;
      } else {
        while (cursor < source.length && !/[\s>]/.test(source[cursor])) cursor += 1;
        value = source.slice(valueStart, cursor);
      }
    }
    attributes.set(name, decodeHtmlAttributeEntities(value));
  }
  return attributes;
}

function extractScripts(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error(`HTML must be a string within ${MAX_HTML_BYTES} bytes`);
  }
  const scripts = [];
  const lower = html.toLowerCase();
  let cursor = 0;
  while (cursor < html.length) {
    const open = html.indexOf('<', cursor);
    if (open < 0) break;
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      if (end < 0) throw new Error('HTML contains an unterminated comment');
      cursor = end + 3;
      continue;
    }
    const tag = /^<\/?([a-z][\w:-]*)\b/i.exec(html.slice(open, open + 64));
    if (!tag) {
      cursor = open + 1;
      continue;
    }
    const closing = html[open + 1] === '/';
    const name = tag[1].toLowerCase();
    const tagEnd = nextTagEnd(html, open + tag[0].length);
    cursor = tagEnd + 1;
    if (closing) continue;
    if (name === 'script') {
      let close = lower.indexOf('</script', cursor);
      while (close >= 0 && !/[\s/>]/.test(lower[close + 8] ?? '')) {
        close = lower.indexOf('</script', close + 8);
      }
      if (close < 0) {
        throw new Error('HTML contains an unterminated script');
      }
      const closeEnd = nextTagEnd(html, close + 8);
      scripts.push({
        attributes: parseAttributes(html.slice(open + tag[0].length, tagEnd)),
        body: html.slice(cursor, close)
      });
      cursor = closeEnd + 1;
    } else if (['style', 'textarea', 'title', 'iframe', 'xmp', 'noembed', 'noframes'].includes(name)) {
      const close = lower.indexOf(`</${name}`, cursor);
      cursor = close < 0 ? html.length : close;
    } else if (name === 'plaintext') {
      cursor = html.length;
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
    if (resolved.origin !== origin || resolved.search || resolved.hash ||
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
    : ['/offline', '/.well-known/service-doc', '/.well-known/service-doc.html'].includes(new URL(pageUrl).pathname) ? [] : required;
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
  if (useInjectedFetch) {
    await assertPublicHttpsUrl(`${options.origin}/`, {
      fieldPath: 'production script origin',
      lookupImpl: options.lookupImpl
    });
  }
  let findings = [];
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    findings = [];
    for (const [pagePath, filename] of PAGE_FILES) {
      const pageUrl = new URL(pagePath, `${options.origin}/`).toString();
      try {
        const expectedHtml = fs.readFileSync(path.join(rootDir, filename), 'utf8');
        const { response, body } = await requestProductionPage(pageUrl, options, useInjectedFetch);
        if (response.status !== 200) {
          findings.push(`${pageUrl}: expected HTTP 200, received ${response.status}`);
          continue;
        }
        findings.push(...validateScripts({ html: body, expectedHtml, pageUrl, origin: options.origin }));
      } catch (error) {
        findings.push(`${pageUrl}: ${error?.message || 'script inventory check failed'}`);
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
