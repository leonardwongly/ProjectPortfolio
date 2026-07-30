import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { writeFileNoFollow } = require('../../scripts/lib/safe-output.cjs');

test('writeFileNoFollow rejects a symlinked generated output without touching its target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-outside-'));
  const destination = path.join(root, 'index.html');
  const external = path.join(outside, 'external.html');
  try {
    fs.writeFileSync(external, 'keep this');
    fs.symlinkSync(external, destination);
    assert.throws(() => writeFileNoFollow(root, destination, 'generated', 'generated index'), /symlink/);
    assert.equal(fs.readFileSync(external, 'utf8'), 'keep this');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('writeFileNoFollow rejects a symlinked parent directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-outside-'));
  const linkedDocs = path.join(root, 'docs');
  try {
    fs.symlinkSync(outside, linkedDocs);
    assert.throws(
      () => writeFileNoFollow(root, path.join(linkedDocs, 'resume.pdf'), 'generated', 'resume PDF'),
      /parent resolves outside/
    );
    assert.equal(fs.existsSync(path.join(outside, 'resume.pdf')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
