import { pathToFileURL } from 'node:url';

import {
  normalizePublicHttpsUrl,
  requestPinnedHttpsBytes
} from './lib/network-safety.mjs';

const DEFAULT_ORIGIN = 'https://leonardwong.tech';
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 60000;
const MAX_RESPONSE_BODY_BYTES = 1024 * 1024;
const USER_AGENT = 'ProjectPortfolio-markdown-negotiation/1.0';

const MARKDOWN_ACCEPT = 'text/markdown, text/plain;q=0.9, text/html;q=0.5';

function normalizeOrigin(rawOrigin) {
  if (typeof rawOrigin !== 'string' || !rawOrigin) {
    throw new Error('Markdown negotiation origin must be an HTTPS public origin');
  }
  const parsed = normalizePublicHttpsUrl(rawOrigin, {
    fieldPath: 'markdown negotiation origin'
  });
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Markdown negotiation origin must not include a path, query, or fragment');
  }
  return parsed.origin;
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    origin: env.SITE_ORIGIN ?? DEFAULT_ORIGIN,
    timeoutMs: env.MARKDOWN_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--origin') {
      if (argv[index + 1] === undefined) throw new Error('Expected value after --origin');
      options.origin = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      if (argv[index + 1] === undefined) throw new Error('Expected value after --timeout-ms');
      options.timeoutMs = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!/^[1-9]\d*$/.test(String(options.timeoutMs)) || Number(options.timeoutMs) > MAX_TIMEOUT_MS) {
    throw new Error(`Markdown negotiation timeout must be a positive integer at most ${MAX_TIMEOUT_MS}`);
  }

  return {
    origin: normalizeOrigin(options.origin),
    timeoutMs: Number(options.timeoutMs)
  };
}

async function requestPage(url, acceptHeader, timeoutMs) {
  const result = await requestPinnedHttpsBytes(url, {
    fieldPath: 'markdown negotiation page',
    timeoutMs,
    maxBytes: MAX_RESPONSE_BODY_BYTES,
    method: 'GET',
    headers: {
      'user-agent': USER_AGENT,
      accept: acceptHeader
    }
  });
  return {
    status: result.status,
    headers: result.headers,
    body: result.bytes.toString('utf8')
  };
}

function headerValue(headers, name) {
  const value = headers[name];
  if (Array.isArray(value)) return value.join(', ');
  return value ?? '';
}

function runCheck(name, findings, ok) {
  if (ok) {
    console.log(`  ok: ${name}`);
  } else {
    findings.push(name);
  }
}

async function main() {
  const { origin, timeoutMs } = parseArgs();
  const homepage = `${origin}/`;
  const findings = [];

  console.log(`Checking markdown content negotiation for ${origin}`);

  console.log('Default (no Accept: text/markdown) should return HTML:');
  const html = await requestPage(homepage, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', timeoutMs);
  const htmlContentType = headerValue(html.headers, 'content-type').toLowerCase();
  runCheck('HTTP 200 for default HTML request', findings, html.status === 200);
  runCheck('default request returns text/html', findings, htmlContentType.startsWith('text/html'));
  runCheck('default request body contains HTML markup', findings, /<html[\s>]/i.test(html.body));

  console.log('Accept: text/markdown should return markdown:');
  const markdown = await requestPage(homepage, MARKDOWN_ACCEPT, timeoutMs);
  const mdContentType = headerValue(markdown.headers, 'content-type').toLowerCase();
  runCheck('HTTP 200 for markdown request', findings, markdown.status === 200);
  runCheck('markdown request returns text/markdown', findings, mdContentType.startsWith('text/markdown'));
  runCheck('markdown response is not HTML markup', findings, !/<html[\s>]/i.test(markdown.body));
  runCheck('markdown response is non-empty', findings, markdown.body.trim().length > 0);

  const vary = headerValue(markdown.headers, 'vary').toLowerCase();
  runCheck('response declares Vary: Accept', findings, vary.split(',').map((v) => v.trim()).includes('accept'));

  const tokens = headerValue(markdown.headers, 'x-markdown-tokens');
  if (tokens) {
    console.log(`  info: x-markdown-tokens=${tokens}`);
  }

  if (findings.length > 0) {
    console.error('\nMarkdown content negotiation check FAILED:');
    findings.forEach((finding) => console.error(`  - ${finding}`));
    console.error('\nIf the markdown request returned HTML, enable "Markdown for Agents" for the zone in the Cloudflare dashboard (AI Crawl Control) or via the content_converter API setting, then redeploy.');
    process.exitCode = 1;
  } else {
    console.log('\nMarkdown content negotiation check PASSED.');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Markdown negotiation check error: ${error?.message ?? error}`);
    process.exitCode = 1;
  });
}
