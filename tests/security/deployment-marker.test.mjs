import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deploymentMarker, writeDeploymentMarker } from '../../scripts/write-deployment-marker.mjs';

const head = 'a'.repeat(40);
const env = { CF_PAGES: '1', CF_PAGES_COMMIT_SHA: head, CF_PAGES_BRANCH: 'main', CF_PAGES_URL: 'https://a3bc584f.projectportfolio.pages.dev' };

test('deployment marker binds provider identity to actual Git HEAD and rejects malformed build metadata', () => {
  assert.deepEqual(deploymentMarker(env, head), { schemaVersion: 1, repository: 'leonardwongly/ProjectPortfolio', sha: head, branch: 'main', previewOrigin: env.CF_PAGES_URL });
  for (const overrides of [ { CF_PAGES: undefined }, { CF_PAGES_COMMIT_SHA: 'b'.repeat(40) },
    { CF_PAGES_BRANCH: 'main\ninjection' }, { CF_PAGES_BRANCH: '' },
    { CF_PAGES_URL: 'https://main.projectportfolio.pages.dev' }, { CF_PAGES_URL: 'https://a3bc584f.projectportfolio.pages.dev/path' } ]) {
    assert.throws(() => deploymentMarker({ ...env, ...overrides }, head));
  }
});

test('Pages-only marker writes are bounded and refuse symlink destinations', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-marker-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, '.well-known'));
  const git = (command, args, options) => {
    assert.equal(command, 'git');
    assert.deepEqual(args, ['--no-replace-objects', 'rev-parse', 'HEAD']);
    assert.equal(options.timeout, 10000);
    return `${head}\n`;
  };
  const marker = writeDeploymentMarker({ cwd, env, git });
  const file = path.join(cwd, '.well-known/deployment.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), marker);
  fs.unlinkSync(file);
  fs.symlinkSync('../outside.json', file);
  assert.throws(() => writeDeploymentMarker({ cwd, env, git }), /symlink/);
});
