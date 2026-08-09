import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import config, { parsePort, playwrightStaticRoot, webServerCommand } from '../../playwright.config.mjs';

test('Playwright owns the loopback listener instead of reusing an unexpected server', () => {
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.match(webServerCommand, /--bind 127\.0\.0\.1/);
});

test('Playwright serves a staged deployment allowlist rather than the repository root', () => {
  const root = path.resolve('.');

  assert.match(webServerCommand, /--directory/);
  assert.notEqual(path.resolve(playwrightStaticRoot), root);
  assert.ok(fs.existsSync(path.join(playwrightStaticRoot, 'index.html')));
  assert.equal(fs.existsSync(path.join(playwrightStaticRoot, '.git')), false);
  assert.equal(fs.existsSync(path.join(playwrightStaticRoot, 'package.json')), false);
  assert.equal(fs.existsSync(path.join(playwrightStaticRoot, 'scripts')), false);
});

test('Playwright rejects invalid listener ports before constructing the server command', () => {
  assert.equal(parsePort('4173'), 4173);
  for (const port of ['0', '65536', 'not-a-port', ' 4173']) {
    assert.throws(() => parsePort(port), /range 1\.\.65535/);
  }
});
