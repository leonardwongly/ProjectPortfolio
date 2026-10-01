import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import YAML from 'yaml';

import { resolveProductionDeployment } from '../../scripts/resolve-production-deployment.mjs';

const SHA = '21c9ede65bc727c2c3bbdd376d6338bf86445531';
const NEW_MAIN_SHA = 'b'.repeat(40);
const REPOSITORY = { id: 319589008, full_name: 'leonardwongly/ProjectPortfolio', default_branch: 'main', archived: false };
const APP = { id: 85455, slug: 'cloudflare-workers-and-pages', owner: { id: 314135, login: 'cloudflare' } };
const DEPLOYMENT = 'a3bc584f-52d1-4e07-a786-a24a9d38776d';
const PREVIEW = 'https://a3bc584f.projectportfolio.pages.dev';

function fixture(options = {}) {
  const { mainSha = SHA, pullRequests = [], ref, refError } = options;
  const branch = Object.hasOwn(options, 'branch') ? options.branch : 'main';
  const check = { id: 108658890766, name: 'Cloudflare Pages', app: APP, head_sha: SHA,
    status: 'completed', conclusion: 'success', check_suite: { id: 98381084809, head_branch: branch },
    pull_requests: pullRequests,
    details_url: `https://dash.cloudflare.com/?to=/a649a1e014ef97cb08f812c4886fff62/pages/view/projectportfolio/${DEPLOYMENT}`,
    output: { summary: `<a href="${PREVIEW}">preview</a>` } };
  const event = { action: 'completed', repository: REPOSITORY, check_run: check };
  const suite = { id: check.check_suite.id, app: APP, repository: REPOSITORY,
    head_sha: SHA, head_branch: branch, status: 'completed', conclusion: 'success', pull_requests: pullRequests };
  const requests = [];
  const api = async (apiPath) => {
    requests.push(apiPath);
    if (apiPath === `/repos/${REPOSITORY.full_name}/check-runs/${check.id}`) {
      // REST check runs expose a simplified suite; branch evidence comes from the suite endpoint.
      return { ...check, check_suite: { id: suite.id } };
    }
    if (apiPath === `/repos/${REPOSITORY.full_name}/check-suites/${suite.id}`) return suite;
    if (apiPath === `/repos/${REPOSITORY.full_name}/git/ref/heads/main`) {
      if (refError) throw refError;
      return ref === undefined ? { ref: 'refs/heads/main', object: { type: 'commit', sha: mainSha } } : ref;
    }
    throw new Error(`Unexpected deployment metadata request: ${apiPath}`);
  };
  return { event, api, requests };
}

test('completed provider checks emit identity only while their exact SHA is current main', async () => {
  const current = fixture();
  assert.deepEqual(await resolveProductionDeployment({ eventName: 'check_run', githubRef: 'refs/heads/main', ...current }), {
    sha: SHA, preview_origin: PREVIEW, deployment_id: DEPLOYMENT, check_id: '108658890766'
  });
  assert.deepEqual(current.requests, [
    `/repos/${REPOSITORY.full_name}/check-runs/108658890766`,
    `/repos/${REPOSITORY.full_name}/check-suites/98381084809`,
    `/repos/${REPOSITORY.full_name}/git/ref/heads/main`
  ], 'Check and suite authentication must precede the current-main comparison');

  const stale = fixture({ mainSha: NEW_MAIN_SHA });
  await assert.rejects(resolveProductionDeployment({ eventName: 'check_run', githubRef: 'refs/heads/main', ...stale }),
    /not for current exact main SHA/);
});

test('check completion cannot bypass missing, malformed, or unavailable current main evidence', async (t) => {
  const cases = [
    ['missing reference', { ref: null }],
    ['missing object', { ref: { ref: 'refs/heads/main' } }],
    ['short SHA', { ref: { ref: 'refs/heads/main', object: { type: 'commit', sha: SHA.slice(0, 7) } } }],
    ['different branch', { ref: { ref: 'refs/heads/feature', object: { type: 'commit', sha: SHA } } }],
    ['noncommit reference', { ref: { ref: 'refs/heads/main', object: { type: 'tag', sha: SHA } } }],
    ['unavailable metadata', { refError: new Error('Metadata unavailable') }]
  ];
  for (const [name, options] of cases) await t.test(name, async () => {
    await assert.rejects(resolveProductionDeployment({ eventName: 'check_run', ...fixture(options) }));
  });
});

test('resolver independently rejects preview branches and PR association without inferring branch from an empty PR list', async (t) => {
  for (const [name, branch, pullRequests] of [
    ['feature with no PR', 'feature', []],
    ['feature with PR', 'feature', [{ number: 181 }]],
    ['main with PR', 'main', [{ number: 181 }]],
    ['missing branch with no PR', undefined, []],
    ['null branch with no PR', null, []]
  ]) await t.test(name, async () => {
    const options = fixture({ branch, pullRequests });
    options.event.check_run.check_suite.head_branch = 'main';
    options.event.check_run.pull_requests = [];
    await assert.rejects(resolveProductionDeployment({ eventName: 'check_run', ...options }), /exact main SHA/);
    assert.equal(options.requests.some((apiPath) => apiPath.endsWith('/git/ref/heads/main')), false);
  });
});

test('production job admits main completions and skips feature or missing-branch events regardless of PR association', () => {
  const workflow = YAML.parse(fs.readFileSync(new URL('../../.github/workflows/production-smoke.yml', import.meta.url), 'utf8'));
  const condition = workflow.jobs['production-smoke'].if;
  assert.match(condition, /github\.event\.check_run\.check_suite\.head_branch == 'main'/);
  const shouldRun = (eventName, event, ref = 'refs/heads/main') => {
    // These fixtures use the common boolean/comparison syntax and canonical string values
    // shared by JavaScript and GitHub expressions; evaluate the actual checked-in condition.
    return vm.runInNewContext(condition, { github: { repository: REPOSITORY.full_name, event_name: eventName, event, ref } },
      { timeout: 100 });
  };
  for (const [name, branch, pullRequests, expected] of [
    ['main without PR', 'main', [], true],
    ['feature without PR', 'feature', [], false],
    ['feature with PR', 'feature', [{ number: 181 }], false],
    ['main with PR', 'main', [{ number: 181 }], false],
    ['missing branch without PR', undefined, [], false],
    ['null branch without PR', null, [], false],
    ['empty branch without PR', '', [], false]
  ]) {
    const { event } = fixture({ branch, pullRequests });
    assert.equal(shouldRun('check_run', event), expected, name);
  }
  for (const eventName of ['schedule', 'workflow_dispatch']) {
    const event = { repository: REPOSITORY };
    assert.equal(shouldRun(eventName, event), true);
    assert.equal(shouldRun(eventName, event, 'refs/heads/feature'), false);
  }
});
