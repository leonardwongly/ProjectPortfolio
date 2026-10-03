import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateContentSecurityPolicy,
  validatePage,
  validatePermissionsPolicy,
  PAGE_CHECKS,
  validateStrictTransportSecurity
} from '../../scripts/check-production-smoke.mjs';

const CSP = "default-src 'self'; script-src 'self' 'sha256-RBh5ZtcP26aZFp/EGYy/BT1gSD595lvp8sWO2T9xesI='; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests; block-all-mixed-content";
const PERMISSIONS = 'accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()';
const HSTS = 'max-age=31536000; includeSubDomains; preload';

test('production CSP accepts the deployed policy and a restrictive minimum', () => {
  assert.equal(validateContentSecurityPolicy(CSP), null);
  assert.equal(
    validateContentSecurityPolicy("default-src 'none'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests; block-all-mixed-content"),
    null
  );
});

test('production CSP rejects policies that relax script, framing, form, or transport protection', () => {
  for (const policy of [
    "default-src 'self'",
    CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    CSP.replace("script-src 'self'", "script-src 'self' 'sha256-bad'"),
    CSP.replace("script-src 'self'", "script-src 'self' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='"),
    CSP.replace("script-src 'self'", 'script-src *'),
    `${CSP}; script-src-elem *`,
    `${CSP}; script-src-attr 'unsafe-inline'`,
    CSP.replace("object-src 'none'", "object-src 'self'"),
    CSP.replace("frame-ancestors 'none'", 'frame-ancestors *'),
    CSP.replace("form-action 'self'", 'form-action https:'),
    CSP.replace("connect-src 'self'", 'connect-src *'),
    CSP.replace('upgrade-insecure-requests', ''),
    `${CSP}; script-src 'unsafe-eval'`,
    `${CSP},`,
    `${CSP}, script-src *`,
    `${CSP}; style-src-elem 'unsafe-inline'`,
    `${CSP}; style-src-attr 'unsafe-inline'`,
    `${CSP}; connect-src *`,
    CSP.replace("img-src 'self' data:", "img-src 'none' data:"),
    `${CSP}; report-uri https://evil.example`,
    CSP.replace("script-src 'self'", "script-src 'self'\u00a0")
  ]) {
    assert.notEqual(validateContentSecurityPolicy(policy), null, policy);
  }
});

test('production HSTS requires a valid one-year policy covering subdomains', () => {
  assert.equal(validateStrictTransportSecurity(HSTS), null);
  assert.equal(validateStrictTransportSecurity('max-age=63072000; includeSubDomains; preload'), null);
  assert.equal(validateStrictTransportSecurity('max-age="31536000"; includeSubDomains; preload'), null);
  for (const policy of [
    'max-age=0; includeSubDomains',
    'max-age=31535999; includeSubDomains',
    'max-age=31536000',
    'max-age=abc; includeSubDomains',
    'max-age=999999999999999999999999; includeSubDomains',
    'max-age=31536000; includeSubDomains=1',
    'max-age=31536000; includeSubDomains; max-age=0',
    'max-age=31536000; includeSubDomains, max-age=0',
    'max-age=31536000; includeSubDomains; preload=1',
    'max-age=31536000; includeSubDomains; preload; unknown=1',
    'max-age=31536000\u00a0; includeSubDomains; preload'
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
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': PERMISSIONS
      })
    },
    body: '<h1>Reading</h1>',
    check
  });

  assert.deepEqual(page(CSP, HSTS), []);
  assert.match(page("default-src 'self'", HSTS).join('\n'), /content-security-policy/);
  assert.match(page(CSP, 'max-age=0').join('\n'), /strict-transport-security max-age/);
});


test('valid additional enforcing CSP policies retain the baseline protection', () => {
  for (const policy of [CSP, "default-src 'none'", "script-src 'none'; style-src-attr 'none'"]) {
    assert.equal(validateContentSecurityPolicy(`${CSP}, ${policy}`), null);
  }
  assert.notEqual(validateContentSecurityPolicy(`default-src 'self', script-src 'self'`), null);
  assert.notEqual(validateContentSecurityPolicy(`${CSP}, script-src 'self'; script-src *`), null);
});

test('permissions policy detects omissions, duplicates and enabled features', () => {
  assert.equal(validatePermissionsPolicy(PERMISSIONS), null);
  assert.equal(validatePermissionsPolicy(`${PERMISSIONS}, display-capture=()`), null);
  for (const policy of [null, '', PERMISSIONS.replace('camera=()', 'camera=(self)'),
    PERMISSIONS.replace('usb=(), ', ''), `${PERMISSIONS}, camera=()`, `${PERMISSIONS},`,
    PERMISSIONS.replace('payment=()', 'payment=*')]) {
    assert.notEqual(validatePermissionsPolicy(policy), null, String(policy));
  }
});

test('all eight published clean pages require the complete header set', () => {
  assert.deepEqual(PAGE_CHECKS.map(({ path }) => path), ['/', '/work', '/case-study-agentforge',
    '/case-study-agentic', '/case-study-apple-calendar-mcp', '/reading', '/offline', '/.well-known/service-doc']);
  const validHeaders = new Headers({
    'content-security-policy': CSP, 'strict-transport-security': HSTS,
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin', 'permissions-policy': PERMISSIONS
  });
  for (const check of PAGE_CHECKS) {
    for (const [header, value] of [
      ['content-security-policy', `${CSP}, script-src *`], ['strict-transport-security', 'max-age=0'],
      ['x-content-type-options', 'nosniff, nosniff'], ['x-frame-options', 'DENY, SAMEORIGIN'],
      ['referrer-policy', 'strict-origin-when-cross-origin, unsafe-url'],
      ['permissions-policy', `${PERMISSIONS}, camera=(self)`]
    ]) {
      const headers = new Headers(validHeaders);
      headers.set(header, value);
      assert.ok(validatePage({ url: `https://public.example${check.path}`, check,
        response: { status: 200, headers }, body: check.marker.source }).length, header);
      headers.delete(header);
      assert.ok(validatePage({ url: `https://public.example${check.path}`, check,
        response: { status: 200, headers }, body: check.marker.source }).length, header);
    }
  }
});
