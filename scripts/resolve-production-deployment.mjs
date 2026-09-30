import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { normalizePublicHttpsUrl, requestPinnedHttpsBytes } from './lib/network-safety.mjs';

const require = createRequire(import.meta.url);
const { readStableFileNoFollow } = require('./lib/safe-input.cjs');
const { writeFileNoFollow } = require('./lib/safe-output.cjs');
const REPOSITORY = 'leonardwongly/ProjectPortfolio';
const REPOSITORY_ID = 319589008;
const CLOUDFLARE_APP_ID = 85455;
const CLOUDFLARE_APP_SLUG = 'cloudflare-workers-and-pages';
const CLOUDFLARE_ACCOUNT_ID = 'a649a1e014ef97cb08f812c4886fff62';
const MAX_EVENT_BYTES = 256 * 1024;
const MAX_API_BYTES = 2 * 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function assertRepository(repository) {
  if (repository?.id !== REPOSITORY_ID || repository.full_name !== REPOSITORY ||
      repository.default_branch !== 'main' || repository.archived !== false) {
    throw new Error('Expected the active ProjectPortfolio repository and main default branch');
  }
}

function assertCloudflareApp(app) {
  if (app?.id !== CLOUDFLARE_APP_ID || app.slug !== CLOUDFLARE_APP_SLUG ||
      app.owner?.id !== 314135 || app.owner.login !== 'cloudflare') {
    throw new Error('Expected the verified Cloudflare Workers and Pages GitHub App');
  }
}

function assertSha(sha) {
  if (typeof sha !== 'string' || !SHA_PATTERN.test(sha)) {
    throw new Error('Deployment SHA must be a full lowercase 40-character commit SHA');
  }
  return sha;
}

function assertId(id, label) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${label} must be a positive safe integer`);
  return id;
}

function deploymentIdentity(check) {
  assertCloudflareApp(check?.app);
  assertId(check.id, 'Cloudflare check ID');
  assertId(check.check_suite?.id, 'Cloudflare check suite ID');
  assertSha(check.head_sha);
  if (check.name !== 'Cloudflare Pages' || check.status !== 'completed' || check.conclusion !== 'success') {
    throw new Error('Cloudflare Pages must have completed a successful deployment');
  }

  const details = normalizePublicHttpsUrl(check.details_url, {
    fieldPath: 'Cloudflare deployment details', allowedHosts: ['dash.cloudflare.com']
  });
  const params = [...details.searchParams];
  const expectedPath = new RegExp(`^/${CLOUDFLARE_ACCOUNT_ID}/pages/view/projectportfolio/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$`);
  const deployment = params.length === 1 && params[0][0] === 'to' && expectedPath.exec(params[0][1]);
  if (details.pathname !== '/' || details.hash || details.port || !deployment) {
    throw new Error('Cloudflare deployment details must identify this account, project, and immutable deployment');
  }

  const summary = check.output?.summary;
  if (typeof summary !== 'string' || Buffer.byteLength(summary) > 64 * 1024) {
    throw new Error('Cloudflare deployment summary must be bounded text');
  }
  // The observed provider summary contains one HTML link: the immutable preview.
  // Do not accept branch aliases, unrelated links, or a silently changed format.
  const links = [...summary.matchAll(/\bhref\s*=\s*(['"])(.*?)\1/gi)];
  if (links.length !== 1) throw new Error('Cloudflare summary must identify exactly one immutable preview URL');
  const origin = normalizePublicHttpsUrl(links[0][2], { fieldPath: 'Cloudflare immutable preview' });
  if (origin.hostname !== `${deployment[1].slice(0, 8)}.projectportfolio.pages.dev` ||
      origin.port || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Cloudflare preview URL must match the immutable deployment ID and project');
  }
  return { sha: check.head_sha, preview_origin: origin.origin, deployment_id: deployment[1], check_id: String(check.id) };
}

function assertSuite(suite, check) {
  assertCloudflareApp(suite?.app);
  assertRepository(suite.repository);
  if (suite.id !== check.check_suite.id || suite.head_sha !== check.head_sha ||
      suite.head_branch !== 'main' || suite.status !== 'completed' || suite.conclusion !== 'success' ||
      !Array.isArray(suite.pull_requests) || suite.pull_requests.length !== 0) {
    throw new Error('Cloudflare check suite must bind this successful deployment to exact main SHA');
  }
}

async function githubJson(apiPath, { token, requestImpl = requestPinnedHttpsBytes } = {}) {
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) {
    throw new Error('A read-only GitHub token is required to resolve deployment identity');
  }
  if (!apiPath.startsWith(`/repos/${REPOSITORY}/`)) throw new Error('Unexpected GitHub API path');
  const response = await requestImpl(`https://api.github.com${apiPath}`, {
    fieldPath: 'GitHub deployment metadata', allowedHosts: ['api.github.com'],
    timeoutMs: 10000, maxBytes: MAX_API_BYTES,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'user-agent': 'ProjectPortfolio-deployment-verification/1.0' }
  });
  if (response.status !== 200) throw new Error(`GitHub deployment metadata returned HTTP ${response.status}`);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
}

