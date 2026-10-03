import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const smokeScript = new URL('../../scripts/security-smoke.sh', import.meta.url);
const negativeChecks = [
  { call: 1, message: '[security-smoke] Found unpinned action reference(s).' },
  { call: 2, message: '[security-smoke] Found target=_blank link without noopener+noreferrer.' },
  { call: 3, message: '[security-smoke] Found dangerous URL scheme in generated HTML.' },
  { call: 4, message: "[security-smoke] Found forbidden style-src 'unsafe-inline' in source templates." },
  { call: 8, message: '[security-smoke] Found inline style attribute in generated HTML.' }
];

function smokeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-security-smoke-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(relativePath, content, executable = false) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { mode: executable ? 0o755 : 0o644 });
  }
  write('scripts/security-smoke.sh', fs.readFileSync(smokeScript, 'utf8'));
  write('data/sample.json', '{}\n');
  for (const filename of ['index.html', 'reading.html', 'offline.html']) {
    write(filename, '<!doctype html><p>Safe fixture</p>\n');
    write('src/' + filename, '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">\n');
  }
  write('partials/header.html', '<header>Safe fixture</header>\n');
  write('.github/workflows/gemini-cli.yml', "permissions:\n  contents: 'read'\n");
  write('_headers', "/*\n  Content-Security-Policy: default-src 'self'\n  Permissions-Policy: camera=()\n  X-Frame-Options: DENY\n");
  // Do not run a build or governance script while exercising the shell CLI.
  write('bin/node', '#!/usr/bin/env bash\nexit 0\n', true);
  write('bin/jq', '#!/usr/bin/env bash\nexit 0\n', true);
  // Control the external tool's exit-status contract, not the shell helper.
  // Optional forwarding supports the original reproduction with a real rg.
  write('bin/rg', [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'count=0',
    'if [[ -f "$SMOKE_TEST_RG_COUNTER" ]]; then read -r count < "$SMOKE_TEST_RG_COUNTER"; fi',
    'count=$((count + 1))',
    "printf '%s\\n' \"$count\" > \"$SMOKE_TEST_RG_COUNTER\"",
    'if [[ "$SMOKE_TEST_RG_PCRE_ERROR" == 1 ]]; then',
    '  for arg in "$@"; do',
    '    if [[ "$arg" == -P ]]; then',
    '      echo "[fixture] PCRE is unavailable" >&2',
    '      exit 2',
    '    fi',
    '  done',
    'fi',
    'if [[ "$SMOKE_TEST_RG_ERROR_CALL" == "$count" ]]; then',
    '  echo "[fixture] rg tool failure" >&2',
    '  exit "$SMOKE_TEST_RG_ERROR_STATUS"',
    'fi',
    'if [[ "$SMOKE_TEST_RG_FINDING_CALL" == "$count" ]]; then exit 0; fi',
    'if [[ "$SMOKE_TEST_RG_NO_MATCH_CALL" == "$count" ]]; then exit 1; fi',
    'if [[ "$SMOKE_TEST_REAL_RG" != "" ]]; then exec "$SMOKE_TEST_REAL_RG" "$@"; fi',
    'case "$count" in',
    '  5|6|7|9) exit 0 ;;',
    '  *) exit 1 ;;',
    'esac',
    ''
  ].join('\n'), true);
  const counter = path.join(root, 'rg-counter');
  return {
    run(overrides = {}) {
      fs.rmSync(counter, { force: true });
      const result = spawnSync('bash', [path.join(root, 'scripts/security-smoke.sh')], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH,
          SMOKE_TEST_RG_COUNTER: counter,
          SMOKE_TEST_RG_PCRE_ERROR: '0',
          SMOKE_TEST_RG_ERROR_CALL: '0',
          SMOKE_TEST_RG_ERROR_STATUS: '2',
          SMOKE_TEST_RG_FINDING_CALL: '0',
          SMOKE_TEST_RG_NO_MATCH_CALL: '0',
          SMOKE_TEST_REAL_RG: process.env.SMOKE_TEST_REAL_RG ?? '',
          ...overrides
        }
      });
      assert.equal(result.error, undefined, result.stdout + result.stderr);
      return result;
    },
    calls() {
      return Number(fs.readFileSync(counter, 'utf8').trim());
    }
  };
}

test('security smoke CLI accepts clean no-matches and completes its positive guards', (t) => {
  const fixture = smokeFixture(t);
  const result = fixture.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[security-smoke\] All checks passed\./);
  assert.equal(fixture.calls(), 9);
});

test('security smoke CLI fails closed when PCRE searches are unavailable', (t) => {
  const fixture = smokeFixture(t);
  const result = fixture.run({ SMOKE_TEST_RG_PCRE_ERROR: '1' });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /\[fixture\] PCRE is unavailable/);
  assert.match(result.stderr, /\[security-smoke\] Search failed \(rg exit 2\)/);
  assert.doesNotMatch(result.stdout, /All checks passed/);
  assert.equal(fixture.calls(), 1);
});

test('security smoke CLI rejects tool errors at every negative-match check', (t) => {
  const fixture = smokeFixture(t);
  for (const { call } of negativeChecks) {
    const result = fixture.run({ SMOKE_TEST_RG_ERROR_CALL: String(call) });
    assert.equal(result.status, 2, 'rg invocation ' + call + ': ' + result.stdout + result.stderr);
    assert.match(result.stderr, /\[security-smoke\] Search failed \(rg exit 2\)/);
    assert.doesNotMatch(result.stdout, /All checks passed/);
    assert.equal(fixture.calls(), call);
  }
  const unavailable = fixture.run({ SMOKE_TEST_RG_ERROR_CALL: '1', SMOKE_TEST_RG_ERROR_STATUS: '127' });
  assert.equal(unavailable.status, 127);
  assert.match(unavailable.stderr, /\[security-smoke\] Search failed \(rg exit 127\)/);
});

test('security smoke CLI preserves each original negative-match finding', (t) => {
  const fixture = smokeFixture(t);
  for (const { call, message } of negativeChecks) {
    const result = fixture.run({ SMOKE_TEST_RG_FINDING_CALL: String(call) });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.stderr.includes(message), message);
    assert.doesNotMatch(result.stdout, /All checks passed/);
    assert.equal(fixture.calls(), call);
  }
});

test('security smoke CLI retains required positive-match failures', (t) => {
  const fixture = smokeFixture(t);
  const positiveChecks = [
    { call: 5, message: '[security-smoke] Missing CSP response header in _headers.' },
    { call: 6, message: '[security-smoke] Missing Permissions-Policy in _headers.' },
    { call: 7, message: '[security-smoke] Missing X-Frame-Options: DENY in _headers.' },
    { call: 9, message: '[security-smoke] gemini-cli workflow should default to contents: read.' }
  ];
  for (const { call, message } of positiveChecks) {
    const result = fixture.run({ SMOKE_TEST_RG_NO_MATCH_CALL: String(call) });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.stderr.includes(message), message);
    assert.doesNotMatch(result.stdout, /All checks passed/);
    assert.equal(fixture.calls(), call);
  }
});
