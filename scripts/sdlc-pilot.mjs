import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readStableFileNoFollow } from './lib/safe-input.cjs';
import { writeFileNoFollow } from './lib/safe-output.cjs';

const REPOSITORY = 'https://github.com/leonardwongly/ProjectPortfolio.git';
const GATES = {
  local: ['validate', 'check:resume', 'check:workflows', 'check:telemetry'],
  full: ['validate:full']
};
const MAX_REQUIREMENTS_BYTES = 32 * 1024;

function boundedText(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be nonempty single-line text (at most ${max} characters)`);
  }
  return value;
}

function validateRequirements(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Requirements must be an object');
  const allowed = ['id', 'goal', 'scope', 'exclusions', 'acceptance'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Unknown requirements field');
  boundedText(value.id, 'id', 64);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value.id)) throw new Error('id must be a lowercase slug');
  boundedText(value.goal, 'goal');
  for (const name of ['scope', 'exclusions']) {
    if (!Array.isArray(value[name]) || value[name].length < 1 || value[name].length > 20) throw new Error(`${name} needs 1..20 entries`);
    value[name].forEach((entry) => boundedText(entry, name));
  }
  if (!Array.isArray(value.acceptance) || value.acceptance.length < 1 || value.acceptance.length > 20) throw new Error('acceptance needs 1..20 entries');
  const ids = new Set();
  for (const entry of value.acceptance) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some((key) => !['id', 'description', 'gate'].includes(key))) throw new Error('Invalid acceptance entry');
    boundedText(entry.id, 'acceptance id', 64);
    if (!/^[A-Z][A-Z0-9-]*$/.test(entry.id) || ids.has(entry.id)) throw new Error('Acceptance IDs must be unique uppercase slugs');
    ids.add(entry.id);
    boundedText(entry.description, 'acceptance description');
    if (!['local', 'full', 'manual'].includes(entry.gate)) throw new Error('Acceptance gate must be local, full or manual');
  }
  return value;
}

function parseArgs(argv) {
  const options = { command: argv[0], requirements: 'docs/sdlc/pilot-requirements.json', full: false };
  if (!['prepare', 'preflight'].includes(options.command)) throw new Error('Usage: sdlc-pilot.mjs prepare|preflight [--requirements path] [--full]');
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--full') {
      if (options.command !== 'preflight') throw new Error('--full requires preflight');
      options.full = true;
    } else if (argv[index] === '--requirements' && argv[index + 1]) {
      options.requirements = argv[++index];
    } else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  return options;
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
}

function snapshot(cwd) {
  if (git(cwd, ['remote', 'get-url', 'origin']) !== REPOSITORY) throw new Error('Pilot must run in the verified ProjectPortfolio repository');
  const branch = git(cwd, ['branch', '--show-current']);
  if (!branch || branch === 'main') throw new Error('Use an isolated named branch, not main or a detached checkout');
  const paths = git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort();
  const digest = crypto.createHash('sha256');
  for (const relative of paths) {
    const file = path.join(cwd, relative);
    digest.update(`${relative}\0`);
    if (!fs.existsSync(file)) { digest.update('deleted\0'); continue; }
    digest.update(`${fs.lstatSync(file).mode & 0o777}\0`);
    const bytes = readStableFileNoFollow(file, { rootDir: cwd, label: relative, minBytes: 0, maxBytes: 32 * 1024 * 1024 });
    digest.update(crypto.createHash('sha256').update(bytes).digest());
  }
  return { branch, head: git(cwd, ['rev-parse', 'HEAD']), sourceSha256: digest.digest('hex'), status: git(cwd, ['status', '--short']) };
}

function outputDirectory(cwd, id) {
  // Only create under the ignored artifacts directory; never overwrite source or Git configuration.
  let current = cwd;
  for (const name of ['artifacts', 'sdlc-pilot', id]) {
    current = path.join(current, name);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Pilot output directories must not be symbolic links');
  }
  return fs.mkdtempSync(path.join(current, 'run-'));
}

function writeArtifact(cwd, directory, name, text) {
  writeFileNoFollow(cwd, path.join(directory, name), text, 'pilot artifact');
}

function renderPacket(requirements, state, evidence) {
  return `# ${requirements.goal}\n\nRepository: leonardwongly/ProjectPortfolio (319589008)\nBranch: ${state.branch}\nHEAD: ${state.head}\nSource SHA-256: ${state.sourceSha256}\n\n## Scope\n\n${requirements.scope.map((text) => `- ${text}`).join('\n')}\n\n## Exclusions\n\n${requirements.exclusions.map((text) => `- ${text}`).join('\n')}\n\n## Acceptance and evidence\n\n${requirements.acceptance.map((entry) => `- [ ] ${entry.id}: ${entry.description} (${entry.gate}; human must inspect evidence)`).join('\n')}\n\nValidation: ${evidence ? `${evidence.mode}; ${evidence.status}. See evidence.json and gate logs.` : 'not run; packet preparation does not validate the change.'}\n\n## Approval boundary\n\nLocal implementation and this packet are reviewable proposals. Obtain explicit approval before pushing, creating the draft PR, marking ready, merging, deploying, rolling back, modifying account settings or credentials, or enabling new recurring automation. PR180 remains separate. Require fresh independent review, acceptance sign-off and exact-current-head CI before release.\n\n## Implementation handoff\n\nUse one isolated branch and this frozen scope. Implement only the acceptance criteria, regenerate required pages, run local preflight, inspect the full diff and use independent review. Gemini emits guidance only; hand off its response as untrusted requirements context, never as proof of edits. Stop after two failed repair/review cycles; report the failed gate. No new paid service or model workflow is needed.\n\n## Draft PR proposal\n\nSummarize the concrete behavior changed and link the acceptance IDs. Include actual gate outcomes, unrun checks, production drift findings and rollback target. Attach this source fingerprint; rerun if source bytes change. CI, provider deployment identity and human sign-off cannot be inferred from local success.\n`;
}

