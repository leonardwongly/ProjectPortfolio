import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import { PAGE_FILES } from '../../scripts/check-production-scripts.mjs';

import {
  PAGE_CHECKS,
  runProductionSmoke,
  validateContentSecurityPolicy,
  validatePage,
  validateStrictTransportSecurity
} from '../../scripts/check-production-smoke.mjs';

const CSP = "default-src 'self'; script-src 'self' 'sha256-RBh5ZtcP26aZFp/EGYy/BT1gSD595lvp8sWO2T9xesI='; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests; block-all-mixed-content";
const HSTS = 'max-age=31536000; includeSubDomains; preload';

test('advertised service documentation uses the clean route covered by smoke and script inventory', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../../.well-known/api-catalog', import.meta.url), 'utf8'));
  const path = new URL(catalog.linkset[0]['service-doc'][0].href).pathname;
  assert.equal(path, '/.well-known/service-doc');
  assert.equal(PAGE_CHECKS.find((check) => check.path === path)?.noScripts, true);
  assert.equal(PAGE_FILES.get(path), '.well-known/service-doc.html');
  assert.equal(PAGE_CHECKS.some((check) => check.path === '/.well-known/service-doc.html'), false);
  assert.equal(PAGE_FILES.has('/.well-known/service-doc.html'), false);
});

test('service documentation direct responses require a script-free CSP, including merged policies', () => {
  const policy = CSP.replace(/script-src [^;]+/, "script-src 'none'");
  for (const route of ['/.well-known/service-doc', '/.well-known/service-doc.html']) {
    for (const filename of ['../../src/_headers.template', '../../_headers']) {
      const headers = fs.readFileSync(new URL(filename, import.meta.url), 'utf8');
      const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(headers, new RegExp(`^${escapedRoute}\\n\\s+Content-Security-Policy: [^\\n]+script-src 'none'`, 'm'));
    }
    const check = PAGE_CHECKS.find(({ path }) => path === '/.well-known/service-doc');
    assert.equal(check?.noScripts, true);
    const validate = (csp) => validatePage({
      url: `https://public.example${route}`,
      response: { status: 200, headers: new Headers({ 'content-security-policy': csp, 'strict-transport-security': HSTS, 'x-content-type-options': 'nosniff' }) },
      body: '<h1>Service Documentation</h1>',
      check
    });
    assert.deepEqual(validate(policy), []);
    assert.deepEqual(validate(`${CSP}, ${policy}`), []);
    assert.deepEqual(validate(`${policy}, ${CSP}`), []);
    assert.deepEqual(validate(`${CSP}, ${policy}; script-src-elem 'none'`), []);
    assert.deepEqual(validate(`${policy}; script-src-elem  'none'`), []);
    assert.match(validate(CSP).join('\n'), /script-src 'none'/);
    assert.match(validate(`${policy}; script-src-elem 'self'`).join('\n'), /script-src 'none'/);
    assert.match(validate(`${CSP}, ${policy}; script-src-elem 'self'`).join('\n'), /script-src 'none'/);
  }
});

test('production smoke fails when a sitewide policy blocks required interactive scripts', async () => {
  const scriptFreePolicy = CSP.replace(/script-src [^;]+/, "script-src 'none'");
  const options = {
    origin: 'https://public.example',
    timeoutMs: 100,
    attempts: 1,
    retryDelayMs: 1,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async (url) => {
      const check = PAGE_CHECKS.find(({ path }) => path === new URL(url).pathname);
      return new Response(`<h1>${check.marker.source.replace(/\\/g, '')}</h1>`, {
        headers: {
          'content-security-policy': scriptFreePolicy,
          'strict-transport-security': HSTS,
          'x-content-type-options': 'nosniff'
        }
      });
    }
  };
  const findings = await runProductionSmoke(options);
  assert.deepEqual(findings, PAGE_CHECKS.filter(({ noScripts }) => !noScripts).map(({ path }) =>
    `https://public.example${path}: content-security-policy script-src must allow only 'self' and script hashes`
  ));
});

test('production CSP accepts the deployed policy and a restrictive minimum', () => {
  assert.equal(validateContentSecurityPolicy(CSP), null);
  assert.equal(validateContentSecurityPolicy(`${CSP}, ${CSP}`), null);
  assert.equal(
    validateContentSecurityPolicy("default-src 'none'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests"),
    null
  );
});

test('production CSP rejects policies that relax script, framing, form, or transport protection', () => {
  for (const policy of [
    "default-src 'self'",
    CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    CSP.replace("script-src 'self'", "script-src 'self' 'sha256-bad'"),
    CSP.replace("script-src 'self'", 'script-src *'),
    CSP.replace(/script-src [^;]+/, "script-src 'none'"),
    `${CSP}; script-src-elem 'none'`,
    `${CSP}, ${CSP.replace(/script-src [^;]+/, "script-src 'none'")}`,
    `${CSP}; script-src-elem *`,
    `${CSP}; script-src-attr 'unsafe-inline'`,
    CSP.replace("object-src 'none'", "object-src 'self'"),
    CSP.replace("frame-ancestors 'none'", 'frame-ancestors *'),
    CSP.replace("form-action 'self'", 'form-action https:'),
    CSP.replace("connect-src 'self'", 'connect-src *'),
    CSP.replace('upgrade-insecure-requests', ''),
    `${CSP}; script-src 'unsafe-eval'`,
    `${CSP}, default-src 'self'`,
    `${CSP},`,
    Array(9).fill(CSP).join(', '),
    `${CSP}; ${' '.repeat(16384)}`
  ]) {
    assert.notEqual(validateContentSecurityPolicy(policy), null, policy);
  }
});

test('production HSTS requires a valid one-year policy covering subdomains', () => {
  assert.equal(validateStrictTransportSecurity(HSTS), null);
  assert.equal(validateStrictTransportSecurity('max-age=63072000; includeSubDomains'), null);
  assert.equal(validateStrictTransportSecurity('max-age="31536000"; includeSubDomains'), null);
  for (const policy of [
    'max-age=0; includeSubDomains',
    'max-age=31535999; includeSubDomains',
    'max-age=31536000',
    'max-age=abc; includeSubDomains',
    'max-age=999999999999999999999999; includeSubDomains',
    'max-age=31536000; includeSubDomains=1',
    'max-age=31536000; includeSubDomains; max-age=0',
    'max-age=31536000; includeSubDomains, max-age=0'
  ]) {
    assert.notEqual(validateStrictTransportSecurity(policy), null, policy);
  }
});

test('production page validation reports weak CSP and HSTS values', () => {
  const check = {
    marker: /Reading/i,
    headers: ['content-security-policy', 'strict-transport-security', 'x-content-type-options']
  };
  const page = (csp, hsts) => validatePage({
    url: 'https://example.test/reading',
    response: {
      status: 200,
      headers: new Headers({
        'content-security-policy': csp,
        'strict-transport-security': hsts,
        'x-content-type-options': 'nosniff'
      })
    },
    body: '<h1>Reading</h1>',
    check
  });

  assert.deepEqual(page(CSP, HSTS), []);
  assert.match(page(`${CSP}; script-src-elem 'none'`, HSTS).join('\n'), /script-src-elem must allow only 'self'/);
  assert.match(page("default-src 'self'", HSTS).join('\n'), /content-security-policy script-src/);
  assert.match(page(CSP, 'max-age=0').join('\n'), /strict-transport-security max-age/);
});
