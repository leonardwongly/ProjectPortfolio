import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const agentCardPath = path.join(projectRoot, '.well-known', 'agent-card.json');

function readAgentCard() {
  return JSON.parse(fs.readFileSync(agentCardPath, 'utf8'));
}

test('A2A Agent Card advertises the AP2 shopper extension', () => {
  const card = readAgentCard();
  const ap2Extension = card.extensions?.find((extension) => (
    extension.uri === 'https://github.com/google-agentic-commerce/AP2/tree/v0.1.0'
  ));

  assert.ok(ap2Extension, 'missing AP2 extension from the Agent Card');
  assert.deepEqual(ap2Extension.params?.roles, ['shopper']);
  assert.equal(ap2Extension.required, false);
});
