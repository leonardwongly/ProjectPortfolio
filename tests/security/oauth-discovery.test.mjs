import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const expectedIssuer = 'https://leonardwongly.cloudflareaccess.com';
const metadataPaths = [
  '.well-known/openid-configuration',
  '.well-known/oauth-authorization-server'
];

test('OAuth/OIDC discovery metadata exposes the required endpoint fields', () => {
  for (const relativePath of metadataPaths) {
    const absolutePath = path.join(projectRoot, relativePath);
    assert.ok(fs.existsSync(absolutePath), `missing discovery document: ${relativePath}`);

    const metadata = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    for (const field of [
      'issuer',
      'authorization_endpoint',
      'token_endpoint',
      'jwks_uri'
    ]) {
      assert.equal(typeof metadata[field], 'string', `${relativePath}: ${field} must be a URL string`);
      assert.match(metadata[field], /^https:\/\//, `${relativePath}: ${field} must use HTTPS`);
    }

    assert.equal(metadata.issuer, expectedIssuer);
    assert.ok(Array.isArray(metadata.grant_types_supported));
    assert.ok(metadata.grant_types_supported.includes('authorization_code'));
    assert.ok(Array.isArray(metadata.response_types_supported));
    assert.ok(metadata.response_types_supported.includes('code'));
  }
});

test('discovery routes are delivered as public JSON', () => {
  const headers = fs.readFileSync(path.join(projectRoot, '_headers'), 'utf8');

  for (const route of metadataPaths.map((value) => `/${value}`)) {
    const block = headers.match(new RegExp(`${route.replaceAll('/', '\\/')}\\n([\\s\\S]*?)(?=\\n\\n|$)`))?.[1] ?? '';
    assert.match(block, /Content-Type: application\/json; charset=utf-8/);
    assert.match(block, /Access-Control-Allow-Origin: \*/);
  }
});
