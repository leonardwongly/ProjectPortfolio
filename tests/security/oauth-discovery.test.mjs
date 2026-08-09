import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const sourceDiscoveryPath = path.join(projectRoot, 'src/.well-known/openid-configuration');
const discoveryPath = path.join(projectRoot, '.well-known/openid-configuration');
const headersPath = path.join(projectRoot, '_headers');
const expectedIssuer = 'https://leonardwongly.cloudflareaccess.com';

function readDiscoveryDocument() {
  assert.ok(fs.existsSync(discoveryPath), 'OIDC discovery document must be deployed');
  const raw = fs.readFileSync(discoveryPath, 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw), 'OIDC discovery document must contain valid JSON');
  return JSON.parse(raw);
}

test('OIDC discovery metadata exposes required endpoints and capability lists', () => {
  const metadata = readDiscoveryDocument();

  for (const field of [
    'issuer',
    'authorization_endpoint',
    'token_endpoint',
    'jwks_uri'
  ]) {
    assert.equal(typeof metadata[field], 'string', `${field} must be a URL string`);
    assert.match(metadata[field], /^https:\/\//, `${field} must use HTTPS`);
  }

  assert.equal(metadata.issuer, expectedIssuer);
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    assert.equal(new URL(metadata[field]).origin, expectedIssuer);
  }
  assert.ok(Array.isArray(metadata.grant_types_supported));
  assert.ok(metadata.grant_types_supported.includes('authorization_code'));
  assert.ok(Array.isArray(metadata.response_types_supported));
  assert.ok(metadata.response_types_supported.includes('code'));
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['client_secret_basic']);
});

test('generated OIDC discovery metadata stays in sync with its source', () => {
  assert.equal(
    fs.readFileSync(discoveryPath, 'utf8'),
    fs.readFileSync(sourceDiscoveryPath, 'utf8')
  );
});

test('OAuth authorization-server metadata exposes the same required endpoints', () => {
  const sourcePath = path.join(projectRoot, 'src/.well-known/oauth-authorization-server');
  const generatedPath = path.join(projectRoot, '.well-known/oauth-authorization-server');
  const metadata = JSON.parse(fs.readFileSync(generatedPath, 'utf8'));

  for (const field of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    assert.equal(typeof metadata[field], 'string', `${field} must be a URL string`);
    assert.match(metadata[field], /^https:\/\//, `${field} must use HTTPS`);
  }

  assert.equal(metadata.issuer, expectedIssuer);
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    assert.equal(new URL(metadata[field]).origin, expectedIssuer);
  }
  assert.ok(metadata.grant_types_supported.includes('authorization_code'));
  assert.ok(metadata.response_types_supported.includes('code'));
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['client_secret_basic']);
  assert.equal(fs.readFileSync(generatedPath, 'utf8'), fs.readFileSync(sourcePath, 'utf8'));
});

test('discovery routes are delivered as public JSON', () => {
  const headers = fs.readFileSync(headersPath, 'utf8');

  for (const route of ['/.well-known/openid-configuration', '/.well-known/oauth-authorization-server']) {
    const block = headers.match(new RegExp(`${route.replaceAll('/', '\\/')}\\n([\\s\\S]*?)(?=\\n\\n|$)`))?.[1] ?? '';
    assert.match(block, /Content-Type: application\/json; charset=utf-8/);
    assert.match(block, /Access-Control-Allow-Origin: \*/);
  }
});
