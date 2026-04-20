import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const GOVERNANCE_FILE = 'docs/security/vendor-dependencies.json';

test('vendor dependency governance manifest is present and valid', () => {
  const content = fs.readFileSync(GOVERNANCE_FILE, 'utf8');
  const parsed = JSON.parse(content);

  assert.equal(typeof parsed.last_reviewed, 'string');
  assert.equal(typeof parsed.review_cadence, 'string');
  assert.ok(Array.isArray(parsed.dependencies));
  assert.ok(parsed.dependencies.length >= 1);
});

test('vendored dependency signatures match tracked files', () => {
  const parsed = JSON.parse(fs.readFileSync(GOVERNANCE_FILE, 'utf8'));

  parsed.dependencies.forEach((dependency) => {
    assert.equal(typeof dependency.name, 'string');
    assert.equal(typeof dependency.version, 'string');
    assert.equal(typeof dependency.file, 'string');
    assert.ok(Array.isArray(dependency.signatures) && dependency.signatures.length >= 1);

    const fileContent = fs.readFileSync(dependency.file, 'utf8');
    dependency.signatures.forEach((signature) => {
      assert.match(
        fileContent,
        new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `Missing signature "${signature}" in ${dependency.file}`
      );
    });
  });
});
