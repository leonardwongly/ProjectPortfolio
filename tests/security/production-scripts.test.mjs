import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
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

test('offline and service documentation have no approved executable scripts', () => {
  for (const pagePath of ['/offline', '/.well-known/service-doc']) {
    const source = localPage(pagePath);
    assert.deepEqual(extractScripts(source), []);
    assert.deepEqual(validate(source, pagePath), []);
    assert.match(
      validate(`${source}<script src="/js/main.js" defer></script>`, pagePath)[0],
      /script inventory differs/
    );
    assert.throws(
      () => validate(`${source}<script>alert(1)</script>`, pagePath),
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
    /inline execution|unapproved attributes/
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
  assert.throws(() => extractScripts('<script src="/evil">'), /HTML parse error: eof-in-element/);
  assert.throws(() => extractScripts('<!-- unfinished'), /HTML parse error: eof-in-comment/);
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
      return pagePath.startsWith('/js/')
        ? new Response(fs.readFileSync(path.join(ROOT_DIR, pagePath.slice(1))), { headers: { 'content-type': 'application/javascript' } })
        : new Response(localPage(pagePath), { status: 200, headers: { 'content-type': 'text/html' } });
    }
  };
  assert.deepEqual(await runProductionScriptCheck(options), []);
  assert.deepEqual(requested, [...PAGE_FILES.keys(), '/js/main.js', '/js/site.js']);
  assert.deepEqual(await runProductionScriptCheck({
    ...options,
    fetchImpl: async (url) => new URL(url).pathname.startsWith('/js/')
      ? new Response(fs.readFileSync(path.join(ROOT_DIR, new URL(url).pathname.slice(1))), { headers: { 'content-type': 'text/javascript' } })
      : new Response(`${localPage(new URL(url).pathname)}<script src="/.webmcp/bridge.js" defer></script>`, { headers: { 'content-type': 'text/html' } })
  }), [...PAGE_FILES.keys()].map((pagePath) =>
    `${new URL(pagePath, ORIGIN)}: Unapproved external script "/.webmcp/bridge.js"`
  ));
  await assert.rejects(
    () => runProductionScriptCheck({ ...options, origin: 'https://localhost' }),
    /local\/private/
  );
});


test('inline execution outside script elements and browser parsing ambiguities fail closed', () => {
  const work = localPage('/work');
  for (const injection of [
    '<img src=x onerror=alert(1)>', '<a href="jav&#x61;script:alert(1)">bad</a>',
    '<a href="java&#10;script:alert(1)">bad</a>', '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
    '<base href="https://evil.example/">', '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<!-- --!><script src="/unknown.js" defer></script> -->',
    '<svg><script href="https://evil.example/a.js"></script></svg>',
    '<svg><style/><script href="https://evil.example/a.js"></script></svg>',
    '<svg><title><script src="/unknown.js"></script></title></svg>',
    '<math><mtext><script src="/unknown.js"></script></mtext></math>'
  ]) assert.throws(() => validate(`${work}${injection}`), undefined, injection);
  const unicode = `İİİ${work}`;
  assert.deepEqual(validate(unicode), []);
  assert.throws(() => validate(`${unicode}<script src="/unknown.js" defer></script>`));
});

test('reviewed local inventory cannot silently approve additional executable scripts', () => {
  const work = localPage('/work');
  assert.throws(() => validateScripts({ html: work, expectedHtml: `${work}<script src="js/main.js" defer></script>`,
    pageUrl: `${ORIGIN}/work`, origin: ORIGIN }), /Committed HTML/);
  assert.throws(() => validate(work.replace('src="js/main.js"', 'src="https://user:password@public.example/js/main.js"')));
});

test('production script bytes and JavaScript content types must match reviewed assets', async () => {
  for (const mode of ['bytes', 'type']) {
    const findings = await runProductionScriptCheck({ origin: ORIGIN, timeoutMs: 100, attempts: 1, retryDelayMs: 1,
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async (url) => {
        const pagePath = new URL(url).pathname;
        if (!pagePath.startsWith('/js/')) return new Response(localPage(pagePath), { headers: { 'content-type': 'text/html' } });
        return new Response(mode === 'bytes' ? 'alert(1)' : fs.readFileSync(path.join(ROOT_DIR, pagePath.slice(1))),
          { headers: { 'content-type': mode === 'type' ? 'text/html' : 'text/javascript' } });
      }
    });
    assert.equal(findings.length, 2);
    assert.ok(findings.every((finding) => finding.includes(mode === 'bytes' ? 'bytes differ' : 'JavaScript response')));
  }
});


test('default inventory transport pins public DNS for all page and asset requests', async () => {
  const requested = [];
  const findings = await runProductionScriptCheck({ origin: ORIGIN, timeoutMs: 100, attempts: 1, retryDelayMs: 1,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    requestImpl: (url, options, onResponse) => {
      assert.equal(options.agent, false);
      assert.equal(options.servername, 'public.example');
      assert.equal(options.headers.connection, 'close');
      const request = new EventEmitter();
      request.destroy = () => {};
      request.end = () => options.lookup('public.example', {}, (error, address) => {
        assert.ifError(error);
        assert.equal(address, '93.184.216.34');
        const pathname = new URL(url).pathname;
        requested.push(pathname);
        const bytes = pathname.startsWith('/js/')
          ? fs.readFileSync(path.join(ROOT_DIR, pathname.slice(1))) : Buffer.from(localPage(pathname));
        const response = Readable.from([bytes]);
        response.statusCode = 200;
        response.headers = { 'content-type': pathname.startsWith('/js/') ? 'application/javascript' : 'text/html' };
        onResponse(response);
      });
      return request;
    }
  });
  assert.deepEqual(findings, []);
  assert.deepEqual(requested, [...PAGE_FILES.keys(), '/js/main.js', '/js/site.js']);
});

