import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

const PR_REVISION_EVENTS = ['opened', 'synchronize', 'reopened', 'ready_for_review'];

function readWorkflow(file) {
  return YAML.parse(fs.readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8'));
}

function assertEveryPrRevision(workflow) {
  assert.deepEqual(
    [...workflow.on.pull_request.types].sort(),
    [...PR_REVISION_EVENTS].sort(),
    'Opening, revising, reopening, or promoting a PR must schedule the gate'
  );
  for (const filter of ['paths', 'paths-ignore', 'branches', 'branches-ignore']) {
    assert.equal(workflow.on.pull_request[filter], undefined, `${filter} must not skip a required gate`);
  }
  assert.equal(workflow.on.pull_request_target, undefined, 'PR code must run without target-repository authority');
}

function assertBoundedReadOnlyJob(workflow, job, maximumMinutes) {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  if (job.permissions !== undefined) {
    assert.deepEqual(job.permissions, { contents: 'read' }, 'Job overrides must remain read-only');
  }
  assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= maximumMinutes);
  assert.equal(job['continue-on-error'], undefined, 'A failed validation must fail its check');
  const concurrency = job.concurrency ?? workflow.concurrency;
  assert.equal(concurrency['cancel-in-progress'], true, 'Superseded revisions must not consume runner time');
  assert.match(concurrency.group, /github\.event\.pull_request\.number/);
  assert.match(concurrency.group, /github\.ref/);

  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(checkout.with.ref, undefined, 'Default PR merge checkout must not be replaced with main');
  const setup = job.steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(setup.with['node-version'], '24');
  assert.ok(job.steps.some((step) => step.run === 'npm ci --ignore-scripts'));
  for (const step of job.steps) {
    assert.equal(step['continue-on-error'], undefined, 'Gate steps must propagate failure');
    assert.equal(step.if, undefined, 'Required validation steps must not be conditional');
  }
}

test('full validation follows every reviewable PR revision and remains manually available', () => {
  const workflow = readWorkflow('release-candidate.yml');
  assertEveryPrRevision(workflow);
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
  const job = workflow.jobs['release-candidate'];
  // Full validation is the promotion/review gate; draft regression has its own browser gate.
  assert.equal(job.if, "${{ github.event_name != 'pull_request' || github.event.pull_request.draft == false }}");
  assert.ok(job.steps.some((step) => step.run === 'npm run validate:full'));
  assertBoundedReadOnlyJob(workflow, job, 30);
});

test('browser regression validates draft PR revisions before promotion with bounded runner use', () => {
  const workflow = readWorkflow('playwright-integration.yml');
  assertEveryPrRevision(workflow);
  const job = workflow.jobs['nav-and-accordion'];
  assert.equal(job.if, undefined, 'Draft browser regression must run without a promotion condition');
  assert.ok(job.steps.some((step) => step.run === './node_modules/.bin/playwright install --with-deps chromium'));
  assert.ok(job.steps.some((step) =>
    step.run === './node_modules/.bin/playwright test tests/integration/mobile-nav-and-accordion.spec.mjs --config=playwright.config.mjs'
  ));
  assertBoundedReadOnlyJob(workflow, job, 20);
});
