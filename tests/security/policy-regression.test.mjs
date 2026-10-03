import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { collectTelemetryPolicyFindings, inspectRuntimeSource } from '../../scripts/check-telemetry-policy.mjs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { renderCspScriptHashesDirective } = require('../../scripts/build.js');

const SOURCE_HTML_FILES = [
  'src/index.html',
  'src/work.html',
  'src/case-study.html',
  'src/reading.html',
  'src/offline.html'
];

const GENERATED_HTML_FILES = [
  'index.html',
  'work.html',
  'case-study-agentforge.html',
  'case-study-agentic.html',
  'case-study-apple-calendar-mcp.html',
  'reading.html',
  'offline.html'
];

const HEADERS_FILE = '_headers';
const GEMINI_ACTION_REFERENCE = /^        uses: 'google-github-actions\/run-gemini-cli@f77273f4c914e4bf38440cf36a0369cb64a37489' # ratchet:google-github-actions\/run-gemini-cli@v0\.1\.22$/m;

test('discovery catalog advertises only static data files that the site serves', () => {
  const catalog = JSON.parse(fs.readFileSync('.well-known/openapi.json', 'utf8'));
  const endpointPaths = Object.keys(catalog.paths ?? {});

  assert.ok(endpointPaths.length > 0, 'The static data catalog must not be empty');
  endpointPaths.forEach((endpointPath) => {
    assert.match(endpointPath, /^\/data\/[a-z0-9-]+\.json$/);
    assert.deepEqual(Object.keys(catalog.paths[endpointPath]), ['get']);
    const targetPath = path.join('.', endpointPath);
    const stats = fs.lstatSync(targetPath);
    assert.equal(stats.isFile(), true, `${endpointPath} must be a served static file`);
  });

  const headers = fs.readFileSync('src/_headers.template', 'utf8');
  for (const discoveryFile of [
    '.well-known/api-catalog',
    '.well-known/openapi.json',
    '.well-known/service-doc.html',
    '.well-known/describedby',
    '.well-known/status'
  ]) {
    assert.equal(fs.lstatSync(discoveryFile).isFile(), true, `${discoveryFile} must be published`);
  }
  assert.match(headers, /\.well-known\/api-catalog/);
  assert.match(headers, /\.well-known\/openapi\.json/);

  for (const retiredClaim of [
    '.well-known/acp.json',
    '.well-known/agent-card.json',
    '.well-known/agent-skills/index.json',
    '.well-known/mcp/server-card.json',
    '.well-known/oauth-authorization-server',
    '.well-known/openid-configuration',
    '.well-known/ucp',
    'auth.md',
    'openapi.json'
  ]) {
    assert.equal(fs.existsSync(retiredClaim), false, `${retiredClaim} is an unsupported discovery claim`);
  }
});

test('scan workflow enforces dependency audit and vendor governance gates', () => {
  const content = fs.readFileSync('.github/workflows/scan.yml', 'utf8');

  assert.match(content, /npm run audit:high/);
  assert.match(content, /npm run validate:vendor:governance/);
  assert.doesNotMatch(content, /npm run validate:vendor(?:\s|$)/);
});

