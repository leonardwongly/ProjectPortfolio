import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateContentSecurityPolicy,
  validatePage,
  validateStrictTransportSecurity
} from '../../scripts/check-production-smoke.mjs';

const CSP = "default-src 'self'; script-src 'self' 'sha256-RBh5ZtcP26aZFp/EGYy/BT1gSD595lvp8sWO2T9xesI='; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests; block-all-mixed-content";
const HSTS = 'max-age=31536000; includeSubDomains; preload';

test('production CSP accepts the deployed policy and a restrictive minimum', () => {
  assert.equal(validateContentSecurityPolicy(CSP), null);
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
    `${CSP}; script-src-elem *`,
    `${CSP}; script-src-attr 'unsafe-inline'`,
    CSP.replace("object-src 'none'", "object-src 'self'"),
    CSP.replace("frame-ancestors 'none'", 'frame-ancestors *'),
    CSP.replace("form-action 'self'", 'form-action https:'),
    CSP.replace("connect-src 'self'", 'connect-src *'),
    CSP.replace('upgrade-insecure-requests', ''),
    `${CSP}; script-src 'unsafe-eval'`,
    `${CSP}, default-src 'self'`
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
  assert.match(page("default-src 'self'", HSTS).join('\n'), /content-security-policy script-src/);
  assert.match(page(CSP, 'max-age=0').join('\n'), /strict-transport-security max-age/);
});
