import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { renderCspScriptHashesDirective } = require('../../scripts/build.js');

const WORKFLOW_FILES = fs.readdirSync('.github/workflows')
  .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  .map((file) => path.posix.join('.github/workflows', file))
  .sort();

const SOURCE_HTML_FILES = [
  'src/index.html',
  'src/reading.html',
  'src/offline.html'
];

const GENERATED_HTML_FILES = [
  'index.html',
  'reading.html',
  'offline.html'
];

const HEADERS_FILE = '_headers';

test('workflow uses references are pinned by SHA', () => {
  assert.deepEqual(WORKFLOW_FILES, [
    '.github/workflows/build.yml',
    '.github/workflows/codeql.yml',
    '.github/workflows/dependency-review.yml',
    '.github/workflows/gemini-cli.yml',
    '.github/workflows/link-health.yml',
    '.github/workflows/playwright-integration.yml',
    '.github/workflows/production-smoke.yml',
    '.github/workflows/release-candidate.yml',
    '.github/workflows/scan.yml',
    '.github/workflows/vendor-review.yml'
  ]);

  const unpinned = [];
  const pinPattern = /uses:\s*[^@\s]+@[0-9a-f]{40}\b/;
  const usesPattern = /uses:\s*[^@\s]+@/;

  for (const file of WORKFLOW_FILES) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (usesPattern.test(line) && !pinPattern.test(line)) {
        unpinned.push(`${file}:${index + 1}:${line.trim()}`);
      }
    });
  }

  assert.deepEqual(unpinned, [], `Found unpinned action references:\n${unpinned.join('\n')}`);
});

test('workflow npm installs disable dependency lifecycle scripts', () => {
  const unsafeInstalls = [];

  for (const file of WORKFLOW_FILES) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (/\brun:\s*npm ci\b/.test(line) && !line.includes('--ignore-scripts')) {
        unsafeInstalls.push(`${file}:${index + 1}:${line.trim()}`);
      }
    });
  }

  assert.deepEqual(unsafeInstalls, [], `Found npm ci without --ignore-scripts:\n${unsafeInstalls.join('\n')}`);
});

test('scan workflow enforces dependency audit and vendor governance gates', () => {
  const content = fs.readFileSync('.github/workflows/scan.yml', 'utf8');

  assert.match(content, /npm run audit:high/);
  assert.match(content, /npm run validate:vendor:governance/);
  assert.doesNotMatch(content, /npm run validate:vendor(?:\s|$)/);
});

test('Gemini workflow separates planning from write-capable execution', () => {
  const content = fs.readFileSync('.github/workflows/gemini-cli.yml', 'utf8');
  const planJobStart = content.indexOf('  gemini-cli-plan:');
  const executeJobStart = content.indexOf('  gemini-cli-execute:');

  assert.ok(planJobStart >= 0, 'Missing Gemini planning job');
  assert.ok(executeJobStart > planJobStart, 'Missing Gemini execution job after planning job');

  const planJob = content.slice(planJobStart, executeJobStart);
  const executeJob = content.slice(executeJobStart);

  assert.doesNotMatch(planJob, /actions\/create-github-app-token/);
  assert.doesNotMatch(planJob, /run_shell_command\(git add\)/);
  assert.doesNotMatch(planJob, /run_shell_command\(git commit\)/);
  assert.doesNotMatch(planJob, /run_shell_command\(git push\)/);
  assert.match(planJob, /Write Safety.*planning job MUST NOT run `git add`, `git commit`, `git push`/s);
  assert.ok(
    planJob.includes("!(contains(github.event.issue.body, 'plan#') && contains(github.event.issue.body, 'approved'))"),
    'Planning job must not accept approved plan issue bodies'
  );
  assert.equal(
    planJob.split("!(contains(github.event.comment.body, 'plan#') && contains(github.event.comment.body, 'approved'))").length - 1,
    2,
    'Planning job must not accept approved plan issue or review comments'
  );
  assert.ok(
    planJob.includes("!(contains(github.event.review.body, 'plan#') && contains(github.event.review.body, 'approved'))"),
    'Planning job must not accept approved plan reviews'
  );

  assert.match(executeJob, /actions\/create-github-app-token@[0-9a-f]{40}/);
  assert.match(executeJob, /request_type=plan_execution/);
  assert.match(executeJob, /plan#\$\{PLAN_ID\}/);
  assert.match(executeJob, /github-actions\[bot\]/);
  assert.match(executeJob, /run_shell_command\(git add\)/);
  assert.match(executeJob, /run_shell_command\(git commit\)/);
  assert.match(executeJob, /run_shell_command\(git push\)/);
  assert.match(executeJob, /Plan execution requires vars\.APP_ID and secrets\.APP_PRIVATE_KEY/);
});

test('CSP is declared in source pages and appears before script tags when present', () => {
  for (const file of SOURCE_HTML_FILES) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const cspLine = lines.findIndex((line) => line.includes('Content-Security-Policy'));
    const scriptLine = lines.findIndex((line) => line.includes('<script'));

    assert.ok(cspLine >= 0, `Missing CSP in ${file}`);
    if (scriptLine >= 0) {
      assert.ok(cspLine < scriptLine, `CSP appears after script tags in ${file}`);
    }
  }
});