test('Gemini workflow keeps model sessions separate from GitHub and Git authority', () => {
  const content = fs.readFileSync('.github/workflows/gemini-cli.yml', 'utf8');
  const planJobStart = content.indexOf('  gemini-cli-plan:');
  const executeJobStart = content.indexOf('  gemini-cli-execute:');

  assert.ok(planJobStart >= 0, 'Missing Gemini planning job');
  assert.ok(executeJobStart > planJobStart, 'Missing Gemini execution job after planning job');

  const planJob = content.slice(planJobStart, executeJobStart);
  const executeJob = content.slice(executeJobStart);

  assert.doesNotMatch(planJob, /actions\/create-github-app-token/);
  assert.doesNotMatch(planJob, /run_shell_command\(/);
  assert.match(planJob, /"coreTools": \["write_file"\]/);
  assert.match(planJob, /Post validated planning response/);
  const planningActionStart = planJob.indexOf("- name: 'Run Gemini planning'");
  const planningPostStart = planJob.indexOf("- name: 'Post validated planning response'");
  const planningAction = planJob.slice(planningActionStart, planningPostStart);
  assert.doesNotMatch(planningAction, /GITHUB_TOKEN:/);
  assert.match(planningAction, GEMINI_ACTION_REFERENCE);
  assert.doesNotMatch(planJob, /actions\/checkout@/);
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

  assert.doesNotMatch(executeJob, /actions\/create-github-app-token/);
  assert.match(executeJob, /request_type=plan_execution/);
  assert.match(executeJob, /plan#\$\{PLAN_ID\}/);
  assert.match(executeJob, /github-actions\[bot\]/);
  assert.doesNotMatch(executeJob, /run_shell_command\(/);
  assert.match(executeJob, /"coreTools": \["write_file"\]/);
  assert.match(executeJob, /Validate and publish implementation guidance/);
  assert.match(executeJob, /no file-read, shell, GitHub, Git, comment, or token-backed tools/);
  assert.match(executeJob, /Never attempt to commit, push, create branches, create pull requests, or post comments/);
  const executionActionStart = executeJob.indexOf("- name: 'Run Gemini execution'");
  const executionPostStart = executeJob.indexOf("- name: 'Validate and publish implementation guidance'");
  const executionAction = executeJob.slice(executionActionStart, executionPostStart);
  assert.doesNotMatch(executionAction, /GITHUB_TOKEN:/);
  assert.match(executionAction, GEMINI_ACTION_REFERENCE);
  assert.doesNotMatch(executeJob, /actions\/checkout@/);
  assert.doesNotMatch(executeJob, /git (?:add|commit|push)\b/);
});

test('Gemini workflow removes GitHub App bootstrap and branch automation in favor of deterministic response validation', () => {
  const content = fs.readFileSync('.github/workflows/gemini-cli.yml', 'utf8');
  const planJobStart = content.indexOf('  gemini-cli-plan:');
  const executeJobStart = content.indexOf('  gemini-cli-execute:');
  const planJob = content.slice(planJobStart, executeJobStart);
  const executeJob = content.slice(executeJobStart);
  const executeJobPermissions = executeJob.slice(0, executeJob.indexOf('steps:'));

  assert.doesNotMatch(content, /actions\/create-github-app-token/);
  assert.doesNotMatch(content, /generate_token/);
  assert.doesNotMatch(content, /BRANCH_NAME/);
  assert.doesNotMatch(content, /Create new branch for issue/);
  assert.doesNotMatch(content, /Set up git user for commits/);
  assert.doesNotMatch(content, /Validate token for plan execution/);
  assert.doesNotMatch(content, /Please respond to me by commenting your response/);

  assert.doesNotMatch(executeJobPermissions, /id-token/);
  assert.match(planJob, /id-token: 'write'/);

  [planJob, executeJob].forEach((job) => {
    assert.match(job, /if \[\[ ! -f response\.md \|\| -L response\.md \]\]; then/);
    assert.match(job, /if \(\( \$\(wc -c < response\.md\) > 60000 \)\); then/);
    assert.match(job, /GH_CONFIG_DIR: '\$\{\{ runner\.temp \}\}/);
  });

  assert.doesNotMatch(content, /actions\/checkout@/);
});

test('required CI workflows use the authoritative generated-file inventory', () => {
  for (const file of ['.github/workflows/build.yml', '.github/workflows/scan.yml']) {
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /run: npm run check:generated/);
    assert.doesNotMatch(content, /git diff --exit-code -- index\.html reading\.html offline\.html _headers/);
  }
});

test('the security coverage contract and required CI workflows enforce exact thresholds', () => {
  const coverageCommand = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    .scripts['test:security:coverage'];
  const thresholds = [...coverageCommand.matchAll(
    /--test-coverage-(lines|branches|functions)=(\d+)/g
  )].map((match) => [match[1], Number(match[2])]);
  const includes = [...coverageCommand.matchAll(
    /--test-coverage-include=(?:'([^']+)'|"([^"]+)"|(\S+))/g
  )].map((match) => match[1] || match[2] || match[3]);

  assert.deepEqual(thresholds, [
    ['lines', 75],
    ['branches', 75],
    ['functions', 85]
  ]);
  assert.deepEqual(includes, [
    'scripts/**/*.js',
    'scripts/**/*.mjs',
    'scripts/**/*.cjs',
    'playwright.config.mjs',
    'pwabuilder-sw.js'
  ]);

  for (const file of ['.github/workflows/build.yml', '.github/workflows/scan.yml']) {
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /run: npm run test:security:coverage/);
    assert.doesNotMatch(content, /run: npm run test:security(?:\s|$)/);
  }
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

test('every generated HTML page has a CSP on its clean URL', () => {
  const rules = fs.readFileSync('src/_headers.template', 'utf8')
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const [route, ...headers] = block.split('\n');
      return { route, headers: headers.join('\n') };
    });

  for (const file of GENERATED_HTML_FILES) {
    const cleanUrl = file === 'index.html' ? '/' : `/${file.slice(0, -'.html'.length)}`;
    const matchingRule = rules.find(({ route, headers }) => {
      const matches = route === cleanUrl ||
        (route.endsWith('*') && cleanUrl.startsWith(route.slice(0, -1)));
      return matches && /\bContent-Security-Policy:/.test(headers);
    });

    assert.ok(matchingRule, `${cleanUrl} must receive an HTTP Content-Security-Policy header`);
    assert.match(matchingRule.headers, /frame-ancestors 'none'/);
  }
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
  assert.match(content, /Vary:\s*Accept/i);
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


test('each canonical clean and HTML route matches exactly one response CSP rule', () => {
  const routes = ['/', '/index.html', '/work', '/work.html', '/reading', '/reading.html', '/offline', '/offline.html',
    '/.well-known/service-doc', '/.well-known/service-doc.html'];
  for (const name of ['agentforge', 'agentic', 'apple-calendar-mcp']) {
    routes.push(`/case-study-${name}`, `/case-study-${name}.html`);
  }
  for (const file of ['src/_headers.template', '_headers']) {
    const blocks = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (line.startsWith('/')) blocks.push({ route: line.trim(), csp: [], cors: [] });
      else if (/^  Content-Security-Policy:/.test(line)) blocks.at(-1).csp.push(line.trim());
      else if (/^  Access-Control-Allow-Origin:/.test(line)) blocks.at(-1).cors.push(line.trim());
    }
    for (const route of routes) {
      const matched = blocks.filter((block) => {
        const pattern = block.route.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        return new RegExp(`^${pattern}$`).test(route);
      });
      const policies = matched.flatMap((block) => block.csp);
      assert.equal(policies.length, 1, `${file} ${route} must receive one unambiguous CSP`);
      assert.match(policies[0], /frame-ancestors 'none'/);
      assert.match(policies[0], /script-src 'self'/);
      assert.deepEqual(matched.flatMap((block) => block.cors), ['Access-Control-Allow-Origin: https://leonardwong.tech']);
    }
  }
});

test('telemetry policy rejects DOM resource beacons and ordinary method aliases', () => {
  const probes = [
    "document.createElement('img').src = '/collect';",
    "document['createElement']('img');",
    "document['create'+'Element']('img');",
    "const make=document['create'+'Element']; make('img');",
    "const make=document.createElement; make.call(document,'img');",
    "document.createElement.apply(document,['img']);",
    "document.createElement?.('img');",
    "document['createElement']?.('img');",
    "document.createElement?.call(document, 'img');",
    "document.createElementNS('http://www.w3.org/1999/xhtml', 'img');",
    "const make = document.createElement.bind(document); const alias = make; alias('img');",
    "const {createElement: make} = document; make('script');",
    "const make = document.createElement; make(dynamicTag);",
    "const element = document.querySelector('img'); element.setAttribute('src', '/collect');",
    "const put = element.setAttribute.bind(element); const alias = put; alias('src', '/collect');",
    "document.querySelector('img').setAttribute?.('src', '/collect');",
    "const put = element.setAttribute\nput.call(element, 'src', '/collect');",
    "const put = element.setAttribute\nconst alias = put.bind(element)\nalias('src', '/collect');",
    "const put = element['setAttribute']\nput.call(element, 'src', '/collect');",
    "element.setAttributeNS(null, 'src', '/collect');",
    "element['src'] = '/collect';",
    "element['s'+'rc'] = '/collect';",
    "element['set'+'Attribute']('src', '/collect');",
    "element.srcset = '/collect 1x';",
    "element.innerHTML = '<img src=/collect>';",
    "document.write('<img src=/collect>');",
    "element.insertAdjacentHTML('beforeend', '<img src=/collect>');",
    "element.style.setProperty('background-image', 'url(/collect)');",
    "sheet.insertRule('body {background:url(/collect)}');",
    "new Worker('/unreviewed-worker.js');",
    "import('/unreviewed-module.js');"
  ];
  for (const source of probes) assert.ok(inspectRuntimeSource(source).length, source);
  assert.deepEqual(inspectRuntimeSource("const p=document.createElement('p'); p.setAttribute('aria-live','polite'); p.textContent='Ready';"), []);
  assert.deepEqual(inspectRuntimeSource("const p=document.createElement?.('p'); p.setAttribute?.('aria-live','polite');"), []);
  assert.deepEqual(inspectRuntimeSource("const put = element.setAttribute\nconst alias = put.bind(element)\nalias('aria-live', 'polite');"), []);
  assert.deepEqual(inspectRuntimeSource("const note='document.createElement img src'; const pattern=/createElement|src/;"), []);
});

test('composed event arguments require a guard and trackEvent assignments invalidate guard trust', () => {
  const prefix = "const TELEMETRY_ALLOWED_EVENTS = new Set(['portfolio_action_clicked']);";
  const guard = 'if (!TELEMETRY_ALLOWED_EVENTS.has(eventName)) return;';
  for (const expression of [
    "'portfolio_action_clicked' + suffix",
    "'portfolio_action_clicked'.replace('action', 'secret')",
    "'portfolio_action_clicked' ? dynamic : other"
  ]) {
    const unguarded = `function trackEvent(eventName) { emit(eventName); } trackEvent(${expression});`;
    assert.ok(inspectRuntimeSource(unguarded).some((finding) => finding.includes('dynamic telemetry event name')), expression);
    assert.deepEqual(inspectRuntimeSource(`${prefix} function trackEvent(eventName) {${guard}} trackEvent(${expression});`), []);
  }
  const reassigned = `${prefix} function trackEvent(eventName) {${guard}} trackEvent = (eventName) => emit(eventName); trackEvent(dynamic);`;
  const findings = inspectRuntimeSource(reassigned);
  assert.ok(findings.some((finding) => finding.includes('trackEvent must not be reassigned')));
  assert.ok(findings.some((finding) => finding.includes('dynamic telemetry event name')));
  assert.ok(inspectRuntimeSource('trackEvent?.(dynamic);').some((finding) => finding.includes('dynamic telemetry event name')));
  assert.deepEqual(inspectRuntimeSource("function trackEvent(eventName) { emit(eventName); } trackEvent('portfolio_action_clicked', {});"), []);
});

test('only an initial top-level rejecting trackEvent guard protects dynamic events', () => {
  const prefix = "const TELEMETRY_ALLOWED_EVENTS = new Set(['portfolio_action_clicked']);";
  const guard = 'if (!TELEMETRY_ALLOWED_EVENTS.has(eventName)) return;';
  for (const body of [
    `if(false) { ${guard} }`,
    `function neverCalled() { ${guard} }`,
    `emit(eventName); ${guard}`,
    `if (!TELEMETRY_ALLOWED_EVENTS.has(eventName)) { if(false) return; }`
  ]) {
    const findings = inspectRuntimeSource(`${prefix} function trackEvent(eventName) { ${body} } trackEvent(dynamic);`);
    assert.ok(findings.some((finding) => finding.includes('dynamic telemetry event name')), body);
  }
  assert.ok(inspectRuntimeSource(`${prefix} if(false) {function trackEvent(eventName) {${guard}}} trackEvent(dynamic);`).length);
  assert.ok(inspectRuntimeSource(`${prefix} function trackEvent(eventName) {${guard}} function trackEvent(eventName) {} trackEvent(dynamic);`).length);
  assert.deepEqual(inspectRuntimeSource(`${prefix} function trackEvent(eventName) {${guard} emit(eventName);} trackEvent(dynamic);`), []);
});

test('runtime inventory rejects additional executables, script references, inline source, and worker drift', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-runtime-inventory-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  for (const file of ['js', 'src', '.well-known', 'css', 'pwabuilder-sw.js', ...GENERATED_HTML_FILES]) {
    fs.cpSync(file, path.join(rootDir, file), { recursive: true });
  }
  fs.mkdirSync(path.join(rootDir, 'docs/security'), { recursive: true });
  fs.copyFileSync('docs/security/vendor-dependencies.json', path.join(rootDir, 'docs/security/vendor-dependencies.json'));
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs/security/vendor-dependencies.json'), 'utf8'));
  const collect = () => collectTelemetryPolicyFindings({ rootDir, enforceRuntimeInventory: true, today: manifest.last_reviewed });
  assert.deepEqual(collect(), []);
  fs.writeFileSync(path.join(rootDir, 'js/extra.js'), 'document.createElement("img").src="/collect";');
  assert.ok(collect().some((finding) => finding.includes('js/extra.js') && finding.includes('not classified')));
  fs.unlinkSync(path.join(rootDir, 'js/extra.js'));
  const page = path.join(rootDir, 'src/work.html');
  const originalPage = fs.readFileSync(page, 'utf8');
  fs.writeFileSync(page, originalPage + '<script src="/unreviewed.js"></script>');
  assert.ok(collect().some((finding) => finding.includes('not a scanned page runtime')));
  fs.writeFileSync(page, originalPage + '<script>trackEvent(dynamic)</script>');
  assert.ok(collect().some((finding) => finding.includes('inline executable script')));
  for (const script of [
    "<script>fetch('/collect')</script data-policy>",
    "<script>fetch('/collect')</script/>",
    '<script data-note=">">trackEvent(dynamic)</script>',
    '<script src="js/main.js" src="/unreviewed.js"></script>',
    '<script type="application/ld+json">not JSON</script>'
  ]) {
    const generatedPage = path.join(rootDir, 'index.html');
    const originalGenerated = fs.readFileSync('index.html', 'utf8');
    fs.writeFileSync(generatedPage, originalGenerated.replace('</body>', `${script}</body>`));
    assert.ok(collect().some((finding) => finding.startsWith('index.html:')), script);
    fs.writeFileSync(generatedPage, originalGenerated);
  }
  for (const inert of [
    "<!-- <script>fetch('/collect')</script> -->",
    "<textarea><script>fetch('/collect')</script></textarea>",
    '<div title="<script>trackEvent(dynamic)</script>">Text</div>',
    '<script src="js&#47;main.js"></script>'
  ]) {
    fs.writeFileSync(page, originalPage.replace('</body>', `${inert}</body>`));
    assert.deepEqual(collect(), [], inert);
  }
  fs.writeFileSync(page, originalPage);
  fs.appendFileSync(path.join(rootDir, 'pwabuilder-sw.js'), '\n// unreviewed change\n');
  assert.ok(collect().some((finding) => finding.includes('source changed since security review')));
});
