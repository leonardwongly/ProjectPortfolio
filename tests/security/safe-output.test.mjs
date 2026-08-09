import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const crypto = require('node:crypto');
const { writeFileNoFollow } = require('../../scripts/lib/safe-output.cjs');

const WORKER_RENDEZVOUS_TIMEOUT_MS = 15_000;

async function waitForWorkerMessage(worker, expectedType) {
  if (worker.threadId === -1) {
    throw new Error(`Worker exited before sending ${expectedType}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_RENDEZVOUS_TIMEOUT_MS);
  try {
    const outcome = await Promise.race([
      once(worker, 'message', { signal: controller.signal })
        .then(([message]) => ({ kind: 'message', message })),
      once(worker, 'exit', { signal: controller.signal })
        .then(([code]) => ({ code, kind: 'exit' }))
    ]);

    if (outcome.kind === 'exit') {
      throw new Error(`Worker exited with code ${outcome.code} before sending ${expectedType}`);
    }
    assert.equal(outcome.message?.type, expectedType);
    return outcome.message;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out waiting for worker message ${expectedType}`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function waitForWorkerExit(worker) {
  if (worker.threadId === -1) {
    throw new Error('Worker exited before exit rendezvous was established');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_RENDEZVOUS_TIMEOUT_MS);
  try {
    const [code] = await once(worker, 'exit', { signal: controller.signal });
    return code;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Timed out waiting for worker exit', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function restoreDisplacedDirectory(parentPath, displacedPath) {
  if (!fs.existsSync(displacedPath)) return;
  fs.rmSync(parentPath, { recursive: true, force: true });
  fs.renameSync(displacedPath, parentPath);
}

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

test('writeFileNoFollow revalidates the parent realpath after exclusive temp creation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-outside-'));
  const parentPath = path.join(root, 'generated');
  const displacedPath = path.join(root, 'generated-original');
  const destination = path.join(parentPath, 'index.html');
  const originalOpenSync = fs.openSync;
  let swapped = false;

  try {
    fs.mkdirSync(parentPath);
    fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'outside must remain unchanged');
    fs.openSync = (filePath, ...args) => {
      if (
        !swapped &&
        typeof filePath === 'string' &&
        path.dirname(filePath) === parentPath &&
        path.basename(filePath).startsWith('.safe-output-')
      ) {
        fs.renameSync(parentPath, displacedPath);
        fs.symlinkSync(outside, parentPath);
        swapped = true;
      }
      return Reflect.apply(originalOpenSync, fs, [filePath, ...args]);
    };

    assert.throws(
      () => writeFileNoFollow(root, destination, 'generated'),
      /output parent changed during write/
    );
    assert.equal(swapped, true);
    assert.deepEqual(fs.readdirSync(outside), ['sentinel.txt']);
    assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside must remain unchanged');
  } finally {
    fs.openSync = originalOpenSync;
    restoreDisplacedDirectory(parentPath, displacedPath);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('writeFileNoFollow revalidates the parent inode after same-path replacement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const parentPath = path.join(root, 'generated');
  const displacedPath = path.join(root, 'generated-original');
  const destination = path.join(parentPath, 'index.html');
  const originalOpenSync = fs.openSync;
  let swapped = false;

  try {
    fs.mkdirSync(parentPath);
    fs.writeFileSync(destination, 'previous complete page');
    fs.openSync = (filePath, ...args) => {
      if (
        !swapped &&
        typeof filePath === 'string' &&
        path.dirname(filePath) === parentPath &&
        path.basename(filePath).startsWith('.safe-output-')
      ) {
        fs.renameSync(parentPath, displacedPath);
        fs.mkdirSync(parentPath);
        swapped = true;
      }
      return Reflect.apply(originalOpenSync, fs, [filePath, ...args]);
    };

    assert.throws(
      () => writeFileNoFollow(root, destination, 'generated'),
      /output parent changed during write/
    );
    assert.equal(swapped, true);
    assert.deepEqual(fs.readdirSync(parentPath), []);
    assert.equal(fs.readFileSync(path.join(displacedPath, 'index.html'), 'utf8'), 'previous complete page');
  } finally {
    fs.openSync = originalOpenSync;
    restoreDisplacedDirectory(parentPath, displacedPath);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeFileNoFollow rejects a parent swapped outside during the temp write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-outside-'));
  const parentPath = path.join(root, 'generated');
  const displacedPath = path.join(root, 'generated-original');
  const destination = path.join(parentPath, 'index.html');
  const originalWriteFileSync = fs.writeFileSync;
  let swapped = false;

  try {
    fs.mkdirSync(parentPath);
    fs.writeFileSync(destination, 'previous complete page');
    fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'outside must remain unchanged');
    fs.writeFileSync = (file, ...args) => {
      const result = Reflect.apply(originalWriteFileSync, fs, [file, ...args]);
      if (!swapped && typeof file === 'number') {
        fs.renameSync(parentPath, displacedPath);
        fs.symlinkSync(outside, parentPath);
        swapped = true;
      }
      return result;
    };

    assert.throws(
      () => writeFileNoFollow(root, destination, 'generated'),
      /output parent changed during write/
    );
    assert.equal(swapped, true);
    assert.equal(fs.readFileSync(path.join(displacedPath, 'index.html'), 'utf8'), 'previous complete page');
    assert.deepEqual(fs.readdirSync(outside), ['sentinel.txt']);
    assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside must remain unchanged');
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    restoreDisplacedDirectory(parentPath, displacedPath);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('writeFileNoFollow revalidates the parent immediately before rename', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-outside-'));
  const parentPath = path.join(root, 'generated');
  const displacedPath = path.join(root, 'generated-original');
  const destination = path.join(parentPath, 'index.html');
  const originalLstatSync = fs.lstatSync;
  let temporaryChecks = 0;
  let swapped = false;

  try {
    fs.mkdirSync(parentPath);
    fs.writeFileSync(destination, 'previous complete page');
    fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'outside must remain unchanged');
    fs.lstatSync = (filePath, ...args) => {
      const stats = Reflect.apply(originalLstatSync, fs, [filePath, ...args]);
      if (
        !swapped &&
        typeof filePath === 'string' &&
        path.dirname(filePath) === parentPath &&
        path.basename(filePath).startsWith('.safe-output-')
      ) {
        temporaryChecks += 1;
        if (temporaryChecks === 2) {
          fs.renameSync(parentPath, displacedPath);
          fs.symlinkSync(outside, parentPath);
          swapped = true;
        }
      }
      return stats;
    };

    assert.throws(
      () => writeFileNoFollow(root, destination, 'generated'),
      /output parent changed during write/
    );
    assert.equal(swapped, true);
    assert.equal(fs.readFileSync(path.join(displacedPath, 'index.html'), 'utf8'), 'previous complete page');
    assert.deepEqual(fs.readdirSync(outside), ['sentinel.txt']);
    assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside must remain unchanged');
  } finally {
    fs.lstatSync = originalLstatSync;
    restoreDisplacedDirectory(parentPath, displacedPath);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('writeFileNoFollow revalidates a destination replaced with a symlink before publish', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-outside-'));
  const destination = path.join(root, 'index.html');
  const external = path.join(outside, 'external.html');
  const originalWriteFileSync = fs.writeFileSync;
  let swapped = false;

  try {
    fs.writeFileSync(destination, 'previous complete page');
    fs.writeFileSync(external, 'outside must remain unchanged');
    fs.writeFileSync = (file, ...args) => {
      const result = Reflect.apply(originalWriteFileSync, fs, [file, ...args]);
      if (!swapped && typeof file === 'number') {
        fs.unlinkSync(destination);
        fs.symlinkSync(external, destination);
        swapped = true;
      }
      return result;
    };

    assert.throws(
      () => writeFileNoFollow(root, destination, 'generated'),
      /refusing to follow an output symlink/
    );
    assert.equal(swapped, true);
    assert.equal(fs.readFileSync(external, 'utf8'), 'outside must remain unchanged');
    assert.equal(fs.lstatSync(destination).isSymbolicLink(), true);
    assert.deepEqual(fs.readdirSync(root), ['index.html']);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('writeFileNoFollow enforces expected destination identity immediately before publish', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const destination = path.join(root, 'index.html');
  const replacement = 'replacement owned by another actor';

  try {
    fs.writeFileSync(destination, 'validated prior page');
    const expectedStats = fs.lstatSync(destination, { bigint: true });
    assert.throws(
      () => writeFileNoFollow(root, destination, 'generated page', 'generated index', {
        expectedDestination: { existed: true, stats: expectedStats },
        beforeFinalDestinationCheck() {
          fs.unlinkSync(destination);
          fs.writeFileSync(destination, replacement);
        }
      }),
      /destination changed before publish/
    );
    assert.equal(fs.readFileSync(destination, 'utf8'), replacement);
    assert.deepEqual(fs.readdirSync(root), ['index.html']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeFileNoFollow never unlinks a replacement at its owned temporary path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const destination = path.join(root, 'index.html');
  const heldTemporary = path.join(root, 'held-owned-temp');
  const originalWriteFileSync = fs.writeFileSync;
  let temporaryPath;

  try {
    fs.writeFileSync(destination, 'previous complete page');
    fs.writeFileSync = (file, ...args) => {
      const result = Reflect.apply(originalWriteFileSync, fs, [file, ...args]);
      if (temporaryPath === undefined && typeof file === 'number') {
        const temporaryName = fs.readdirSync(root).find((name) => name.startsWith('.safe-output-'));
        assert.ok(temporaryName);
        temporaryPath = path.join(root, temporaryName);
        fs.renameSync(temporaryPath, heldTemporary);
        Reflect.apply(originalWriteFileSync, fs, [temporaryPath, 'attacker replacement']);
      }
      return result;
    };

    assert.throws(
      () => writeFileNoFollow(root, destination, 'generated'),
      /temporary destination changed during write/
    );
    assert.equal(fs.readFileSync(destination, 'utf8'), 'previous complete page');
    assert.equal(fs.readFileSync(heldTemporary, 'utf8'), 'generated');
    assert.equal(fs.readFileSync(temporaryPath, 'utf8'), 'attacker replacement');
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeFileNoFollow replaces a hard-linked destination without changing the outside inode', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-outside-'));
  const destination = path.join(root, 'index.html');
  const external = path.join(outside, 'external.html');

  try {
    fs.writeFileSync(external, 'outside must remain unchanged');
    fs.linkSync(external, destination);

    writeFileNoFollow(root, destination, 'new generated page', 'generated index');

    assert.equal(fs.readFileSync(external, 'utf8'), 'outside must remain unchanged');
    assert.equal(fs.readFileSync(destination, 'utf8'), 'new generated page');
    assert.notEqual(fs.statSync(destination).ino, fs.statSync(external).ino);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('writeFileNoFollow rejects escaped, non-regular, and unresolvable destinations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-outside-'));
  const directoryDestination = path.join(root, 'directory-output');
  fs.mkdirSync(directoryDestination);

  try {
    assert.throws(
      () => writeFileNoFollow(root, path.join(outside, 'escaped.html'), 'generated'),
      /path escapes its allowed root/
    );
    assert.throws(
      () => writeFileNoFollow(root, directoryDestination, 'generated'),
      /destination is not a regular file/
    );
    assert.throws(
      () => writeFileNoFollow(root, path.join(root, 'missing', 'page.html'), 'generated'),
      /Unsafe output parent: could not resolve/
    );

    const missingRoot = path.join(outside, 'missing-root');
    assert.throws(
      () => writeFileNoFollow(missingRoot, path.join(missingRoot, 'page.html'), 'generated'),
      /Unsafe output root: could not resolve/
    );
    assert.equal(fs.existsSync(path.join(outside, 'escaped.html')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('writeFileNoFollow removes its exclusive temporary file when a write fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const destination = path.join(root, 'index.html');

  try {
    fs.writeFileSync(destination, 'previous complete page');
    assert.throws(() => writeFileNoFollow(root, destination, Symbol('invalid bytes')));
    assert.equal(fs.readFileSync(destination, 'utf8'), 'previous complete page');
    assert.deepEqual(fs.readdirSync(root), ['index.html']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeFileNoFollow never removes a colliding temporary file it does not own', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const destination = path.join(root, 'index.html');
  const collisionPath = path.join(root, `.safe-output-${process.pid}-${'00'.repeat(16)}.tmp`);
  const originalRandomBytes = crypto.randomBytes;

  try {
    fs.writeFileSync(collisionPath, 'owned by another writer');
    crypto.randomBytes = () => Buffer.alloc(16);

    assert.throws(
      () => writeFileNoFollow(root, destination, 'generated'),
      /could not reserve a temporary output file/
    );
    assert.equal(fs.readFileSync(collisionPath, 'utf8'), 'owned by another writer');
    assert.equal(fs.existsSync(destination), false);
  } finally {
    crypto.randomBytes = originalRandomBytes;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('concurrent writeFileNoFollow calls publish exactly one complete payload', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-output-root-'));
  const destination = path.join(root, 'index.html');
  const modulePath = require.resolve('../../scripts/lib/safe-output.cjs');
  const payloads = Array.from({ length: 6 }, (_, index) => {
    const marker = String.fromCharCode(65 + index);
    return `payload-${index}\n${marker.repeat(512 * 1024)}\nend-${index}`;
  });
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { writeFileNoFollow } = require(workerData.modulePath);
    parentPort.once('message', () => {
      writeFileNoFollow(workerData.root, workerData.destination, workerData.payload, 'concurrent output');
      parentPort.postMessage({ type: 'done' });
    });
    parentPort.postMessage({ type: 'ready' });
  `;
  const workers = [];

  try {
    fs.writeFileSync(destination, 'previous complete page');
    payloads.forEach((payload) => {
      workers.push(new Worker(workerSource, {
        eval: true,
        workerData: { destination, modulePath, payload, root }
      }));
    });
    await Promise.all(workers.map((worker) => waitForWorkerMessage(worker, 'ready')));

    const exits = Promise.all(workers.map((worker) => waitForWorkerExit(worker)));
    const completions = Promise.all(workers.map((worker) => waitForWorkerMessage(worker, 'done')));
    const completedWrites = Promise.all([completions, exits]);
    workers.forEach((worker) => worker.postMessage({ type: 'write' }));

    const [, exitCodes] = await completedWrites;
    assert.ok(exitCodes.every((code) => code === 0));

    const published = fs.readFileSync(destination, 'utf8');
    assert.ok(payloads.includes(published), 'the published output must equal one complete writer payload');
    assert.deepEqual(fs.readdirSync(root), ['index.html']);
  } finally {
    await Promise.allSettled(workers.map((worker) => worker.terminate()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
