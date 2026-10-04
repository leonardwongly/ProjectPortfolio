import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import config, { parsePort, playwrightStaticRoot, webServerCommand } from '../../playwright.config.mjs';

test('Playwright owns the loopback listener instead of reusing an unexpected server', () => {
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.match(webServerCommand, /scripts\/serve-static\.mjs/);
});

test('Playwright serves a staged deployment allowlist rather than the repository root', () => {
  const root = path.resolve('.');

  assert.ok(webServerCommand.includes(playwrightStaticRoot));
  assert.notEqual(path.resolve(playwrightStaticRoot), root);
  assert.deepEqual(fs.readFileSync(path.join(playwrightStaticRoot, 'index.html')), fs.readFileSync(path.join(root, 'index.html')));
  for (const forbidden of ['.env', 'data', 'src', 'playwright.config.mjs']) assert.equal(fs.existsSync(path.join(playwrightStaticRoot, forbidden)), false);
  assert.equal(fs.existsSync(path.join(playwrightStaticRoot, '.git')), false);
  assert.equal(fs.existsSync(path.join(playwrightStaticRoot, 'package.json')), false);
  assert.equal(fs.existsSync(path.join(playwrightStaticRoot, 'scripts')), false);
});

test('Playwright rejects invalid listener ports before constructing the server command', () => {
  for (const port of ['1', '4173', '65535']) assert.equal(parsePort(port), Number(port));
  for (const port of ['0', '65536', 'not-a-port', ' 4173', '+1', '-1', '1.5', '1 ', '1e3']) {
    assert.throws(() => parsePort(port), /range 1\.\.65535/);
  }
});

test('Playwright rejects an explicitly empty configured port and cleans staging on exit', () => {
  const configUrl = new URL('../../playwright.config.mjs', import.meta.url).href;
  const command = `import fs from 'node:fs';
    const { playwrightStaticRoot } = await import(process.argv[1]);
    process.stdout.write(JSON.stringify({ path: playwrightStaticRoot, exists: fs.existsSync(playwrightStaticRoot) }));`;
  const emptyPort = spawnSync(process.execPath, ['--input-type=module', '--eval', command, configUrl], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, PLAYWRIGHT_PORT: '' }
  });

  assert.ifError(emptyPort.error);
  assert.equal(emptyPort.signal, null);
  assert.notEqual(emptyPort.status, 0);
  assert.match(`${emptyPort.stdout}${emptyPort.stderr}`, /range 1\.\.65535/);

  const stagedSite = spawnSync(process.execPath, ['--input-type=module', '--eval', command, configUrl], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, PLAYWRIGHT_PORT: '4173' }
  });
  assert.ifError(stagedSite.error);
  assert.equal(stagedSite.signal, null);
  assert.equal(stagedSite.status, 0, stagedSite.stderr);
  const stage = JSON.parse(stagedSite.stdout);
  assert.equal(stage.exists, true);
  assert.equal(path.isAbsolute(stage.path), true);
  assert.match(path.basename(stage.path), /^projectportfolio-playwright-/);
  assert.equal(fs.existsSync(stage.path), false);
});

for (const failure of ['missing', 'symlink', ...(process.platform === 'win32' ? [] : ['fifo'])]) {
  test(`failed Playwright staging cleans its private directory (${failure})`, (t) => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-stage-fixture-'));
    t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
    const files = ['.well-known/service-doc.html', 'case-study-agentforge.html', 'case-study-agentic.html', 'case-study-apple-calendar-mcp.html', 'index.html', 'offline.html', 'reading.html', 'work.html', 'manifest.json', 'pwabuilder-sw.js', 'robots.txt', 'sitemap.xml'];
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      fs.writeFileSync(path.join(fixture, file), 'allowed fixture');
    }
    for (const dir of ['book', 'css', 'favicon', 'fonts', 'images', 'js']) fs.mkdirSync(path.join(fixture, dir));
    if (failure === 'missing') fs.unlinkSync(path.join(fixture, 'case-study-agentforge.html'));
    if (failure === 'symlink') fs.symlinkSync(path.join(fixture, 'index.html'), path.join(fixture, 'js', 'linked.js'));
    if (failure === 'fifo') {
      const fifo = spawnSync('mkfifo', [path.join(fixture, 'js', 'special.js')], { timeout: 3000 });
      assert.ifError(fifo.error); assert.equal(fifo.status, 0);
    }
    const configPath = path.join(fixture, 'playwright.config.mjs');
    fs.copyFileSync(new URL('../../playwright.config.mjs', import.meta.url), configPath);
    fs.symlinkSync(path.resolve('node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const command = `import fs from 'node:fs';
      const original = fs.mkdtempSync;
      let stage;
      fs.mkdtempSync = (...args) => { stage = original(...args); return stage; };
      try {
        await import(process.argv[1]);
        process.exitCode = 99;
      } catch (error) {
        process.stdout.write(JSON.stringify({ stage, message: error.message }));
        process.exitCode = 1;
      }`;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', command, pathToFileURL(configPath).href], {
      encoding: 'utf8', timeout: 15000, env: { ...process.env, PLAYWRIGHT_PORT: '4173' }
    });
    assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.status, 1, child.stderr);
    const record = JSON.parse(child.stdout);
    t.after(() => fs.rmSync(record.stage, { recursive: true, force: true }));
    assert.equal(path.isAbsolute(record.stage), true);
    assert.match(path.basename(record.stage), /^projectportfolio-playwright-/);
    assert.match(record.message, failure === 'missing' ? /artifact is missing/ : failure === 'symlink' ? /symbolic link/ : /unsupported file type/);
    assert.equal(fs.existsSync(record.stage), false, 'failed import leaves no private stage');
  });
}
