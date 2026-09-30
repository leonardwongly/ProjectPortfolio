import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import YAML from 'yaml';

import { deploymentIdentity, githubJson, readEvent, resolveProductionDeployment,
  writeGithubOutputs } from '../../scripts/resolve-production-deployment.mjs';
import { ARTIFACTS, MARKER_ROUTE, normalizePreviewOrigin, parseArgs, readTrackedArtifacts,
  validateDeploymentMarker, verifyDeploymentArtifacts } from '../../scripts/verify-deployment-artifacts.mjs';

const SHA = '21c9ede65bc727c2c3bbdd376d6338bf86445531';
const PREVIEW = 'https://a3bc584f.projectportfolio.pages.dev';
const DEPLOYMENT = 'a3bc584f-52d1-4e07-a786-a24a9d38776d';
const REPOSITORY = { id: 319589008, full_name: 'leonardwongly/ProjectPortfolio', default_branch: 'main', archived: false };
const APP = { id: 85455, slug: 'cloudflare-workers-and-pages', owner: { id: 314135, login: 'cloudflare' } };
function checkFixture() {
  return { id: 108658890766, name: 'Cloudflare Pages', app: structuredClone(APP), head_sha: SHA,
    status: 'completed', conclusion: 'success', check_suite: { id: 98381084809 },
    details_url: `https://dash.cloudflare.com/?to=/a649a1e014ef97cb08f812c4886fff62/pages/view/projectportfolio/${DEPLOYMENT}`,
    output: { summary: `<table><a href='${PREVIEW}'>${PREVIEW}</a></table>\n[View logs](https://dash.cloudflare.com/)` } };
}
function suiteFixture() {
  return { id: 98381084809, app: structuredClone(APP), repository: { ...REPOSITORY },
    head_sha: SHA, head_branch: 'main', status: 'completed', conclusion: 'success', pull_requests: [] };
}
function eventFixture() { return { action: 'completed', repository: { ...REPOSITORY }, check_run: checkFixture() }; }
function fixtureApi({ check = checkFixture(), suite = suiteFixture(), checks = [check], mainSha = SHA } = {}) {
  return async (apiPath) => {
    if (apiPath.includes('/check-runs/')) return check;
    if (apiPath.includes('/check-suites/')) return suite;
    if (apiPath.endsWith('/git/ref/heads/main')) return { ref: 'refs/heads/main', object: { type: 'commit', sha: mainSha } };
    if (apiPath.endsWith('/check-runs?per_page=100')) return { total_count: checks.length, check_runs: checks };
    throw new Error(`Unexpected fixture API request: ${apiPath}`);
  };
}
const EXPECTED_IDENTITY = { sha: SHA, preview_origin: PREVIEW, deployment_id: DEPLOYMENT, check_id: '108658890766' };
function markerResponse(changes = {}) {
  return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, repository: REPOSITORY.full_name,
      sha: SHA, branch: 'main', previewOrigin: PREVIEW, ...changes })) };
}

test('observed Cloudflare event binds exact SHA, app, project deployment, and immutable preview', async () => {
  assert.deepEqual(deploymentIdentity(checkFixture()), EXPECTED_IDENTITY);
  assert.deepEqual(await resolveProductionDeployment({ eventName: 'check_run', event: eventFixture(), api: fixtureApi() }), EXPECTED_IDENTITY);
});

