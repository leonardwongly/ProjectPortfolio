import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createHash, createPublicKey, generateKeyPairSync, verify as verifyBytes } from 'node:crypto';
import { signWebBotAuthRequest, signatureBase } from '../../scripts/web-bot-auth.mjs';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const directoryPath = path.join(root, '.well-known/http-message-signatures-directory');
const sourceDirectoryPath = path.join(root, 'src/.well-known/http-message-signatures-directory');
const directory = JSON.parse(fs.readFileSync(directoryPath, 'utf8'));
const publicJwk = directory.keys[0];
const headersTemplate = fs.readFileSync(path.join(root, 'src/_headers.template'), 'utf8');

test('publishes a Web Bot Auth JWKS with an Ed25519 verification key', () => {
  assert.ok(Array.isArray(directory.keys));
  assert.ok(directory.keys.length > 0);
  assert.deepEqual(
    { kty: publicJwk.kty, crv: publicJwk.crv, use: publicJwk.use, key_ops: publicJwk.key_ops, alg: publicJwk.alg },
    { kty: 'OKP', crv: 'Ed25519', use: 'sig', key_ops: ['verify'], alg: 'EdDSA' }
  );
  assert.equal(typeof publicJwk.x, 'string');
  assert.equal(typeof publicJwk.kid, 'string');
  assert.equal('d' in publicJwk, false);
  assert.doesNotThrow(() => createPublicKey({ key: publicJwk, format: 'jwk' }));
  assert.match(headersTemplate, /\/.well-known\/http-message-signatures-directory[\s\S]*Content-Type: application\/json/i);
  assert.match(headersTemplate, /\/.well-known\/http-message-signatures-directory[\s\S]*Access-Control-Allow-Origin: \*/i);
});

test('generated Web Bot Auth directory remains identical to its source', () => {
  assert.equal(fs.readFileSync(directoryPath, 'utf8'), fs.readFileSync(sourceDirectoryPath, 'utf8'));
});

test('signs a request with the Web Bot Auth header set', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateJwk = privateKey.export({ format: 'jwk' });
  const created = Math.floor(Date.now() / 1000);
  const headers = signWebBotAuthRequest({
    url: 'https://example.com/resource',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
    privateJwk,
    created
  });

  assert.equal(headers['Signature-Agent'], '"https://leonardwong.tech"');
  assert.match(headers['Signature-Input'], new RegExp(`^sig1=\\("@method" "@target-uri" "signature-agent" "content-digest"\\);created=${created};expires=${created + 300};`));
  assert.match(headers['content-digest'], /^sha-256=:[A-Za-z0-9+/]+=*:/);
  assert.match(headers.Signature, /^sig1=:[A-Za-z0-9+/]+=*:[.]?$/);

  const signatureParams = headers['Signature-Input'].slice('sig1='.length);
  const base = signatureBase({
    method: 'POST',
    url: 'https://example.com/resource',
    headers: new Map([
      ['signature-agent', headers['Signature-Agent']],
      ['content-digest', headers['content-digest']]
    ]),
    components: ['@method', '@target-uri', 'signature-agent', 'content-digest'],
    signatureParams
  });
  const signature = Buffer.from(headers.Signature.slice('sig1=:'.length, -1), 'base64');
  assert.equal(verifyBytes(null, Buffer.from(base), publicKey, signature), true);
});

test('signature base includes the signature parameters line', () => {
  const base = signatureBase({
    method: 'GET',
    url: 'https://example.com/path',
    headers: new Map([['signature-agent', '"https://leonardwong.tech"']]),
    components: ['@method', '@target-uri', 'signature-agent'],
    signatureParams: '("@method" "@target-uri" "signature-agent");created=1;keyid="leonardwong.tech";alg="ed25519"'
  });
  assert.match(base, /"@method": GET/);
  assert.match(base, /"@target-uri": https:\/\/example\.com\/path/);
  assert.match(base, /"@signature-params":/);
});

test('derives @authority, preserves method casing, and normalizes covered header whitespace', () => {
  const base = signatureBase({
    method: 'propfind',
    url: 'https://example.com:8443/path',
    headers: new Map([['x-request-id', 'request-1']]),
    components: ['@method', '@authority', 'x-request-id'],
    signatureParams: '("@method" "@authority" "x-request-id");created=1;keyid="test";alg="ed25519"'
  });

  assert.match(base, /"@method": propfind/);
  assert.match(base, /"@authority": example\.com:8443/);
  assert.match(base, /"x-request-id": request-1/);

  const { privateKey } = generateKeyPairSync('ed25519');
  const headers = signWebBotAuthRequest({
    url: 'https://example.com/resource',
    method: 'propfind',
    headers: { 'x-request-id': '  request-1  ' },
    privateJwk: privateKey.export({ format: 'jwk' }),
    components: ['@method', 'x-request-id'],
    created: Math.floor(Date.now() / 1000)
  });
  assert.equal(headers['x-request-id'], 'request-1');
});

test('hashes the exact byte range for ArrayBuffer views', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const headers = signWebBotAuthRequest({
    url: 'https://example.com/resource',
    body: new Uint16Array([0x1234]),
    privateJwk: privateKey.export({ format: 'jwk' }),
    created: Math.floor(Date.now() / 1000)
  });
  const expectedDigest = createHash('sha256').update(Buffer.from(new Uint16Array([0x1234]).buffer)).digest('base64');
  assert.equal(headers['content-digest'], `sha-256=:${expectedDigest}:`);
});

test('rejects unsafe targets, components, and stale timestamps', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privateJwk = privateKey.export({ format: 'jwk' });
  const sign = (options = {}) => signWebBotAuthRequest({
    url: 'https://example.com/resource',
    privateJwk,
    ...options
  });

  assert.throws(() => sign({ url: 'https://user:password@example.com/resource' }), /without credentials/);
  assert.throws(() => sign({ url: 'https://example.com/resource#fragment' }), /without credentials/);
  assert.throws(() => sign({ components: ['@method', 'x\n-injected'] }), /valid HTTP signature components/);
  assert.throws(() => sign({ created: Math.floor(Date.now() / 1000) - 301 }), /freshness window/);
  assert.throws(() => sign({ agent: 'https://agent.example\nInjected: value' }), /control characters/);
});