test('private DNS destinations and unsafe local baseline inputs fail before transport', async (t) => {
  let requests = 0;
  const options = { origin: ORIGIN, timeoutMs: 100, attempts: 1, retryDelayMs: 1,
    lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
    requestImpl: () => { requests += 1; throw new Error('must not send'); }
  };
  const blocked = await runProductionScriptCheck(options);
  assert.equal(blocked.length, PAGE_FILES.size + 2);
  assert.ok(blocked.every((finding) => finding.includes('blocked address')));
  assert.equal(requests, 0);
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'production-script-baseline-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  for (const filename of PAGE_FILES.values()) {
    fs.mkdirSync(path.dirname(path.join(rootDir, filename)), { recursive: true });
    fs.copyFileSync(path.join(ROOT_DIR, filename), path.join(rootDir, filename));
  }
  fs.mkdirSync(path.join(rootDir, 'js'));
  fs.symlinkSync(path.join(ROOT_DIR, 'js/main.js'), path.join(rootDir, 'js/main.js'));
  await assert.rejects(() => runProductionScriptCheck({ ...options, rootDir }), /symbolic link/);
  assert.equal(requests, 0);
  assert.throws(() => extractScripts('x'.repeat(1024 * 1024 + 1)), /within.*bytes/);
  await assert.rejects(() => runProductionScriptCheck({ ...options, fetchImpl: async () => new Response('') }), /explicit fetch and DNS|blocked address/);
});

test('script monitor bounds retries and surfaces page, asset and transport errors', async () => {
  let sleeps = 0;
  const options = { origin: ORIGIN, timeoutMs: 100, attempts: 2, retryDelayMs: 1,
    sleepImpl: async () => { sleeps += 1; }, lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async (url) => { if (new URL(url).pathname.startsWith('/js/')) throw new Error('asset transport failed');
      return new Response('unavailable', { status: 503, headers: { 'content-type': 'text/html' } }); }
  };
  const findings = await runProductionScriptCheck(options);
  assert.equal(findings.length, PAGE_FILES.size + 2);
  assert.equal(sleeps, 1);
  assert.ok(findings.some((finding) => finding.includes('asset transport failed')));
  assert.ok(findings.some((finding) => finding.includes('503')));
  await assert.rejects(() => runProductionScriptCheck({ ...options, sleepImpl: 'bad' }), /sleep implementation/);
  await assert.rejects(() => runProductionScriptCheck({ ...options, lookupImpl: undefined }), /explicit fetch and DNS/);
});


test('attribute quote and raw-tag name recovery cannot hide executable scripts on offline', () => {
  const offline = localPage('/offline');
  for (const injection of [
    '<div a=x"><script src="/unknown.js" defer></script><div a=">',
    '<style$invalid><script src="/unknown.js" defer></script>',
    '<style=invalid><script src="/unknown.js" defer></script>',
    '<textarea$invalid><script src="/unknown.js" defer></script>',
    '<svg><style/><script src="/unknown.js" defer></script></svg>'
  ]) assert.throws(() => validate(`${offline}${injection}`, '/offline'), undefined, injection);
});

test('browser raw-text, unknown-tag and declaration payloads cannot conceal added scripts', () => {
  const offline = localPage('/offline');
  for (const injection of [
    '<style></stylex><div title="</style><script src=/unknown.js defer></script>">',
    '<noscript><div title="</noscript><script src=/unknown.js defer></script>">',
    '<div$invalid title="<style>"><script src=/unknown.js defer></script>',
    `<${'a'.repeat(70)} title="<style>"><script src=/unknown.js defer></script>`,
    '<![CDATA[<style>]]><script src=/unknown.js defer></script>',
    '<?foo <style> ?><script src=/unknown.js defer></script>',
    '<!DOCTYPE x "<style>"><script src=/unknown.js defer></script>'
  ]) assert.throws(() => validate(`${offline}${injection}`, '/offline'), undefined, injection);
});

test('non-HTML whitespace cannot impersonate a required script source attribute', () => {
  const work = localPage('/work');
  for (const whitespace of ['\u00a0', '\u000b', '\u2003']) {
    assert.throws(() => validate(work.replace('src="js/main.js"', `src${whitespace}="js/main.js"`)),
      /Unapproved inline script|HTML parse error/, JSON.stringify(whitespace));
  }
});

test('foreign scripts, external SVG references and template content remain unapproved', () => {
  const offline = localPage('/offline');
  for (const injection of [
    '<svg><script href="/unknown.js"></script></svg>',
    '<svg><use xlink:href="https://evil.example/icons.svg#icon" /></svg>',
    '<template><script src="/js/main.js" defer></script></template>',
    '<math><mtext><img src=x onerror=alert(1)></mtext></math>'
  ]) assert.throws(() => validate(`${offline}${injection}`, '/offline'), undefined, injection);
});
