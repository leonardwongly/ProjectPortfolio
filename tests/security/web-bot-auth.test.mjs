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
const headersTemplate = fs.readFileSync(path.join(root, 'src/_headers.template'), 'utf8');

test('publishes a Web Bot Auth JWKS with an Ed25519 verification key', () => {
  assert.ok(Array.isArray(directory.keys));
  assert.ok(directory.keys.length > 0);
  const ids = new Set();
  for (const publicJwk of directory.keys) {
    assert.deepEqual(
      { kty: publicJwk.kty, crv: publicJwk.crv, use: publicJwk.use, key_ops: publicJwk.key_ops, alg: publicJwk.alg },
      { kty: 'OKP', crv: 'Ed25519', use: 'sig', key_ops: ['verify'], alg: 'EdDSA' }
    );
    assert.match(publicJwk.x, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(publicJwk.x, 'base64url').length, 32);
    assert.equal(typeof publicJwk.kid, 'string');
    assert.ok(publicJwk.kid.length > 0);
    assert.equal(ids.has(publicJwk.kid), false, 'key IDs must be unique');
    ids.add(publicJwk.kid);
    assert.equal('d' in publicJwk, false);
    assert.doesNotThrow(() => createPublicKey({ key: publicJwk, format: 'jwk' }));
  }
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

  const digest = createHash('sha256').update('{"ok":true}').digest('base64');
  assert.equal(headers['content-digest'], `sha-256=:${digest}:`);
  const params = `("@method" "@target-uri" "signature-agent" "content-digest");created=${created};expires=${created + 300};keyid="leonardwong.tech";alg="ed25519"`;
  assert.equal(headers['Signature-Input'], `sig1=${params}`);
  // Independent protocol oracle: do not call the signing implementation's canonicalizer.
  const base = [
    '"@method": POST',
    '"@target-uri": https://example.com/resource',
    '"signature-agent": "https://leonardwong.tech"',
    `"content-digest": sha-256=:${digest}:`,
    `"@signature-params": ${params}`
  ].join('\n');
  const signature = Buffer.from(headers.Signature.slice('sig1=:'.length, -1), 'base64');
  assert.equal(verifyBytes(null, Buffer.from(base), publicKey, signature), true);
  const changedDigest = createHash('sha256').update('{"ok":false}').digest('base64');
  for (const tampered of [
    base.replace('POST', 'GET'),
    base.replace('/resource', '/different'),
    base.replace('https://leonardwong.tech', 'https://attacker.example'),
    base.replace(digest, changedDigest),
    base.replace(`created=${created}`, `created=${created - 1}`)
  ]) assert.equal(verifyBytes(null, Buffer.from(tampered), publicKey, signature), false);

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

test('normalizes Fetch-standard method casing before signing', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateJwk = privateKey.export({ format: 'jwk' });
  const created = Math.floor(Date.now() / 1000);
  const headers = signWebBotAuthRequest({
    url: 'https://example.com/resource',
    method: 'post',
    privateJwk,
    created
  });
  const fetchMethod = new Request('https://example.com/resource', { method: 'post' }).method;
  const signatureParams = headers['Signature-Input'].slice('sig1='.length);
  const base = [
    '"@method": POST',
    '"@target-uri": https://example.com/resource',
    '"signature-agent": "https://leonardwong.tech"',
    `"@signature-params": ${signatureParams}`
  ].join('\n');
  const signature = Buffer.from(headers.Signature.slice('sig1=:'.length, -1), 'base64');

  assert.equal(fetchMethod, 'POST');
  assert.equal(verifyBytes(null, Buffer.from(base), publicKey, signature), true);
});

test('hashes the exact byte range for ArrayBuffer views', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const backing = Uint8Array.from([91, 92, 1, 2, 3, 93, 94]);
  for (const body of [backing.subarray(2, 5), new DataView(backing.buffer, 2, 3)]) {
    const headers = signWebBotAuthRequest({
      url: 'https://example.com/resource', body,
      privateJwk: privateKey.export({ format: 'jwk' }),
      created: Math.floor(Date.now() / 1000)
    });
    const expected = createHash('sha256').update(Buffer.from([1, 2, 3])).digest('base64');
    assert.equal(headers['content-digest'], `sha-256=:${expected}:`);
    assert.notEqual(expected, createHash('sha256').update(backing).digest('base64'));
  }
  const words = new Uint16Array([0x1234]);
  for (const [body, bytes] of [[backing.buffer, Buffer.from([91, 92, 1, 2, 3, 93, 94])], [words, Buffer.from(words.buffer)], [new ArrayBuffer(0), Buffer.alloc(0)], ['', Buffer.alloc(0)]]) {
    const headers = signWebBotAuthRequest({ url: 'https://example.com/', body, privateJwk: privateKey.export({ format: 'jwk' }) });
    assert.equal(headers['content-digest'], `sha-256=:${createHash('sha256').update(bytes).digest('base64')}:`);
  }
});