test('deployment identity rejects spoofing, unsuccessful checks, and mutable or unrelated URLs', async (t) => {
  const cases = [
    ['untrusted app ID', (check) => { check.app.id = 15368; }],
    ['untrusted app slug', (check) => { check.app.slug = 'github-actions'; }],
    ['untrusted app owner', (check) => { check.app.owner.id = 1; }],
    ['another check', (check) => { check.name = 'Build'; }],
    ['pending check', (check) => { check.status = 'in_progress'; }],
    ['failed deployment', (check) => { check.conclusion = 'failure'; }],
    ['short SHA', (check) => { check.head_sha = SHA.slice(0, 7); }],
    ['shell SHA', (check) => { check.head_sha = '$(touch /tmp/unexpected)'; }],
    ['invalid check ID', (check) => { check.id = '123\nsha=unsafe'; }],
    ['missing suite', (check) => { check.check_suite = null; }],
    ['wrong Cloudflare account', (check) => { check.details_url = check.details_url.replace('a649a1e014ef97cb08f812c4886fff62', '00000000000000000000000000000000'); }],
    ['wrong Cloudflare project', (check) => { check.details_url = check.details_url.replace('projectportfolio/', 'projectportfolio-beta/'); }],
    ['untrusted dashboard', (check) => { check.details_url = check.details_url.replace('dash.cloudflare.com', 'attacker.example'); }],
    ['dashboard credentials', (check) => { check.details_url = check.details_url.replace('https://', 'https://user:example@'); }],
    ['extra dashboard parameter', (check) => { check.details_url += '&to=/other'; }],
    ['malformed dashboard deployment ID', (check) => { check.details_url = check.details_url.replace(DEPLOYMENT, 'main'); }],
    ['dashboard fragment', (check) => { check.details_url += '#other'; }],
    ['dashboard port', (check) => { check.details_url = check.details_url.replace('.com/', '.com:8443/'); }],
    ['missing summary', (check) => { check.output.summary = null; }],
    ['oversized summary', (check) => { check.output.summary = 'x'.repeat(65537); }],
    ['no preview link', (check) => { check.output.summary = PREVIEW; }],
    ['two preview links', (check) => { check.output.summary += `<a href="${PREVIEW}">extra</a>`; }],
    ['branch preview alias', (check) => { check.output.summary = `<a href="https://main.projectportfolio.pages.dev">main</a>`; }],
    ['other immutable deployment', (check) => { check.output.summary = `<a href="https://00000000.projectportfolio.pages.dev">other</a>`; }],
    ['insecure preview URL', (check) => { check.output.summary = `<a href="http://a3bc584f.projectportfolio.pages.dev">other</a>`; }],
    ['preview path', (check) => { check.output.summary = `<a href="${PREVIEW}/work">path</a>`; }],
    ['preview query', (check) => { check.output.summary = `<a href="${PREVIEW}?other=true">query</a>`; }],
    ['preview port', (check) => { check.output.summary = `<a href="${PREVIEW}:8443">port</a>`; }]
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const check = checkFixture(); mutate(check);
    assert.throws(() => deploymentIdentity(check));
  });
});

test('event resolution rejects archived/beta repositories, event drift, and preview branches', async (t) => {
  const cases = [
    ['wrong repository ID', (event) => { event.repository.id = 1; }],
    ['archived repository', (event) => { event.repository.archived = true; }],
    ['beta repository', (event) => { event.repository.full_name += '-beta'; }],
    ['different default branch', (event) => { event.repository.default_branch = 'beta'; }],
    ['noncompleted event', (event) => { event.action = 'created'; }]
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const event = eventFixture(); mutate(event);
    await assert.rejects(resolveProductionDeployment({ eventName: 'check_run', event, api: fixtureApi() }));
  });
  const drift = checkFixture(); drift.head_sha = 'a'.repeat(40);
  await assert.rejects(resolveProductionDeployment({ eventName: 'check_run', event: eventFixture(), api: fixtureApi({ check: drift }) }), /differs/);
  for (const mutate of [
    (suite) => { suite.head_branch = 'feature'; }, (suite) => { suite.head_sha = 'b'.repeat(40); },
    (suite) => { suite.id = 1; }, (suite) => { suite.status = 'in_progress'; },
    (suite) => { suite.conclusion = 'failure'; }, (suite) => { suite.pull_requests = [{ number: 180 }]; }
  ]) {
    const suite = suiteFixture(); mutate(suite);
    await assert.rejects(resolveProductionDeployment({ eventName: 'check_run', event: eventFixture(), api: fixtureApi({ suite }) }), /exact main SHA/);
  }
  await assert.rejects(resolveProductionDeployment({ eventName: 'push', event: eventFixture() }), /Unsupported/);
});

