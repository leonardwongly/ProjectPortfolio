import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { chromium, devices } from '@playwright/test';

// Local, repeatable lab observations; not field Core Web Vitals or INP.
const root = path.resolve(process.env.PERF_ROOT || '.');
const runs = Number(process.env.PERF_RUNS || 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('PERF_RUNS must be 1–20');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Invalid path');
    const body = await fs.readFile(file);
    const type = types[path.extname(file)] || 'application/octet-stream';
    const compressed = /text|javascript|svg/.test(type);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', ...(compressed ? { 'Content-Encoding': 'gzip' } : {}) });
    res.end(compressed ? gzipSync(body) : body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch();
  const observations = [];
  for (const pagePath of ['/index.html', '/work.html', '/reading.html']) {
    for (let run = 1; run <= runs; run++) {
      const context = await browser.newContext({ ...devices['Pixel 5'], serviceWorkers: 'block' });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.addInitScript(() => {
        window.lab = { lcpMs: null, cls: 0, interactionMs: null };
        new PerformanceObserver(list => { window.lab.lcpMs = list.getEntries().at(-1).startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.lab.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
        document.addEventListener('keydown', () => {
          const start = performance.now();
          requestAnimationFrame(() => requestAnimationFrame(() => { window.lab.interactionMs = performance.now() - start; }));
        }, { once: true });
      });
      await page.coverage.startCSSCoverage();
      await page.goto(`http://127.0.0.1:${server.address().port}${pagePath}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      const navigation = await page.evaluate(() => {
        const resources = [performance.getEntriesByType('navigation')[0], ...performance.getEntriesByType('resource')];
        return { lcpMs: window.lab.lcpMs, cls: window.lab.cls, requests: resources.length, transferBytes: resources.reduce((sum, r) => sum + r.transferSize, 0) };
      });
      await page.keyboard.press('Control+k');
      await page.locator('#commandPalette').waitFor({ state: 'visible' });
      await page.waitForTimeout(150);
      const interactionMs = await page.evaluate(() => window.lab.interactionMs);
      const coverage = await page.coverage.stopCSSCoverage();
      const css = coverage.map(entry => ({ file: new URL(entry.url).pathname, bytes: Buffer.byteLength(entry.text), usedBytes: entry.ranges.reduce((sum, r) => sum + Buffer.byteLength(entry.text.slice(r.start, r.end)), 0) }));
      observations.push({ page: pagePath, run, ...navigation, interactionMs, css });
      await context.close();
    }
  }
  console.log(JSON.stringify({ method: 'Pixel 5 Chromium, 4x CPU, 1.6 Mbps down/750 Kbps up, 150 ms latency, cold context, gzip text; initial viewport plus open palette CSS; keydown-to-second-rAF latency is not INP', observations }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