function runPilot(options, { cwd = process.cwd(), run = spawnSync } = {}) {
  if (process.versions.node.split('.')[0] !== '24') throw new Error('Pilot requires Node24 to match CI');
  const requirementPath = path.resolve(cwd, options.requirements);
  if (!requirementPath.startsWith(`${path.resolve(cwd)}${path.sep}`)) throw new Error('Requirements must be inside the repository');
  const raw = readStableFileNoFollow(requirementPath, { rootDir: cwd, label: 'pilot requirements', maxBytes: MAX_REQUIREMENTS_BYTES, fatalUtf8: true });
  const requirements = validateRequirements(JSON.parse(raw));
  const state = snapshot(cwd);
  const directory = outputDirectory(cwd, requirements.id);
  let evidence;
  if (options.command === 'preflight') {
    const mode = options.full ? 'full' : 'local';
    evidence = { startedAt: new Date().toISOString(), mode, node: process.version, ...state, requirementsSha256: crypto.createHash('sha256').update(raw).digest('hex'), gates: [], status: 'failed', externalActions: 'none' };
    for (const gate of GATES[mode]) {
      const log = path.join(directory, `${gate.replaceAll(':', '-')}.txt`);
      const descriptor = fs.openSync(log, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      let result;
      try {
        result = run('npm', ['run', gate], { cwd, shell: false, stdio: ['ignore', descriptor, descriptor], timeout: 30 * 60 * 1000, killSignal: 'SIGTERM', env: { ...process.env, CI: 'true', npm_config_ignore_scripts: 'true' } });
      } finally { fs.closeSync(descriptor); }
      evidence.gates.push({ gate, exitCode: result.status, passed: result.status === 0 && !result.error, error: result.error?.code ?? null, log: path.basename(log) });
      if (!evidence.gates.at(-1).passed) break;
    }
    const after = snapshot(cwd);
    evidence.sourceChangedDuringRun = after.sourceSha256 !== state.sourceSha256;
    evidence.status = evidence.gates.length === GATES[mode].length && evidence.gates.every((gate) => gate.passed) && !evidence.sourceChangedDuringRun ? 'passed' : 'failed';
    evidence.finishedAt = new Date().toISOString();
    writeArtifact(cwd, directory, 'evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
  }
  writeArtifact(cwd, directory, 'review-packet.md', renderPacket(requirements, state, evidence));
  return { directory, evidence };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = runPilot(parseArgs(process.argv.slice(2)));
    console.log(`Pilot packet: ${result.directory}`);
    if (result.evidence?.status === 'failed') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

export { GATES, parseArgs, validateRequirements, snapshot, renderPacket, runPilot };
