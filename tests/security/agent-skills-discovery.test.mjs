import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const indexPath = path.join(projectRoot, '.well-known/agent-skills/index.json');
const sourceIndexPath = path.join(projectRoot, 'src/.well-known/agent-skills/index.json');
const schemaUrl = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

function readDiscoveryIndex() {
  return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}

function artifactPathFromUrl(url) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://leonardwong.tech');
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, '');
  return path.join(projectRoot, parsed.pathname.replace(/^\//, ''));
}

test('Agent Skills discovery index follows the v0.2.0 contract', () => {
  const index = readDiscoveryIndex();

  assert.equal(index.$schema, schemaUrl);
  assert.ok(Array.isArray(index.skills));
  assert.ok(index.skills.length > 0);

  const names = new Set();
  index.skills.forEach((skill, indexPosition) => {
    assert.equal(typeof skill.name, 'string', `skills[${indexPosition}].name`);
    assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(names.has(skill.name), false, `duplicate skill name: ${skill.name}`);
    names.add(skill.name);
    assert.ok(skill.type === 'skill-md' || skill.type === 'archive');
    assert.equal(typeof skill.description, 'string');
    assert.ok(skill.description.trim().length > 0);
    assert.match(skill.url, /^https:\/\//);
    assert.match(skill.digest, /^sha256:[0-9a-f]{64}$/);

    const artifactPath = artifactPathFromUrl(skill.url);
    assert.equal(fs.existsSync(artifactPath), true, `missing skill artifact: ${artifactPath}`);
    const digest = crypto.createHash('sha256')
      .update(fs.readFileSync(artifactPath))
      .digest('hex');
    assert.equal(skill.digest, `sha256:${digest}`, `digest mismatch for ${skill.name}`);

    if (skill.type === 'skill-md') {
      assert.match(path.basename(artifactPath), /^SKILL\.md$/);
    }
  });
});

test('generated Agent Skills index remains identical to its source', () => {
  assert.equal(fs.readFileSync(indexPath, 'utf8'), fs.readFileSync(sourceIndexPath, 'utf8'));
});