test('manual and weekly runs resolve current main and reject stale approval or failed newer deployment', async () => {
  for (const eventName of ['schedule', 'workflow_dispatch']) {
    assert.deepEqual(await resolveProductionDeployment({ eventName, event: eventFixture(), githubRef: 'refs/heads/main', expectedSha: SHA, api: fixtureApi() }), EXPECTED_IDENTITY);
    await assert.rejects(resolveProductionDeployment({ eventName, event: eventFixture(), githubRef: 'refs/heads/feature', api: fixtureApi() }), /must run from main/);
  }
  await assert.rejects(resolveProductionDeployment({ eventName: 'workflow_dispatch', event: eventFixture(), githubRef: 'refs/heads/main', expectedSha: 'a'.repeat(40), api: fixtureApi() }), /differs from current main/);
  const newer = checkFixture(); newer.id += 1; newer.conclusion = 'failure';
  await assert.rejects(resolveProductionDeployment({ eventName: 'schedule', event: eventFixture(), githubRef: 'refs/heads/main', api: fixtureApi({ checks: [checkFixture(), newer] }) }), /successful deployment/);
  await assert.rejects(resolveProductionDeployment({ eventName: 'schedule', event: eventFixture(), githubRef: 'refs/heads/main', api: fixtureApi({ checks: [] }) }));
  await assert.rejects(resolveProductionDeployment({ eventName: 'schedule', event: eventFixture(), githubRef: 'refs/heads/main', api: async (url) => url.includes('/git/ref/') ? { ref: 'refs/heads/main', object: { sha: SHA, type: 'commit' } } : { total_count: 101, check_runs: [] } }), /bounded/);
  await assert.rejects(resolveProductionDeployment({ eventName: 'schedule', event: eventFixture(), githubRef: 'refs/heads/main', api: fixtureApi({ mainSha: 'a'.repeat(40) }) }), /current exact main SHA/);
});

test('GitHub metadata requests stay read-only, authenticated, pinned, and bounded', async () => {
  let observed;
  const result = await githubJson('/repos/leonardwongly/ProjectPortfolio/check-runs/1', {
    token: 'test-auth-token', requestImpl: async (url, options) => {
      observed = { url, options }; return { status: 200, bytes: Buffer.from('{"id":1}') };
    }
  });
  assert.deepEqual(result, { id: 1 });
  assert.equal(observed.url, 'https://api.github.com/repos/leonardwongly/ProjectPortfolio/check-runs/1');
  assert.deepEqual(observed.options.allowedHosts, ['api.github.com']);
  assert.equal(observed.options.timeoutMs, 10000);
  assert.equal(observed.options.maxBytes, 2097152);
  assert.equal(observed.options.headers.authorization, 'Bearer test-auth-token');
  await assert.rejects(githubJson('/repos/attacker/other/check-runs/1', { token: 'token' }), /Unexpected/);
  await assert.rejects(githubJson('/repos/leonardwongly/ProjectPortfolio/check-runs/1', { token: 'x\nx' }), /token/);
  await assert.rejects(githubJson('/repos/leonardwongly/ProjectPortfolio/check-runs/1', { token: 'token', requestImpl: async () => ({ status: 302 }) }), /HTTP 302/);
});

test('event and output files reject symlinks, oversize data, and output injection', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deployment-event-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'event.json'); fs.writeFileSync(file, JSON.stringify(eventFixture()));
  assert.deepEqual(readEvent(file), eventFixture());
  assert.throws(() => readEvent(), /required/);
  const symlink = path.join(root, 'event-link.json'); fs.symlinkSync(file, symlink);
  assert.throws(() => readEvent(symlink), /symbolic link/);
  fs.writeFileSync(file, 'x'.repeat(262145)); assert.throws(() => readEvent(file), /byte limit/);
  const output = path.join(root, 'output'); fs.writeFileSync(output, ''); writeGithubOutputs(output, EXPECTED_IDENTITY);
  assert.match(fs.readFileSync(output, 'utf8'), new RegExp(`sha=${SHA}\\n`));
  assert.throws(() => writeGithubOutputs(output, { ...EXPECTED_IDENTITY, check_id: '1\nunsafe=true' }), /malformed/);
  assert.throws(() => writeGithubOutputs(symlink, EXPECTED_IDENTITY), /symlink/);
});

