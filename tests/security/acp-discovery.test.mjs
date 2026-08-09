import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const sourcePath = path.join(projectRoot, 'src/.well-known/acp.json');
const generatedPath = path.join(projectRoot, '.well-known/acp.json');

function readJson(filePath) {
  assert.ok(fs.existsSync(filePath), `missing ACP discovery document: ${filePath}`);
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw), `${filePath} must contain valid JSON`);
  return JSON.parse(raw);
}

test('ACP discovery advertises the required protocol surface', () => {
  const document = readJson(generatedPath);

  assert.equal(document.protocol?.name, 'acp');
  assert.equal(typeof document.protocol?.version, 'string');
  assert.ok(document.protocol.version.trim().length > 0);

  const apiBaseUrl = new URL(document.api_base_url);
  assert.ok(['http:', 'https:'].includes(apiBaseUrl.protocol));

  assert.ok(Array.isArray(document.transports));
  assert.ok(document.transports.length > 0);
  assert.ok(document.transports.every((transport) => typeof transport === 'string' && transport.trim()));

  assert.ok(Array.isArray(document.capabilities?.services));
  assert.ok(document.capabilities.services.length > 0);
  assert.ok(document.capabilities.services.every((service) => typeof service === 'string' && service.trim()));
});

test('generated ACP discovery remains byte-for-byte identical to its source', () => {
  assert.equal(fs.readFileSync(generatedPath, 'utf8'), fs.readFileSync(sourcePath, 'utf8'));
});
