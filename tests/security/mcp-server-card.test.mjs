import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const cardPath = '.well-known/mcp/server-card.json';
const sourceCardPath = `src/${cardPath}`;

function readCard(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function assertValidCard(card, label) {
  assert.equal(typeof card.serverInfo?.name, 'string', `${label} must include serverInfo.name`);
  assert.ok(card.serverInfo.name.trim(), `${label} serverInfo.name must not be empty`);
  assert.equal(typeof card.serverInfo?.version, 'string', `${label} must include serverInfo.version`);
  assert.ok(card.serverInfo.version.trim(), `${label} serverInfo.version must not be empty`);

  assert.equal(card.transport?.type, 'streamable-http', `${label} must advertise Streamable HTTP`);
  assert.match(
    card.transport?.endpoint || '',
    /^https:\/\/[^\s/]+(?:\/[^\s]*)?$/u,
    `${label} must include an absolute HTTPS transport endpoint`
  );

  ['tools', 'resources', 'prompts'].forEach((capability) => {
    assert.ok(
      card.capabilities && Object.hasOwn(card.capabilities, capability),
      `${label} must list ${capability} capabilities`
    );
    assert.equal(typeof card.capabilities[capability], 'object');
  });
}

test('MCP Server Card source and generated copy advertise discovery metadata', () => {
  const sourceCard = readCard(sourceCardPath);
  const generatedCard = readCard(cardPath);

  assertValidCard(sourceCard, 'source card');
  assertValidCard(generatedCard, 'generated card');
  assert.deepEqual(generatedCard, sourceCard, 'generated card must match its source');
  assert.equal(generatedCard.name, 'tech.leonardwongly/portfolio');
  assert.equal(generatedCard.version, generatedCard.serverInfo.version);
  assert.equal(generatedCard.remotes?.[0]?.url, generatedCard.transport.endpoint);
});

test('MCP Server Card is served with public discovery headers', () => {
  const sourceHeaders = fs.readFileSync(path.join(projectRoot, 'src/_headers.template'), 'utf8');
  const generatedHeaders = fs.readFileSync(path.join(projectRoot, '_headers'), 'utf8');
  const headerBlock = [
    '/.well-known/mcp/server-card.json',
    '  Content-Type: application/json; charset=utf-8',
    '  Cache-Control: public, max-age=3600',
    '  Access-Control-Allow-Origin: *',
    '  Access-Control-Allow-Methods: GET, HEAD',
    '  Access-Control-Allow-Headers: Accept, Content-Type, If-None-Match',
    '  Access-Control-Expose-Headers: ETag'
  ].join('\n');

  assert.match(sourceHeaders, new RegExp(headerBlock.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(generatedHeaders, new RegExp(headerBlock.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
