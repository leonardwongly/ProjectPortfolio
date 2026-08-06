import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  run,
  sanitizeCoverRelativePath,
  resolveProjectPath,
  assertSafeSourceFile,
  writeGeneratedFileNoFollow,
  toWebpPath
} = require('../../scripts/generate-book-webp.js');
const { AssetPathValidationError } = require('../../scripts/lib/asset-paths.cjs');

const silentLogger = {
  log() {},
  warn() {}
};

function createRunFixture(reading) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-run-'));
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-tmp-'));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'reading.json'), JSON.stringify(reading));
  return { root, temporaryRoot };
}

function conversionPaths(args) {
  const outputFlagIndex = args.indexOf('-o');
  assert.notEqual(outputFlagIndex, -1);
  return {
    source: args[outputFlagIndex - 1],
    output: args[outputFlagIndex + 1]
  };
}

test('sanitizeCoverRelativePath accepts safe relative JPEG paths', () => {
  assert.equal(
    sanitizeCoverRelativePath('book/2025/secure-design-300.jpg', 'reading[0].cover'),
    'book/2025/secure-design-300.jpg'
  );
  assert.equal(
    sanitizeCoverRelativePath('book/2025/secure-design.jpeg', 'reading[1].cover'),
    'book/2025/secure-design.jpeg'
  );
});

test('sanitizeCoverRelativePath rejects traversal and encoded traversal', () => {
  assert.throws(
    () => sanitizeCoverRelativePath('../etc/passwd.jpg', 'reading[0].cover'),
    /path traversal|dot segments/i
  );
  assert.throws(
    () => sanitizeCoverRelativePath('book/%2e%2e/secret.jpg', 'reading[1].cover'),
    /dot segments|path traversal/i
  );
});

test('sanitizeCoverRelativePath rejects absolute and scheme paths', () => {
  assert.throws(
    () => sanitizeCoverRelativePath('/tmp/cover.jpg', 'reading[0].cover'),
    /must be relative/i
  );
  assert.throws(
    () => sanitizeCoverRelativePath('file:///tmp/cover.jpg', 'reading[1].cover'),
    /URI schemes are not allowed/i
  );
  assert.throws(
    () => sanitizeCoverRelativePath('https://example.com/cover.jpg', 'reading[2].cover'),
    /URI schemes are not allowed/i
  );
});

test('sanitizeCoverRelativePath rejects non-jpeg and query paths', () => {
  assert.throws(
    () => sanitizeCoverRelativePath('book/2025/cover.png', 'reading[0].cover'),
    /must end in \.jpg or \.jpeg/i
  );
  assert.throws(
    () => sanitizeCoverRelativePath('book/2025/cover.jpg?download=1', 'reading[1].cover'),
    /query strings and fragments are not allowed/i
  );
});

test('resolveProjectPath enforces root containment', () => {
  const rootPath = path.resolve('/tmp/project-portfolio-test');
  const safe = resolveProjectPath(rootPath, 'book/2025/cover.jpg', 'source');

  assert.equal(safe, path.join(rootPath, 'book/2025/cover.jpg'));
  assert.throws(
    () => resolveProjectPath(rootPath, '../../etc/passwd', 'source'),
    /escapes project root/i
  );
});