test('source CSP style-src does not permit unsafe-inline', () => {
  const offenders = [];

  for (const file of SOURCE_HTML_FILES) {
    const content = fs.readFileSync(file, 'utf8');
    if (/style-src[^"]*'unsafe-inline'/i.test(content)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, [], `Found unsafe-inline style-src directives in: ${offenders.join(', ')}`);
});

test('frame ancestor protection is delivered through enforceable headers', () => {
  const metaOffenders = [];

  for (const file of SOURCE_HTML_FILES) {
    const content = fs.readFileSync(file, 'utf8');
    if (/http-equiv="Content-Security-Policy"[^>]*frame-ancestors/i.test(content)) {
      metaOffenders.push(file);
    }
  }

  const headersContent = fs.readFileSync('src/_headers.template', 'utf8');
  assert.deepEqual(metaOffenders, [], `Found ignored frame-ancestors directives in meta CSP: ${metaOffenders.join(', ')}`);
  assert.match(headersContent, /frame-ancestors 'none'/);
});

test('generated index CSP hashes match inline scripts in both HTML and runtime headers', () => {
  const sourceContent = fs.readFileSync('src/index.html', 'utf8');
  const generatedContent = fs.readFileSync('index.html', 'utf8');
  const headersContent = fs.readFileSync(HEADERS_FILE, 'utf8');
  const expectedDirective = renderCspScriptHashesDirective(generatedContent);
  const escapedDirective = expectedDirective.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  assert.match(sourceContent, /\{\{CSP_SCRIPT_HASHES}}/);
  assert.ok(expectedDirective.includes('sha256-'));
  assert.match(generatedContent, new RegExp(`script-src 'self'${escapedDirective};`));
  assert.match(headersContent, new RegExp(`script-src 'self'${escapedDirective};`));
});

test('_headers includes required runtime security headers', () => {
  const content = fs.readFileSync(HEADERS_FILE, 'utf8');

  assert.match(content, /Content-Security-Policy:/);
  assert.match(content, /Permissions-Policy:/);
  assert.match(content, /X-Frame-Options:\s*DENY/i);
  assert.match(content, /X-Content-Type-Options:\s*nosniff/i);
  assert.match(content, /Referrer-Policy:\s*strict-origin-when-cross-origin/i);
});

test('CSP monitoring fallback and rollout requirements are documented', () => {
  const monitoring = fs.readFileSync('docs/security/csp-monitoring.md', 'utf8');
  const deploymentHeaders = fs.readFileSync('docs/security/deployment-headers.md', 'utf8');

  assert.match(monitoring, /no committed\s+CSP report collector endpoint/i);
  assert.match(monitoring, /No `report-uri` or `report-to` directive should be added without a real,\s+approved HTTPS collector endpoint\./i);
  assert.match(monitoring, /Cloudflare security events/i);
  assert.match(monitoring, /Collector Rollout Requirements/);
  assert.match(deploymentHeaders, /docs\/security\/csp-monitoring\.md/);
});

test('target=_blank always includes noopener and noreferrer', () => {
  const missingRel = [];
  const linkRegex = /<a[^>]*target="_blank"[^>]*>/g;

  for (const file of [...SOURCE_HTML_FILES, ...GENERATED_HTML_FILES]) {
    const content = fs.readFileSync(file, 'utf8');
    const matches = content.match(linkRegex) || [];
    matches.forEach((anchor) => {
      const hasRel = /rel="[^"]*noopener[^"]*noreferrer[^"]*"|rel="[^"]*noreferrer[^"]*noopener[^"]*"/.test(anchor);
      if (!hasRel) {
        missingRel.push(`${file}: ${anchor}`);
      }
    });
  }

  assert.deepEqual(missingRel, [], `Found target=_blank links without rel protection:\n${missingRel.join('\n')}`);
});

test('generated pages do not contain dangerous href/src schemes', () => {
  const offenders = [];
  const dangerousPattern = /\b(?:href|src)="(?:javascript:|data:text|vbscript:)/ig;

  for (const file of GENERATED_HTML_FILES) {
    const content = fs.readFileSync(file, 'utf8');
    if (dangerousPattern.test(content)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, [], `Found dangerous schemes in generated pages: ${offenders.join(', ')}`);
});

test('public content does not reference retired unreachable vanity domains', () => {
  const retiredDomains = [
    'email.leonardwong.tech',
    'telegram.leonardwong.tech',
    'twitter.leonardwong.tech'
  ];
  const files = [
    'data/profile.json',
    'partials/footer.html',
    'README.md',
    ...GENERATED_HTML_FILES
  ];
  const offenders = [];

  files.forEach((file) => {
    const content = fs.readFileSync(file, 'utf8');
    retiredDomains.forEach((domain) => {
      if (content.includes(domain)) {
        offenders.push(`${file}: ${domain}`);
      }
    });
  });

  assert.deepEqual(offenders, [], `Found retired vanity domains:\n${offenders.join('\n')}`);
});

test('generated pages do not contain inline style attributes', () => {
  const offenders = [];
  const inlineStylePattern = /\sstyle\s*=/i;

  for (const file of GENERATED_HTML_FILES) {
    const content = fs.readFileSync(file, 'utf8');
    if (inlineStylePattern.test(content)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, [], `Found inline style attributes in generated pages: ${offenders.join(', ')}`);
});

test('reading page exposes share controls with accessible status messaging', () => {
  const content = fs.readFileSync('reading.html', 'utf8');

  assert.match(content, /data-reading-share/);
  assert.match(content, /data-reading-share-status/);
  assert.match(content, /aria-live="polite"/);
});

test('reading share measurement hooks remain wired in client script', () => {
  const content = fs.readFileSync('js/main.js', 'utf8');

  assert.match(content, /reading_share_clicked/);
  assert.match(content, /reading_share_completed/);
  assert.doesNotMatch(content, /\bfetch\s*\(/);
  assert.doesNotMatch(content, /\bsendBeacon\s*\(/);
  assert.doesNotMatch(content, /\bdataLayer\b/);
  assert.doesNotMatch(content, /\bgtag\b/);
  assert.doesNotMatch(content, /\bplausible\b/i);
});

test('privacy-safe telemetry posture is documented and visible in generated actions', () => {
  const docs = fs.readFileSync('docs/privacy-safe-telemetry.md', 'utf8');
  const index = fs.readFileSync('index.html', 'utf8');

  assert.match(docs, /does not enable third-party analytics/i);
  assert.match(docs, /No `fetch`, `sendBeacon`, image beacon, third-party script/i);
  assert.match(index, /data-telemetry-event="portfolio_action_clicked"/);
  assert.match(index, /id="site-engineering"/);
});

test('service worker update flow has a single active client implementation', () => {
  const mainScript = fs.readFileSync('js/main.js', 'utf8');

  assert.match(mainScript, /navigator\.serviceWorker\.register\('\/pwabuilder-sw\.js'\)/);
  assert.match(mainScript, /createUpdatePrompt/);
  assert.match(mainScript, /sw-update-prompt-message/);
  assert.doesNotMatch(mainScript, /if \(registration\.waiting\) \{\s*requestActivation\(\);/);
  assert.equal(fs.existsSync('js/pwa-update.js'), false);
  assert.equal(fs.existsSync('js/vendor/pwa-update.js'), false);
});

test('reading page avoids oversized 2x cover variants for known heavy assets', () => {
  const content = fs.readFileSync('reading.html', 'utf8');

  assert.doesNotMatch(content, /book\/2022\/2022-4\.webp 2x/);
  assert.doesNotMatch(content, /book\/2022\/2022-5\.webp 2x/);
  assert.match(content, /book\/2022\/2022-4-300\.webp/);
  assert.match(content, /book\/2022\/2022-5-300\.webp/);
});
