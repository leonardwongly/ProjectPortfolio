import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { writeFileNoFollow } from './lib/safe-output.cjs';
import { assertSha } from './resolve-production-deployment.mjs';
import { normalizePreviewOrigin } from './verify-deployment-artifacts.mjs';

// This wrapper is opt-in at the existing Pages build configuration boundary.
// Ordinary local builds never create a claim about a deployed version.
function deploymentMarker(env, head) {
  if (env.CF_PAGES !== '1') throw new Error('Deployment marker requires the Pages build environment');
  const sha = assertSha(env.CF_PAGES_COMMIT_SHA);
  if (sha !== assertSha(head)) throw new Error('Pages commit SHA differs from the checked-out Git HEAD');
  if (typeof env.CF_PAGES_BRANCH !== 'string' || !env.CF_PAGES_BRANCH ||
      env.CF_PAGES_BRANCH.length > 255 || /[\u0000-\u0020\u007f]/.test(env.CF_PAGES_BRANCH)) {
    throw new Error('Pages branch must be bounded nonempty text without whitespace or controls');
  }
  return { schemaVersion: 1, repository: 'leonardwongly/ProjectPortfolio', sha,
    branch: env.CF_PAGES_BRANCH, previewOrigin: normalizePreviewOrigin(env.CF_PAGES_URL) };
}

function writeDeploymentMarker({ cwd = process.cwd(), env = process.env, git = execFileSync } = {}) {
  const head = git('git', ['--no-replace-objects', 'rev-parse', 'HEAD'], {
    cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 4096
  }).trim();
  const marker = deploymentMarker(env, head);
  writeFileNoFollow(cwd, path.join(cwd, '.well-known/deployment.json'), `${JSON.stringify(marker)}\n`, 'deployment marker');
  return marker;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    writeDeploymentMarker();
    console.log('Pages deployment marker generated.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

export { deploymentMarker, writeDeploymentMarker };