test('artifact correspondence rejects old content, edge injection, redirects, and private preview hosts', async () => {
  const expected = new Map([['/', Buffer.from('<html>approved</html>')], ['/offline', Buffer.from('offline')]]);
  const options = { sha: SHA, previewOrigin: PREVIEW, readArtifacts: () => expected, attempts: 1,
    requestImpl: async (url) => new URL(url).pathname === MARKER_ROUTE ? markerResponse() : { status: 200, bytes: expected.get(new URL(url).pathname) } };
  const result = await verifyDeploymentArtifacts(options);
  assert.equal(result.findings.length, 0); assert.equal(result.evidence.length, 6);
  assert.equal(result.production_alias_sha, SHA);
  assert.ok(result.evidence.filter((entry) => entry.route !== MARKER_ROUTE).every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
  for (const response of [{ status: 302, bytes: Buffer.from('redirect') },
    { status: 200, bytes: Buffer.from('old release') },
    { status: 200, bytes: Buffer.from('<html>approved</html><script src="/.webmcp/bridge.js"></script>') }]) {
    const failed = await verifyDeploymentArtifacts({ ...options, requestImpl: async (url) => new URL(url).pathname === MARKER_ROUTE ? markerResponse() : response });
    assert.equal(failed.findings.length, 4); assert.equal(failed.evidence.length, 0);
  }
  await assert.rejects(verifyDeploymentArtifacts({ ...options, previewOrigin: 'https://127.0.0.1' }), /blocked/);
  assert.throws(() => normalizePreviewOrigin('https://main.projectportfolio.pages.dev'), /immutable/);
  assert.throws(() => normalizePreviewOrigin(`${PREVIEW}/work`), /immutable/);
  for (const change of [{ attempts: 4 }, { timeoutMs: 10001 }, { retryDelayMs: 0 }]) {
    await assert.rejects(verifyDeploymentArtifacts({ ...options, ...change }), /positive integer/);
  }
  let calls = 0; let sleeps = 0;
  const retried = await verifyDeploymentArtifacts({ ...options, attempts: 2, sleep: async () => { sleeps += 1; },
    requestImpl: async (url) => { calls += 1; if (calls === 1) throw new Error('transient failure'); return new URL(url).pathname === MARKER_ROUTE ? markerResponse() : { status: 200, bytes: expected.get(new URL(url).pathname) }; } });
  assert.equal(sleeps, 1); assert.equal(retried.findings.length, 0);
});

test('version markers reject stale SHA even when every published artifact is identical', async () => {
  const bytes = Buffer.from('identical published artifacts across two commits');
  for (const marker of [markerResponse({ sha: 'a'.repeat(40) }), { ...markerResponse(), status: 404 }]) {
    const result = await verifyDeploymentArtifacts({ sha: SHA, previewOrigin: PREVIEW, attempts: 1,
      readArtifacts: () => new Map([['/', bytes]]),
      requestImpl: async (url) => new URL(url).pathname === MARKER_ROUTE ? marker : { status: 200, bytes } });
    assert.equal(result.findings.length, 2); assert.equal(result.evidence.length, 0);
    assert.equal(result.production_alias_sha, null);
  }
});

test('version markers require bounded JSON, no-store headers, and exact five-field schema', () => {
  const options = { sha: SHA, previewOrigin: PREVIEW };
  assert.equal(validateDeploymentMarker(markerResponse(), options).sha, SHA);
  for (const changes of [{ schemaVersion: 2 }, { repository: `${REPOSITORY.full_name}-beta` },
    { sha: SHA.slice(0, 7) }, { branch: 'feature' }, { previewOrigin: 'https://main.projectportfolio.pages.dev' }, { extra: true }]) {
    assert.throws(() => validateDeploymentMarker(markerResponse(changes), options), /must bind/);
  }
  for (const response of [
    { ...markerResponse(), bytes: Buffer.alloc(4097) },
    { ...markerResponse(), bytes: Buffer.from([0xff]) },
    { ...markerResponse(), bytes: Buffer.from('[]') },
    { ...markerResponse(), bytes: Buffer.from('null') },
    { ...markerResponse(), headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } },
    { ...markerResponse(), headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } }
  ]) assert.throws(() => validateDeploymentMarker(response, options));
  const duplicate = markerResponse(); duplicate.bytes = Buffer.from(duplicate.bytes.toString().replace('"sha":', `"sha":"${'a'.repeat(40)}","sha":`));
  assert.throws(() => validateDeploymentMarker(duplicate, options), /must bind/);
});