test('run opens bounded reading data no-follow and nonblocking and rejects non-regular files', () => {
  const { root, temporaryRoot } = createRunFixture([]);
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-reading-external-'));
  const dataPath = path.join(root, 'data', 'reading.json');
  const externalDataPath = path.join(externalRoot, 'reading.json');
  const execFileSync = () => {};
  const openedFlags = [];
  const openReadingDataSync = (filePath, flags) => {
    openedFlags.push(flags);
    return fs.openSync(filePath, flags);
  };
  try {
    const exactResult = run({
      projectRoot: root,
      temporaryRoot,
      maxReadingDataBytes: 2,
      logger: silentLogger,
      execFileSync,
      openReadingDataSync
    });
    assert.deepEqual(exactResult, { converted: [], skipped: [], missing: [] });

    fs.writeFileSync(dataPath, '[] ');
    assert.throws(
      () => run({
        projectRoot: root,
        temporaryRoot,
        maxReadingDataBytes: 2,
        logger: silentLogger,
        execFileSync,
        openReadingDataSync
      }),
      /reading data exceeds byte budget 2.*found 3/i
    );

    fs.writeFileSync(externalDataPath, '[]');
    fs.unlinkSync(dataPath);
    fs.symlinkSync(externalDataPath, dataPath);
    assert.throws(
      () => run({
        projectRoot: root,
        temporaryRoot,
        maxReadingDataBytes: 2,
        logger: silentLogger,
        execFileSync,
        openReadingDataSync
      }),
      /reading data must be a readable regular, non-symlink file/i
    );
    assert.equal(fs.readFileSync(externalDataPath, 'utf8'), '[]');

    fs.unlinkSync(dataPath);
    fs.mkdirSync(dataPath);
    assert.throws(
      () => run({
        projectRoot: root,
        temporaryRoot,
        maxReadingDataBytes: 2,
        logger: silentLogger,
        execFileSync,
        openReadingDataSync
      }),
      /reading data must be .*regular file/i
    );

    const expectedOpenFlags =
      (fs.constants.O_NOFOLLOW || 0) |
      (fs.constants.O_NONBLOCK || 0);
    assert.equal(openedFlags.length, 4);
    for (const flags of openedFlags) {
      assert.equal(flags & expectedOpenFlags, expectedOpenFlags);
    }
    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('assertSafeSourceFile rejects a source symlink that resolves outside the project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-source-test-'));
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-source-external-'));
  const source = path.join(root, 'book', 'cover.jpg');
  const external = path.join(externalRoot, 'private.jpg');
  try {
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(external, 'external image');
    fs.symlinkSync(external, source);
    assert.throws(() => assertSafeSourceFile(source, root), /non-symlink|symlink/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('run rejects a hard-linked source before conversion and preserves the outside file', () => {
  const { root, temporaryRoot } = createRunFixture([{ cover: 'book/linked.jpg' }]);
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-source-external-'));
  const external = path.join(externalRoot, 'outside.jpg');
  const source = path.join(root, 'book', 'linked.jpg');
  const calls = [];
  try {
    fs.mkdirSync(path.dirname(source));
    fs.writeFileSync(external, 'outside-bytes');
    fs.linkSync(external, source);

    const result = run({
      projectRoot: root,
      temporaryRoot,
      logger: silentLogger,
      execFileSync(command, args) {
        calls.push({ command, args });
      }
    });

    assert.deepEqual(result.converted, []);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ['-version']);
    assert.equal(fs.readFileSync(external, 'utf8'), 'outside-bytes');
    assert.equal(fs.existsSync(path.join(root, 'book', 'linked.webp')), false);
    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('run rejects a non-regular source before conversion', () => {
  const { root, temporaryRoot } = createRunFixture([{ cover: 'book/directory.jpg' }]);
  const source = path.join(root, 'book', 'directory.jpg');
  let conversionCalls = 0;
  try {
    fs.mkdirSync(source, { recursive: true });

    const result = run({
      projectRoot: root,
      temporaryRoot,
      logger: silentLogger,
      execFileSync(command, args) {
        if (args[0] !== '-version') {
          conversionCalls += 1;
        }
      }
    });

    assert.deepEqual(result.converted, []);
    assert.equal(conversionCalls, 0);
    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('run converts an exact-budget private snapshot and skips empty or max-plus-one sources', () => {
  const maxSourceBytes = 8;
  const exactRelative = 'book/exact.jpg';
  const emptyRelative = 'book/empty.jpg';
  const oversizedRelative = 'book/oversized.jpg';
  const { root, temporaryRoot } = createRunFixture([
    { cover: exactRelative },
    { cover: emptyRelative },
    { cover: oversizedRelative }
  ]);
  const exactSource = path.join(root, exactRelative);
  const emptySource = path.join(root, emptyRelative);
  const oversizedSource = path.join(root, oversizedRelative);
  const convertedInputs = [];
  const cwebpInvocations = [];
  try {
    fs.mkdirSync(path.dirname(exactSource));
    fs.writeFileSync(exactSource, Buffer.alloc(maxSourceBytes, 0x41));
    fs.writeFileSync(emptySource, Buffer.alloc(0));
    fs.writeFileSync(oversizedSource, Buffer.alloc(maxSourceBytes + 1, 0x42));

    const result = run({
      projectRoot: root,
      temporaryRoot,
      maxSourceBytes,
      maxGeneratedBytes: 8,
      cwebpTimeoutMs: 1234,
      logger: silentLogger,
      execFileSync(command, args, options) {
        cwebpInvocations.push({ command, args, options });
        if (args[0] === '-version') {
          return;
        }
        const paths = conversionPaths(args);
        convertedInputs.push(paths.source);
        assert.notEqual(paths.source, exactSource);
        assert.equal(path.dirname(paths.source).startsWith(fs.realpathSync(temporaryRoot)), true);
        assert.deepEqual(fs.readFileSync(paths.source), Buffer.alloc(maxSourceBytes, 0x41));
        fs.writeFileSync(paths.output, Buffer.alloc(8, 0x57));
      }
    });

    assert.deepEqual(result.converted, ['book/exact.webp']);
    assert.equal(convertedInputs.length, 1);
    assert.deepEqual(
      cwebpInvocations.map(({ command, options }) => ({ command, options })),
      [
        {
          command: 'cwebp',
          options: { stdio: 'ignore', timeout: 1234, killSignal: 'SIGKILL' }
        },
        {
          command: 'cwebp',
          options: { stdio: 'inherit', timeout: 1234, killSignal: 'SIGKILL' }
        }
      ]
    );
    assert.deepEqual(fs.readFileSync(path.join(root, 'book', 'exact.webp')), Buffer.alloc(8, 0x57));
    assert.equal(fs.existsSync(path.join(root, 'book', 'empty.webp')), false);
    assert.equal(fs.existsSync(path.join(root, 'book', 'oversized.webp')), false);
    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('run isolates conversion from source-path replacement races', () => {
  const relativeSource = 'book/racy.jpg';
  const { root, temporaryRoot } = createRunFixture([{ cover: relativeSource }]);
  const source = path.join(root, relativeSource);
  const originalBytes = Buffer.from('original-source');
  const replacementBytes = Buffer.from('replacement-data');
  try {
    fs.mkdirSync(path.dirname(source));
    fs.writeFileSync(source, originalBytes);

    const result = run({
      projectRoot: root,
      temporaryRoot,
      logger: silentLogger,
      execFileSync(command, args) {
        if (args[0] === '-version') {
          return;
        }
        const paths = conversionPaths(args);
        fs.writeFileSync(source, replacementBytes);
        assert.deepEqual(fs.readFileSync(paths.source), originalBytes);
        fs.writeFileSync(paths.output, 'converted');
      }
    });

    assert.deepEqual(result.converted, ['book/racy.webp']);
    assert.deepEqual(fs.readFileSync(source), replacementBytes);
    assert.equal(fs.readFileSync(path.join(root, 'book', 'racy.webp'), 'utf8'), 'converted');
    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('toWebpPath preserves location and swaps extension', () => {
  assert.equal(toWebpPath('book/2025/cover-300.jpg'), 'book/2025/cover-300.webp');
  assert.equal(toWebpPath('book/2025/cover.jpeg'), 'book/2025/cover.webp');
});

test('writeGeneratedFileNoFollow rejects dangling output symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const outputDirectory = path.join(root, 'book');
  const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-external-'));
  const source = path.join(root, 'generated.webp');
  const target = path.join(outputDirectory, 'cover.webp');
  const escaped = path.join(externalDirectory, 'escaped.webp');
  fs.mkdirSync(outputDirectory);
  fs.writeFileSync(source, 'valid-generated-bytes');
  fs.symlinkSync(escaped, target);

  try {
    assert.throws(
      () => writeGeneratedFileNoFollow(source, target, root),
      (error) => error?.code === 'EEXIST' || error?.code === 'ELOOP'
    );
    assert.equal(fs.existsSync(escaped), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(externalDirectory, { recursive: true, force: true });
  }
});

test('writeGeneratedFileNoFollow allows targets located directly in the project root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const source = path.join(root, 'generated.webp');
  const target = path.join(root, 'cover.webp');
  fs.writeFileSync(source, 'root-level-bytes');

  try {
    writeGeneratedFileNoFollow(source, target, root);
    assert.equal(fs.readFileSync(target, 'utf8'), 'root-level-bytes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeGeneratedFileNoFollow refuses to overwrite an existing regular file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const outputDirectory = path.join(root, 'book');
  const source = path.join(root, 'generated.webp');
  const target = path.join(outputDirectory, 'cover.webp');
  fs.mkdirSync(outputDirectory);
  fs.writeFileSync(source, 'new-bytes');
  fs.writeFileSync(target, 'existing-bytes');

  try {
    assert.throws(
      () => writeGeneratedFileNoFollow(source, target, root),
      (error) => error?.code === 'EEXIST'
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'existing-bytes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeGeneratedFileNoFollow rejects target directories that resolve outside the project root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-external-'));
  const source = path.join(root, 'generated.webp');
  const linkedDirectory = path.join(root, 'book');
  const target = path.join(linkedDirectory, 'cover.webp');
  fs.writeFileSync(source, 'valid-generated-bytes');
  fs.symlinkSync(externalDirectory, linkedDirectory);

  try {
    assert.throws(
      () => writeGeneratedFileNoFollow(source, target, root),
      (error) => error instanceof AssetPathValidationError &&
        /target parent resolves outside project root/.test(error.message)
    );
    assert.equal(fs.existsSync(path.join(externalDirectory, 'cover.webp')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(externalDirectory, { recursive: true, force: true });
  }
});

test('writeGeneratedFileNoFollow revalidates a parent swap injected before final validation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-external-'));
  const source = path.join(root, 'generated.webp');
  const targetDirectory = path.join(root, 'book');
  const movedTargetDirectory = path.join(root, 'book-before-open');
  const target = path.join(targetDirectory, 'cover.webp');
  let seamCalled = false;
  fs.mkdirSync(targetDirectory);
  fs.writeFileSync(source, 'valid-generated-bytes');

  try {
    assert.throws(
      () => writeGeneratedFileNoFollow(source, target, root, {
        beforeFinalTargetValidation() {
          seamCalled = true;
          fs.renameSync(targetDirectory, movedTargetDirectory);
          fs.symlinkSync(externalDirectory, targetDirectory);
        }
      }),
      /target parent resolves outside project root/i
    );
    assert.equal(seamCalled, true);
    assert.equal(fs.existsSync(path.join(externalDirectory, 'cover.webp')), false);
    assert.equal(fs.existsSync(path.join(movedTargetDirectory, 'cover.webp')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(externalDirectory, { recursive: true, force: true });
  }
});

test('writeGeneratedFileNoFollow never unlinks a replacement inode after a write failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-external-'));
  const source = path.join(root, 'generated.webp');
  const targetDirectory = path.join(root, 'book');
  const target = path.join(targetDirectory, 'cover.webp');
  const movedPartialTarget = path.join(root, 'created-partial.webp');
  const outsideSentinel = path.join(externalDirectory, 'sentinel.webp');
  fs.mkdirSync(targetDirectory);
  fs.writeFileSync(source, 'valid-generated-bytes');
  fs.writeFileSync(outsideSentinel, 'outside-sentinel');

  try {
    assert.throws(
      () => writeGeneratedFileNoFollow(source, target, root, {
        writeFileSync(descriptor, bytes) {
          fs.writeFileSync(descriptor, bytes.subarray(0, 4));
          fs.renameSync(target, movedPartialTarget);
          fs.linkSync(outsideSentinel, target);
          throw new Error('synthetic target replacement');
        }
      }),
      /synthetic target replacement/
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'outside-sentinel');
    assert.equal(fs.readFileSync(outsideSentinel, 'utf8'), 'outside-sentinel');
    assert.equal(fs.readFileSync(movedPartialTarget, 'utf8'), 'vali');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(externalDirectory, { recursive: true, force: true });
  }
});

test('writeGeneratedFileNoFollow preserves binary content exactly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const outputDirectory = path.join(root, 'book');
  const source = path.join(root, 'generated.webp');
  const target = path.join(outputDirectory, 'cover.webp');
  fs.mkdirSync(outputDirectory);
  const binaryBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x80, 0x01]);
  fs.writeFileSync(source, binaryBytes);

  try {
    writeGeneratedFileNoFollow(source, target, root);
    assert.deepEqual(fs.readFileSync(target), binaryBytes);
    assert.equal(fs.lstatSync(target).isFile(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeGeneratedFileNoFollow accepts the byte limit and rejects empty or max-plus-one output before publishing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-test-'));
  const outputDirectory = path.join(root, 'book');
  const emptySource = path.join(root, 'empty-generated.webp');
  const exactSource = path.join(root, 'exact-generated.webp');
  const oversizedSource = path.join(root, 'oversized-generated.webp');
  const emptyTarget = path.join(outputDirectory, 'empty.webp');
  const exactTarget = path.join(outputDirectory, 'exact.webp');
  const oversizedTarget = path.join(outputDirectory, 'oversized.webp');
  const maxBytes = 8;
  fs.mkdirSync(outputDirectory);
  fs.writeFileSync(emptySource, Buffer.alloc(0));
  fs.writeFileSync(exactSource, Buffer.alloc(maxBytes, 0x45));
  fs.writeFileSync(oversizedSource, Buffer.alloc(maxBytes + 1, 0x4f));

  try {
    assert.throws(
      () => writeGeneratedFileNoFollow(emptySource, emptyTarget, root, { maxBytes }),
      /generated output must not be empty/i
    );
    assert.equal(fs.existsSync(emptyTarget), false);
    writeGeneratedFileNoFollow(exactSource, exactTarget, root, { maxBytes });
    assert.deepEqual(fs.readFileSync(exactTarget), Buffer.alloc(maxBytes, 0x45));
    assert.throws(
      () => writeGeneratedFileNoFollow(oversizedSource, oversizedTarget, root, { maxBytes }),
      /generated output exceeds byte budget 8.*found 9/i
    );
    assert.equal(fs.existsSync(oversizedTarget), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('run removes private snapshots and leaves no target when cwebp fails', () => {
  const relativeSource = 'book/failure.jpg';
  const { root, temporaryRoot } = createRunFixture([{ cover: relativeSource }]);
  const source = path.join(root, relativeSource);
  let capturedTemporaryDirectory;
  try {
    fs.mkdirSync(path.dirname(source));
    fs.writeFileSync(source, 'source-bytes');

    assert.throws(
      () => run({
        projectRoot: root,
        temporaryRoot,
        logger: silentLogger,
        execFileSync(command, args) {
          if (args[0] === '-version') {
            return;
          }
          const paths = conversionPaths(args);
          capturedTemporaryDirectory = path.dirname(paths.source);
          assert.equal(fs.existsSync(paths.source), true);
          throw new Error('synthetic cwebp failure');
        }
      }),
      /synthetic cwebp failure/
    );

    assert.equal(fs.existsSync(capturedTemporaryDirectory), false);
    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
    assert.equal(fs.existsSync(path.join(root, 'book', 'failure.webp')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('run removes its partial target and temp files after an injected publication failure', () => {
  const relativeSource = 'book/publication-failure.jpg';
  const { root, temporaryRoot } = createRunFixture([{ cover: relativeSource }]);
  const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-external-'));
  const source = path.join(root, relativeSource);
  const target = path.join(root, 'book', 'publication-failure.webp');
  const outsideSentinel = path.join(externalDirectory, 'sentinel.webp');
  try {
    fs.mkdirSync(path.dirname(source));
    fs.writeFileSync(source, 'source-bytes');
    fs.writeFileSync(outsideSentinel, 'outside-sentinel');

    assert.throws(
      () => run({
        projectRoot: root,
        temporaryRoot,
        logger: silentLogger,
        execFileSync(command, args) {
          if (args[0] === '-version') {
            return;
          }
          const paths = conversionPaths(args);
          fs.writeFileSync(paths.output, 'generated-output');
        },
        writeGeneratedFileSync(descriptor, bytes) {
          fs.writeFileSync(descriptor, bytes.subarray(0, 4));
          throw new Error('synthetic publication failure');
        }
      }),
      /synthetic publication failure/
    );

    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
    assert.equal(fs.readFileSync(outsideSentinel, 'utf8'), 'outside-sentinel');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    fs.rmSync(externalDirectory, { recursive: true, force: true });
  }
});

test('run cleans converter output that exceeds the generated byte budget', () => {
  const relativeSource = 'book/oversized-output.jpg';
  const { root, temporaryRoot } = createRunFixture([{ cover: relativeSource }]);
  const source = path.join(root, relativeSource);
  try {
    fs.mkdirSync(path.dirname(source));
    fs.writeFileSync(source, 'source');

    assert.throws(
      () => run({
        projectRoot: root,
        temporaryRoot,
        maxGeneratedBytes: 8,
        logger: silentLogger,
        execFileSync(command, args) {
          if (args[0] === '-version') {
            return;
          }
          const paths = conversionPaths(args);
          fs.writeFileSync(paths.output, Buffer.alloc(9));
        }
      }),
      /generated output exceeds byte budget 8.*found 9/i
    );

    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
    assert.equal(fs.existsSync(path.join(root, 'book', 'oversized-output.webp')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('run revalidates a target parent changed during conversion before publishing', () => {
  const relativeSource = 'book/parent-race.jpg';
  const { root, temporaryRoot } = createRunFixture([{ cover: relativeSource }]);
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-webp-external-'));
  const source = path.join(root, relativeSource);
  const originalBookDirectory = path.join(root, 'book');
  const movedBookDirectory = path.join(root, 'book-before-race');
  const outsideTarget = path.join(externalRoot, 'parent-race.webp');
  try {
    fs.mkdirSync(path.dirname(source));
    fs.writeFileSync(source, 'source');
    fs.writeFileSync(outsideTarget, 'outside-sentinel');

    assert.throws(
      () => run({
        projectRoot: root,
        temporaryRoot,
        logger: silentLogger,
        execFileSync(command, args) {
          if (args[0] === '-version') {
            return;
          }
          const paths = conversionPaths(args);
          fs.renameSync(originalBookDirectory, movedBookDirectory);
          fs.symlinkSync(externalRoot, originalBookDirectory);
          fs.writeFileSync(paths.output, 'converted');
        }
      }),
      /target parent resolves outside project root/i
    );

    assert.equal(fs.readFileSync(outsideTarget, 'utf8'), 'outside-sentinel');
    assert.equal(fs.existsSync(path.join(movedBookDirectory, 'parent-race.webp')), false);
    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
});
