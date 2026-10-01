import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  extractScripts,
  PAGE_FILES,
  runProductionScriptCheck,
  validateScripts
} from '../../scripts/check-production-scripts.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGIN = 'https://public.example';
const localPage = (pagePath) => fs.readFileSync(path.join(ROOT_DIR, PAGE_FILES.get(pagePath)), 'utf8');
const validate = (html, pagePath = '/work') => validateScripts({
  html,
  expectedHtml: localPage(pagePath),
  pageUrl: new URL(pagePath, ORIGIN).toString(),
  origin: ORIGIN
});

test('committed pages have the approved script inventory', () => {
  for (const pagePath of PAGE_FILES.keys()) {
    assert.deepEqual(validate(localPage(pagePath), pagePath), [], pagePath);
  }
});

test('both service documentation routes have no approved executable scripts', () => {
  const source = localPage('/.well-known/service-doc');
  for (const pagePath of ['/.well-known/service-doc', '/.well-known/service-doc.html']) {
    const validateServiceDoc = (html) => validateScripts({
      html,
      expectedHtml: source,
      pageUrl: new URL(pagePath, ORIGIN).toString(),
      origin: ORIGIN
    });
    assert.deepEqual(extractScripts(source), []);
    assert.deepEqual(validateServiceDoc(source), []);
    assert.match(
      validateServiceDoc(`${source}<script src="/js/main.js" defer></script>`)[0],
      /script inventory differs/
    );
    assert.throws(
      () => validateServiceDoc(`${source}<script>alert(1)</script>`),
      /Unapproved inline script/
    );
  }
});

test('live script injection, removal, and inline mutation fail the inventory', () => {
  const work = localPage('/work');
  assert.throws(
    () => validate(work.replace('</head>', '<script src="/.webmcp/bridge.js" defer></script></head>')),
    /Unapproved external script/
  );
  assert.throws(
    () => validate(work.replace('</head>', '<script src="https://static.cloudflareinsights.com/beacon.min.js" defer></script></head>')),
    /Unapproved external script/
  );
  assert.throws(
    () => validate(work.replace('</head>', '<script type="module">fetch("/mcp")</script></head>')),
    /Unapproved inline script/
  );
  assert.throws(
    () => validate(`${work}<script>window.__CF$cv$params={};</script>`),
    /Unapproved inline script/
  );
  assert.match(validate(work.replace('<script src="js/site.js" defer></script>', ''))[0], /script inventory differs/);
  assert.throws(
    () => validate(work.replace('<script src="js/site.js" defer></script>', '<script src="js/site.js" defer onload="alert(1)"></script>')),
    /unapproved attributes/
  );
  const home = localPage('/');
  assert.match(validate(home.replace('"@context"', '"@context-modified"'), '/')[0], /script inventory differs/);
});

test('script extraction skips comments and raw text but accepts HTML attribute syntax', () => {
  const html = [
    '<!-- <script src="/.webmcp/bridge.js"></script> -->',
    '<style>.sample::after { content: "<script src=/evil></script>"; }</style>',
    '<script defer src="js/main.js"></script>',
    '<script src="js/site.js" defer></script>'
  ].join('');
  assert.equal(extractScripts(html).length, 2);
  assert.deepEqual(validate(html), []);
  assert.equal(extractScripts('<script src="js/main.js" data-note=">" defer></script>').length, 1);
  assert.equal(extractScripts('<script>"</scriptx>"</script>').length, 1);
  assert.throws(() => extractScripts('<script src="/evil">'), /unterminated script/);
  assert.throws(() => extractScripts('<!-- unfinished'), /unterminated comment/);
});

test('script source aliases and duplicate attributes fail closed', () => {
  const work = localPage('/work');
  const sourceTag = '<script src="js/main.js" defer></script>';
  for (const replacement of [
    '<script src="//evil.example/main.js" defer></script>',
    '<script src="/.webmcp/bridge.js" defer></script>',
    '<script src="js/main.js?x=1" defer></script>',
    '<script src="js/main.js" src="/.webmcp/bridge.js" defer></script>',
    '<script src="js/main.js" nonce="abc" defer></script>',
    '<script src="js/main.js" async></script>'
  ]) {
    assert.throws(() => validate(work.replace(sourceTag, replacement)), undefined, replacement);
  }
});

test('production script check uses bounded public HTTPS requests for all approved pages', async () => {
  const requested = [];
  const options = {
    origin: ORIGIN,
    timeoutMs: 100,
    attempts: 1,
    retryDelayMs: 1,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async (url) => {
      const pagePath = new URL(url).pathname;
      requested.push(pagePath);
      return new Response(localPage(pagePath), { status: 200 });
    }
  };
  assert.deepEqual(await runProductionScriptCheck(options), []);
  assert.deepEqual(requested, [...PAGE_FILES.keys()]);
  assert.deepEqual(await runProductionScriptCheck({
    ...options,
    fetchImpl: async (url) => new Response(`${localPage(new URL(url).pathname)}<script src="/.webmcp/bridge.js" defer></script>`)
  }), [...PAGE_FILES.keys()].map((pagePath) =>
    `${new URL(pagePath, ORIGIN)}: Unapproved external script "/.webmcp/bridge.js"`
  ));
  await assert.rejects(
    () => runProductionScriptCheck({ ...options, origin: 'https://localhost' }),
    /local\/private/
  );
});