test('emits each signature field once after HTTP header normalization', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const headers = signWebBotAuthRequest({
    url: 'https://example.com/resource',
    headers: {
      'signature-agent': 'untrusted input',
      'signature-input': 'untrusted input',
      signature: 'untrusted input'
    },
    privateJwk: privateKey.export({ format: 'jwk' }),
    created: Math.floor(Date.now() / 1000)
  });
  const normalized = new Headers(headers);

  assert.equal(normalized.get('signature-agent'), '"https://leonardwong.tech"');
  assert.match(normalized.get('signature-input'), /^sig1=/);
  assert.match(normalized.get('signature'), /^sig1=:/);
  assert.equal([...normalized.keys()].filter((name) => name === 'signature-agent').length, 1);
  assert.equal([...normalized.keys()].filter((name) => name === 'signature-input').length, 1);
  assert.equal([...normalized.keys()].filter((name) => name === 'signature').length, 1);
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
  assert.throws(() => sign({ components: ['@method', '@path'] }), /supported derived HTTP signature components/);
  assert.throws(() => sign({ created: Math.floor(Date.now() / 1000) - 301 }), /freshness window/);
  assert.throws(() => sign({ agent: 'https://agent.example\nInjected: value' }), /control characters/);
});

test('freshness, key, method and normalized component boundaries fail closed', (t) => {
  const now = 1800000000;
  t.mock.method(Date, 'now', () => now * 1000);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateJwk = privateKey.export({ format: 'jwk' });
  const sign = (options = {}) => signWebBotAuthRequest({ url: 'https://example.com/', privateJwk, created: now, ...options });
  for (const created of [now - 300, now + 30]) assert.doesNotThrow(() => sign({ created }));
  for (const created of [now - 301, now + 31]) assert.throws(() => sign({ created }), /freshness window/);
  for (const maxAgeSeconds of [0, 301, 1.5, NaN]) assert.throws(() => sign({ maxAgeSeconds }), /maxAgeSeconds/);
  assert.doesNotThrow(() => sign({ maxAgeSeconds: 1, created: now - 1 }));
  for (const created of [0, -1, 1.5, NaN]) assert.throws(() => sign({ created }), /positive integer/);
  for (const components of [[], ['@method', '@METHOD'], ['x-request', 'X-Request'], [' @method'], ['@path']]) {
    assert.throws(() => sign({ components }), /components/);
  }
  for (const method of ['', 'GE T', 'GET\n']) assert.throws(() => sign({ method }), /method/);
  for (const url of ['http://example.com/', 'invalid', 'https://example.com/\n', null]) assert.throws(() => sign({ url }), /HTTPS URL/);
  assert.throws(() => sign({ keyId: 'key\n' }), /keyId/);
  assert.throws(() => sign({ privateJwk: '' }), /is required/);
  assert.throws(() => sign({ privateJwk: '{' }), /valid JSON/);
  assert.throws(() => sign({ privateJwk: publicKey.export({ format: 'jwk' }) }), /private JWK/);
  assert.throws(() => sign({ privateJwk: { kty: 'RSA', d: 'secret' } }), /private JWK/);
});
