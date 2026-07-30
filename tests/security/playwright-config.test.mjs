import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('local Playwright runs can reuse an existing static server', () => {
  const content = fs.readFileSync('playwright.config.mjs', 'utf8');

  assert.match(content, /reuseExistingServer:\s*!process\.env\.CI/);
});

test('browser validation scripts install Chromium and execute their test suites', () => {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const expectedSuites = {
    'test:integration': 'tests/integration/mobile-nav-and-accordion.spec.mjs',
    'check:accessibility': 'tests/integration/accessibility-smoke.spec.mjs'
  };

  for (const [scriptName, suite] of Object.entries(expectedSuites)) {
    assert.match(packageJson.scripts[scriptName], /playwright install chromium/);
    assert.ok(packageJson.scripts[scriptName].includes(`playwright test ${suite}`));
  }

  assert.equal(packageJson.scripts['pretest:integration'], undefined);
  assert.equal(packageJson.scripts['precheck:accessibility'], undefined);
});
