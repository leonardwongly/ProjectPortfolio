import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  SafeOutputPathError,
  readTrustedText,
  writeTrustedTextAtomic
} from '../../scripts/lib/safe-output.cjs';

function makeRoots() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-'));
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  return { base, root, outside };
}

function removeRoot(base) {
  fs.rmSync(base, { recursive: true, force: true });
}

test('atomic output writes replace regular files without partial content', () => {
  const { base, root } = makeRoots();
  try {
    writeTrustedTextAtomic(root, 'nested/output.txt', 'first');
    assert.equal(fs.readFileSync(path.join(root, 'nested/output.txt'), 'utf8'), 'first');
    writeTrustedTextAtomic(root, 'nested/output.txt', 'second');
    assert.equal(fs.readFileSync(path.join(root, 'nested/output.txt'), 'utf8'), 'second');
  } finally {
    removeRoot(base);
  }
});

test('output symlink is rejected and its target is not modified', () => {
  const { base, root, outside } = makeRoots();
  try {
    const outsideFile = path.join(outside, 'secret.txt');
    fs.writeFileSync(outsideFile, 'unchanged');
    fs.symlinkSync(outsideFile, path.join(root, 'output.txt'));

    assert.throws(
      () => writeTrustedTextAtomic(root, 'output.txt', 'attacker content'),
      SafeOutputPathError
    );
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'unchanged');
  } finally {
    removeRoot(base);
  }
});

test('symlinked output parent is rejected instead of escaping the root', () => {
  const { base, root, outside } = makeRoots();
  try {
    fs.symlinkSync(outside, path.join(root, 'generated'));
    assert.throws(
      () => writeTrustedTextAtomic(root, 'generated/output.txt', 'attacker content'),
      SafeOutputPathError
    );
    assert.equal(fs.existsSync(path.join(outside, 'output.txt')), false);
  } finally {
    removeRoot(base);
  }
});

test('source symlink is rejected before it can be ingested', () => {
  const { base, root, outside } = makeRoots();
  try {
    const outsideFile = path.join(outside, 'source.html');
    fs.writeFileSync(outsideFile, '<p>outside</p>');
    fs.symlinkSync(outsideFile, path.join(root, 'source.html'));
    assert.throws(
      () => readTrustedText(root, 'source.html'),
      SafeOutputPathError
    );
  } finally {
    removeRoot(base);
  }
});
