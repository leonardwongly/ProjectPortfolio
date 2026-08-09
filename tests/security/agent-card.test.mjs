import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const agentCardPath = path.join(projectRoot, '.well-known', 'agent-card.json');
const sourceAgentCardPath = path.join(projectRoot, 'src/.well-known', 'agent-card.json');

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

test('A2A Agent Card exposes the required discovery metadata', () => {
  const card = readAgentCard();

  assert.equal(typeof card.name, 'string');
  assert.ok(card.name.trim().length > 0);
  assert.equal(typeof card.version, 'string');
  assert.ok(card.version.trim().length > 0);
  assert.equal(typeof card.description, 'string');
  assert.ok(card.description.trim().length > 0);

  assert.ok(Array.isArray(card.supportedInterfaces));
  assert.ok(card.supportedInterfaces.length > 0);
  card.supportedInterfaces.forEach((agentInterface, index) => {
    const fieldPath = `supportedInterfaces[${index}]`;
    assert.equal(typeof agentInterface.url, 'string', `${fieldPath}.url`);
    assert.ok(agentInterface.url.startsWith('https://'), `${fieldPath}.url must use HTTPS`);
    assert.equal(typeof agentInterface.protocolBinding, 'string', `${fieldPath}.protocolBinding`);
    assert.ok(agentInterface.protocolBinding.trim().length > 0, `${fieldPath}.protocolBinding must not be empty`);
    assert.equal(typeof agentInterface.protocolVersion, 'string', `${fieldPath}.protocolVersion`);
    assert.ok(agentInterface.protocolVersion.trim().length > 0, `${fieldPath}.protocolVersion must not be empty`);
  });

  assert.ok(card.capabilities && typeof card.capabilities === 'object');
  assert.equal(typeof card.capabilities.streaming, 'boolean');
  assert.equal(typeof card.capabilities.pushNotifications, 'boolean');
  assert.ok(Array.isArray(card.skills));
  assert.ok(card.skills.length > 0);
  card.skills.forEach((skill, index) => {
    const fieldPath = `skills[${index}]`;
    for (const field of ['id', 'name', 'description']) {
      assert.equal(typeof skill[field], 'string', `${fieldPath}.${field}`);
      assert.ok(skill[field].trim().length > 0, `${fieldPath}.${field} must not be empty`);
    }
  });
});

test('generated A2A Agent Card remains identical to its source', () => {
  assert.equal(fs.readFileSync(agentCardPath, 'utf8'), fs.readFileSync(sourceAgentCardPath, 'utf8'));
});
