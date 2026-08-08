import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import config, { parseIntegrationPort } from '../../playwright.config.mjs';

test('Playwright port parsing rejects malformed and out-of-range values', () => {
  assert.equal(parseIntegrationPort('1'), 1);
  assert.equal(parseIntegrationPort('65535'), 65535);

  for (const value of ['', '0', '65536', '-1', '1.5', '12px', ' 4173', '9'.repeat(100)]) {
    assert.throws(() => parseIntegrationPort(value), /range 1\.\.65535/);
  }
});

test('local Playwright runs bind a loopback server and can reuse it outside CI', () => {
  const configuredPort = parseIntegrationPort();
  assert.equal(config.webServer.url, `http://127.0.0.1:${configuredPort}/index.html`);
  assert.equal(config.use.baseURL, `http://127.0.0.1:${configuredPort}`);
  assert.ok(
    config.webServer.command.includes(
      `python3 -m http.server ${configuredPort} --bind 127.0.0.1`
    )
  );
  assert.equal(config.webServer.reuseExistingServer, !process.env.CI);
  assert.equal(config.use.serviceWorkers, 'block');
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
