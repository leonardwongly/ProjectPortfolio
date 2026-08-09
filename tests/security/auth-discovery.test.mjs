import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const SOURCE_AUTH_MD = 'src/auth.md';
const GENERATED_AUTH_MD = 'auth.md';

function readAuth(path) {
  return fs.readFileSync(path, 'utf8');
}

test('auth.md is published from source with a discoverable heading', () => {
  const source = readAuth(SOURCE_AUTH_MD);
  const generated = readAuth(GENERATED_AUTH_MD);

  assert.match(source, /^# .*auth\.md/im);
  assert.equal(generated, source);
});

test('auth.md gives agents a truthful OAuth registration contract', () => {
  const auth = readAuth(GENERATED_AUTH_MD);

  assert.match(auth, /public, read-only static resource/i);
  assert.match(auth, /OAuth Protected Resource Metadata/i);
  assert.match(auth, /authorization-server metadata/i);
  assert.match(auth, /Registration\/provisioning contact:/i);
  assert.match(auth, /manual_review/);
  assert.match(auth, /agent_auth:/);
  assert.match(auth, /skill: oauth-agent-registration/);
  assert.match(auth, /register_uri: https:\/\/leonardwong\.tech\/auth\.md#/);
  assert.match(auth, /credential_type: none/);
  assert.match(auth, /Do not probe or submit `POST \/agent\/auth`/);
});

test('authorization-server metadata matches the issuer advertised by the PRM', () => {
  const metadata = JSON.parse(readAuth('.well-known/oauth-authorization-server'));

  assert.equal(metadata.issuer, 'https://leonardwongly.cloudflareaccess.com');
  assert.ok(Array.isArray(metadata.scopes_supported));
  assert.ok(metadata.scopes_supported.includes('openid'));
});
