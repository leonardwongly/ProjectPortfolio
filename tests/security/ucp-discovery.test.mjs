import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const sourcePath = path.join(projectRoot, 'src/.well-known/ucp');
const generatedPath = path.join(projectRoot, '.well-known/ucp');
const headersPath = path.join(projectRoot, '_headers');
const canonicalPrefix = 'https://ucp.dev/2026-04-08/';

function readProfile(filePath = generatedPath) {
  assert.ok(fs.existsSync(filePath), `missing UCP profile: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('UCP discovery profile exposes scanner and specification metadata', () => {
  const profile = readProfile();

  assert.equal(profile.protocol_version, '2026-04-08');
  assert.ok(profile.services && typeof profile.services === 'object');
  assert.ok(profile.capabilities && typeof profile.capabilities === 'object');
  assert.ok(profile.endpoints && typeof profile.endpoints === 'object');
  assert.ok(Object.keys(profile.services).length > 0);
  assert.ok(Object.keys(profile.capabilities).length > 0);
  assert.ok(Object.keys(profile.endpoints).length > 0);
  Object.entries(profile.endpoints).forEach(([name, url]) => {
    assert.equal(typeof url, 'string', `${name} endpoint must be a URL string`);
    assert.match(url, /^https:\/\//, `${name} endpoint must use HTTPS`);
  });

  assert.equal(profile.endpoints.content, 'https://leonardwong.tech/api/scan');
  assert.equal(profile.ucp?.version, profile.protocol_version);
  assert.ok(profile.ucp?.services?.['dev.ucp.shopping']);
  assert.ok(profile.ucp?.capabilities?.['dev.ucp.shopping.checkout']);
  assert.deepEqual(profile.ucp?.payment_handlers, {});
  assert.deepEqual(profile.signing_keys, []);
});

test('UCP discovery references only HTTPS canonical specifications and schemas', () => {
  const profile = readProfile();
  const references = [];

  function collect(value, key = '') {
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      if (['spec', 'schema'].includes(key)) references.push(value);
      return;
    }
    Object.entries(value).forEach(([entryKey, entryValue]) => collect(entryValue, entryKey));
  }

  collect(profile);
  assert.ok(references.length > 0);
  references.forEach((url) => {
    assert.equal(typeof url, 'string');
    assert.match(url, new RegExp(`^${canonicalPrefix.replaceAll('.', '\\.')}`));
    assert.match(url, /^https:\/\//);
  });
});

test('generated UCP profile stays in sync with its source and is served as JSON', () => {
  assert.equal(fs.readFileSync(generatedPath, 'utf8'), fs.readFileSync(sourcePath, 'utf8'));
  const headers = fs.readFileSync(headersPath, 'utf8');
  const block = headers.slice(headers.indexOf('/.well-known/ucp'));

  assert.match(block, /Content-Type: application\/json; charset=utf-8/);
  assert.match(block, /Cache-Control: public, max-age=300, s-maxage=300/);
  assert.match(block, /Access-Control-Allow-Origin: \*/);
});