test('exact checkout artifacts come from the immutable Git tree and reject symlink blobs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deployment-artifacts-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  for (const filename of ARTIFACTS.values()) {
    fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true }); fs.writeFileSync(path.join(root, filename), filename);
  }
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture');
  const sha = git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(root, 'index.html'), 'dirty files must not change expected artifacts');
  assert.equal(readTrackedArtifacts({ repositoryRoot: root, sha }).get('/').toString(), 'index.html');
  assert.throws(() => readTrackedArtifacts({ repositoryRoot: root, sha: 'a'.repeat(40) }), /HEAD does not match/);
  fs.rmSync(path.join(root, 'js/site.js')); fs.symlinkSync('../index.html', path.join(root, 'js/site.js'));
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'symlink');
  assert.throws(() => readTrackedArtifacts({ repositoryRoot: root, sha: git('rev-parse', 'HEAD').trim() }), /tracked regular file/);
});

test('artifact CLI requires exact SHA, immutable preview, and checkout; invalid invocation exits unsuccessfully', () => {
  assert.deepEqual(parseArgs(['--sha', SHA, '--preview-origin', PREVIEW, '--repository-root', '/tmp/example'], {}),
    { sha: SHA, previewOrigin: PREVIEW, repositoryRoot: '/tmp/example', attempts: 2, timeoutMs: 5000, retryDelayMs: 5000 });
  assert.throws(() => parseArgs(['--unknown'], {}), /Unknown or missing/);
  assert.throws(() => parseArgs([], {}), /checkout is required/);
  for (const script of ['resolve-production-deployment.mjs', 'verify-deployment-artifacts.mjs']) {
    const run = spawnSync(process.execPath, [`scripts/${script}`], { encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: '', DEPLOYMENT_ROOT: '' } });
    assert.equal(run.status, 1); assert.ok(run.stderr.trim());
  }
});

test('production workflow preserves health evidence while requiring successful provider completion for exact version checks', () => {
  const workflow = YAML.parse(fs.readFileSync('.github/workflows/production-smoke.yml', 'utf8'));
  assert.equal(workflow.on.push, undefined);
  assert.deepEqual(workflow.on.check_run.types, ['completed']);
  assert.equal(workflow.on.schedule[0].cron, '42 4 * * 1');
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
  assert.deepEqual(workflow.permissions, { contents: 'read', checks: 'read' });
  const job = workflow.jobs['production-smoke'];
  assert.equal(job['timeout-minutes'], 12);
  assert.ok(job.if.includes('github.event.check_run.pull_requests[0] == null'));
  const checkouts = job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
  assert.deepEqual(checkouts.map((step) => step.with.path), ['tooling', 'deployed']);
  assert.ok(checkouts.every((step) => step.with['persist-credentials'] === false));
  assert.equal(checkouts[1].with.ref, '${{ steps.deployment.outputs.sha }}');
  const tokenSteps = job.steps.filter((step) => step.env?.GITHUB_TOKEN);
  assert.deepEqual(tokenSteps.map((step) => step.id), ['deployment']);
  const health = job.steps.filter((step) => step.name.startsWith('Check production'));
  assert.equal(health.length, 2); assert.ok(health.every((step) => step.if.includes('always()') && step.if.includes('steps.install.outcome')));
  assert.ok(job.steps.some((step) => step.run === 'node scripts/verify-deployment-artifacts.mjs'));
});
