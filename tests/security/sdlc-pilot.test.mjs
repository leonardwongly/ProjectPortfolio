import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GATES, parseArgs, validateRequirements, snapshot, runPilot } from '../../scripts/sdlc-pilot.mjs';

const requirements = {
  id: 'fixture', goal: 'Bounded fixture', scope: ['Implement a fixture'], exclusions: ['No external writes'],
  acceptance: [{ id: 'OK', description: 'Inspect existing validation evidence', gate: 'local' }]
};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-pilot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-b', 'pilot-fixture');
  git('remote', 'add', 'origin', 'https://github.com/leonardwongly/ProjectPortfolio.git');
  fs.writeFileSync(path.join(root, '.gitignore'), 'artifacts/\n');
  fs.writeFileSync(path.join(root, 'requirements.json'), JSON.stringify(requirements));
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  return { root, git };
}

test('pilot inputs cannot select arbitrary commands or expand scope silently', () => {
  assert.deepEqual(parseArgs(['preflight', '--full']), { command: 'preflight', requirements: 'docs/sdlc/pilot-requirements.json', full: true });
  assert.throws(() => parseArgs(['deploy']), /Usage/);
  assert.throws(() => parseArgs(['prepare', '--full']), /requires preflight/);
  assert.throws(() => parseArgs(['preflight', '--run', 'curl']), /Unknown/);
  assert.throws(() => validateRequirements({ ...requirements, command: 'git push' }), /Unknown/);
  assert.throws(() => validateRequirements({ ...requirements, id: '../outside' }), /slug/);
  assert.throws(() => validateRequirements({ ...requirements, acceptance: [{ ...requirements.acceptance[0], gate: 'git push' }] }), /gate/);
  assert.throws(() => validateRequirements({ ...requirements, acceptance: [...requirements.acceptance, ...requirements.acceptance] }), /unique/);
  assert.throws(() => validateRequirements({ ...requirements, goal: 'bad\ncontrol' }), /single-line/);
});

test('packet preparation runs no gates and snapshot binds tracked and untracked bytes', (t) => {
  const { root } = fixture(t);
  const before = snapshot(root);
  const packet = runPilot({ command: 'prepare', requirements: 'requirements.json' }, { cwd: root, run: () => { throw new Error('Must not execute'); } });
  assert.equal(packet.evidence, undefined);
  assert.match(fs.readFileSync(path.join(packet.directory, 'review-packet.md'), 'utf8'), /not run/);
  assert.equal(snapshot(root).sourceSha256, before.sourceSha256);
  fs.writeFileSync(path.join(root, 'new-file.txt'), 'changed');
  assert.notEqual(snapshot(root).sourceSha256, before.sourceSha256);
});

test('failed preflight stops immediately and cannot emit a passing packet', (t) => {
  const { root } = fixture(t);
  const calls = [];
  const result = runPilot({ command: 'preflight', requirements: 'requirements.json' }, { cwd: root, run: (command, args, options) => {
    calls.push({ command, args });
    assert.equal(options.shell, false);
    assert.equal(options.env.npm_config_ignore_scripts, 'true');
    assert.equal(options.timeout, 30 * 60 * 1000);
    return { status: 1 };
  } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { command: 'npm', args: ['run', 'validate'] });
  assert.equal(result.evidence.status, 'failed');
  assert.match(fs.readFileSync(path.join(result.directory, 'evidence.json'), 'utf8'), /"passed": false/);
});

test('full mode runs only the existing full gate and stale source invalidates evidence', (t) => {
  const { root } = fixture(t);
  const result = runPilot({ command: 'preflight', requirements: 'requirements.json', full: true }, { cwd: root, run: (command, args) => {
    assert.deepEqual(args, ['run', 'validate:full']);
    fs.writeFileSync(path.join(root, 'changed.txt'), 'concurrent edit');
    return { status: 0 };
  } });
  assert.equal(result.evidence.sourceChangedDuringRun, true);
  assert.equal(result.evidence.status, 'failed');
  const retry = runPilot({ command: 'preflight', requirements: 'requirements.json', full: true }, { cwd: root, run: () => ({ status: 0 }) });
  assert.notEqual(retry.directory, result.directory);
  assert.equal(retry.evidence.status, 'passed');
  assert.deepEqual(GATES.full, ['validate:full']);
});

test('repository, main branch and filesystem boundaries fail closed', (t) => {
  const { root, git } = fixture(t);
  assert.throws(() => runPilot({ command: 'prepare', requirements: '../outside.json' }, { cwd: root }), /inside the repository/);
  fs.symlinkSync('requirements.json', path.join(root, 'linked.json'));
  assert.throws(() => runPilot({ command: 'prepare', requirements: 'linked.json' }, { cwd: root }), /symbolic link/);
  fs.unlinkSync(path.join(root, 'linked.json'));
  git('remote', 'set-url', 'origin', 'https://github.com/leonardwongly/ProjectPortfolio-beta.git');
  assert.throws(() => snapshot(root), /verified ProjectPortfolio/);
  git('remote', 'set-url', 'origin', 'https://github.com/leonardwongly/ProjectPortfolio.git');
  git('branch', '-m', 'main');
  assert.throws(() => snapshot(root), /isolated named branch/);
  git('branch', '-m', 'pilot-fixture');
  fs.symlinkSync(os.tmpdir(), path.join(root, 'artifacts'));
  assert.throws(() => runPilot({ command: 'prepare', requirements: 'requirements.json' }, { cwd: root }), /symbolic link/);
});