async function resolveProductionDeployment({ eventName, event, githubRef, expectedSha = '', api = githubJson, token } = {}) {
  assertRepository(event?.repository);
  let check;
  if (eventName === 'check_run') {
    if (event.action !== 'completed') throw new Error('Expected a completed Cloudflare check event');
    const eventIdentity = deploymentIdentity(event.check_run);
    check = await api(`/repos/${REPOSITORY}/check-runs/${event.check_run.id}`, { token });
    const liveIdentity = deploymentIdentity(check);
    if (JSON.stringify(eventIdentity) !== JSON.stringify(liveIdentity)) {
      throw new Error('Cloudflare check event differs from current provider deployment evidence');
    }
  } else if (eventName === 'schedule' || eventName === 'workflow_dispatch') {
    if (githubRef !== 'refs/heads/main') throw new Error('Weekly and manual deployment verification must run from main');
    const ref = await api(`/repos/${REPOSITORY}/git/ref/heads/main`, { token });
    const mainSha = assertSha(ref?.object?.sha);
    if (ref.ref !== 'refs/heads/main' || ref.object.type !== 'commit') throw new Error('Expected a main commit reference');
    if (expectedSha && assertSha(expectedSha) !== mainSha) throw new Error('Requested release SHA differs from current main');
    const checks = await api(`/repos/${REPOSITORY}/commits/${mainSha}/check-runs?per_page=100`, { token });
    if (!Array.isArray(checks?.check_runs) || checks.total_count > 100) {
      throw new Error('Cloudflare check-run inventory is missing or exceeds the bounded one-page lookup');
    }
    check = checks.check_runs.filter((candidate) => candidate.name === 'Cloudflare Pages' &&
      candidate.app?.id === CLOUDFLARE_APP_ID).sort((left, right) => right.id - left.id)[0];
    deploymentIdentity(check);
    if (check.head_sha !== mainSha) throw new Error('Cloudflare deployment is not for current exact main SHA');
  } else {
    throw new Error('Unsupported deployment verification event');
  }
  const suite = await api(`/repos/${REPOSITORY}/check-suites/${check.check_suite.id}`, { token });
  assertSuite(suite, check);
  return deploymentIdentity(check);
}

function readEvent(eventPath) {
  if (typeof eventPath !== 'string' || !eventPath) throw new Error('GITHUB_EVENT_PATH is required');
  return JSON.parse(readStableFileNoFollow(eventPath, {
    rootDir: path.dirname(path.resolve(eventPath)), label: 'GitHub event', maxBytes: MAX_EVENT_BYTES, fatalUtf8: true
  }));
}

function writeGithubOutputs(outputPath, identity) {
  if (Object.keys(identity).sort().join(',') !== 'check_id,deployment_id,preview_origin,sha' ||
      !SHA_PATTERN.test(identity.sha) || !/^\d+$/.test(identity.check_id) ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(identity.deployment_id) ||
      identity.preview_origin !== `https://${identity.deployment_id.slice(0, 8)}.projectportfolio.pages.dev`) {
    throw new Error('Refusing malformed GitHub deployment outputs');
  }
  const output = Object.entries(identity).map(([key, value]) => `${key}=${value}\n`).join('');
  // Values come exclusively from the narrow validators above; no event text or multiline output is emitted.
  writeFileNoFollow(path.dirname(path.resolve(outputPath)), outputPath, output, 'GitHub deployment outputs');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const identity = await resolveProductionDeployment({
      eventName: process.env.GITHUB_EVENT_NAME, event: readEvent(process.env.GITHUB_EVENT_PATH),
      githubRef: process.env.GITHUB_REF, expectedSha: process.env.EXPECTED_SHA,
      token: process.env.GITHUB_TOKEN
    });
    if (process.env.GITHUB_OUTPUT) writeGithubOutputs(process.env.GITHUB_OUTPUT, identity);
    console.log(JSON.stringify(identity));
  } catch (error) {
    console.error(error?.message || 'Deployment identity verification failed');
    process.exitCode = 1;
  }
}

export { REPOSITORY, REPOSITORY_ID, assertSha, deploymentIdentity, githubJson, readEvent,
  resolveProductionDeployment, writeGithubOutputs };
