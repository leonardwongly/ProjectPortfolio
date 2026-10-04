import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { test as base, expect } from '@playwright/test';

export { expect };
export const test = base.extend({
  firstPartyCoverage: [async ({ page, context, browser, browserName }, use, testInfo) => {
    const directory = process.env.BROWSER_COVERAGE_DIR;
    if (!directory || browserName !== 'chromium') {
      await use();
      return;
    }
    const session = await context.newCDPSession(page);
    const scripts = new Map();
    const pending = [];
    session.on('Debugger.scriptParsed', ({ scriptId, url }) => {
      let pathname;
      try { pathname = new URL(url).pathname; } catch { return; }
      if (!['/js/main.js', '/js/site.js'].includes(pathname)) return;
      const entry = { scriptId, url, pathname };
      scripts.set(scriptId, entry);
      pending.push(session.send('Debugger.getScriptSource', { scriptId }).then(({ scriptSource }) => {
        entry.source = scriptSource;
        entry.sha256 = crypto.createHash('sha256').update(scriptSource).digest('hex');
      }).catch((error) => { entry.sourceError = error.message; }));
    });
    await session.send('Debugger.enable');
    await session.send('Profiler.enable');
    await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    try {
      await use();
    } finally {
      const { result } = await session.send('Profiler.takePreciseCoverage');
      await Promise.all(pending);
      const entries = result.filter(({ scriptId }) => scripts.has(scriptId))
        .map(({ scriptId, functions }) => ({ ...scripts.get(scriptId), functions }));
      await session.send('Profiler.stopPreciseCoverage');
      await session.detach();
      fs.mkdirSync(directory, { recursive: true });
      const name = `${testInfo.project.name}-${crypto.randomUUID()}.json`;
      const target = path.join(directory, name);
      const temporary = `${target}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({
        format: 'native-v8-functions-ranges', test: testInfo.titlePath,
        project: testInfo.project.name, browserVersion: browser.version(), status: testInfo.status, entries
      }), { flag: 'wx' });
      fs.renameSync(temporary, target);
    }
  }, { auto: true }]
});
