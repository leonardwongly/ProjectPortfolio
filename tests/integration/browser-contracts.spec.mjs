import fs from 'node:fs';
import http from 'node:http';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './browser-fixture.mjs';

test('invalid reading parameters fall back to All and grid, and explicit view toggles round-trip', async ({ page }) => {
  await page.goto('/reading.html?year=invalid&tag=invalid&view=invalid');
  await expect(page.locator('[data-reading-grid]')).toHaveAttribute('data-view', 'grid');
  for (const group of ['Year', 'Tags']) {
    await expect(page.getByRole('group', { name: group }).locator('[data-filter-value="All"]')).toHaveAttribute('aria-pressed', 'true');
  }
  expect(new URL(page.url()).search).toBe('');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('[data-reading-grid]')).toHaveAttribute('data-view', 'list');
  expect(new URL(page.url()).searchParams.get('view')).toBe('list');
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.locator('[data-reading-grid]')).toHaveAttribute('data-view', 'grid');
  expect(new URL(page.url()).searchParams.has('view')).toBe(false);
});

test('archive project identities, status and proof links match the independent source inventory', async ({ page }) => {
  const projects = JSON.parse(fs.readFileSync(new URL('../../data/featured-projects.json', import.meta.url), 'utf8'));
  expect(new Set(projects.map(({ id }) => id)).size).toBe(projects.length);
  await page.goto('/work.html');
  const cards = page.locator('#projects .featured-card');
  await expect(cards).toHaveCount(projects.length);
  for (const project of projects) {
    const card = cards.filter({ has: page.getByRole('heading', { name: project.title, exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(card.locator('.project-status')).toHaveText(`Status${project.status}`);
    for (const link of project.links) await expect(card.getByRole('link', { name: link.label, exact: true })).toHaveAttribute('href', link.url);
    if (project.case_study) await expect(card.getByRole('link', { name: 'Read case study' })).toHaveAttribute('href', project.case_study);
  }
});

test('Space and Enter activate accordion buttons without closing independent groups', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => {
    const clone = document.querySelector('#accordionList').cloneNode(true);
    clone.id = 'independent-accordion';
    clone.querySelectorAll('.accordion-collapse').forEach((panel) => {
      panel.id += '-independent';
      panel.setAttribute('data-bs-parent', '#independent-accordion');
    });
    clone.querySelectorAll('.accordion-button').forEach((button) => {
      button.setAttribute('data-bs-target', `${button.getAttribute('data-bs-target')}-independent`);
      button.setAttribute('aria-controls', `${button.getAttribute('aria-controls')}-independent`);
    });
    document.querySelector('#accordionList').after(clone);
    window.initAccordionState();
  });
  await page.locator('button[aria-controls="collapseCDC"]').press('Space');
  await expect(page.locator('#collapseCDC')).toBeVisible();
  await page.locator('button[aria-controls="collapseCDC-independent"]').press('Enter');
  await expect(page.locator('#collapseCDC-independent')).toBeVisible();
  await expect(page.locator('#collapseCDC')).toBeVisible();
  await page.locator('button[aria-controls="collapseSMU"]').press('Space');
  await expect(page.locator('#collapseCDC')).toBeHidden();
  await expect(page.locator('#collapseSMU')).toBeVisible();
  await expect(page.locator('#collapseCDC-independent')).toBeVisible();
});

for (const change of ['hidden', 'removed']) {
  test(`command palette restores visible main focus when the previous opener is ${change}`, async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => {
      const opener = document.createElement('button');
      opener.id = 'temporary-focus-origin';
      opener.textContent = 'Focus origin';
      document.body.append(opener);
      opener.focus();
    });
    await page.keyboard.press('Control+K');
    await expect(page.locator('#cmdkInput')).toBeFocused();
    await page.evaluate((mode) => {
      const opener = document.getElementById('temporary-focus-origin');
      if (mode === 'hidden') opener.hidden = true; else opener.remove();
      document.querySelectorAll('[data-cmdk-open]').forEach((element) => element.remove());
    }, change);
    await page.keyboard.press('Control+K');
    await expect(page.locator('#commandPalette')).toBeHidden();
    await expect(page.locator('#content')).toBeFocused();
    await expect(page.locator('#content')).toHaveAttribute('tabindex', '-1');
    await page.evaluate(() => {
      const next = document.createElement('button');
      next.textContent = 'Next focus target';
      document.body.append(next);
      next.focus();
    });
    await expect(page.locator('#content')).not.toHaveAttribute('tabindex');
  });
}

test('reading filters identify matching books and retain explicit view without implicit query', async ({ page }) => {
  await page.goto('/reading.html?year=2022&tag=Data&view=list&q=Marvel');
  const visible = page.locator('[data-reading-item]:not([hidden])');
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveAttribute('data-isbn', '978-1400232772');
  await expect(page.locator('[data-reading-count]')).toHaveText(/^1 of \d+ books shown$/);
  await expect(page.locator('[data-reading-grid]')).toHaveAttribute('data-view', 'list');
  await expect(page.locator('#readingSearch')).toHaveValue('Marvel');
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  expect(new URL(page.url()).searchParams.get('year')).toBe('2022');
  expect(new URL(page.url()).searchParams.get('tag')).toBe('Data');
  expect(new URL(page.url()).searchParams.get('view')).toBe('list');
  await page.locator('#readingSearch').fill('Apple in China');
  await expect(visible).toHaveCount(0);
  await expect(page.locator('[data-reading-empty]')).toBeVisible();
  await page.getByRole('group', { name: 'Year' }).locator('[data-filter-value="All"]').click();
  await page.getByRole('group', { name: 'Tags' }).locator('[data-filter-value="All"]').click();
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveAttribute('data-isbn', '978-1668053379');
});

for (const outcome of ['success', 'abort']) {
  test(`native reading share ${outcome} does not fall through to clipboard`, async ({ page }) => {
    await page.addInitScript((result) => {
      window.__shareCalls = [];
      window.__clipboardCalls = [];
      Object.defineProperty(navigator, 'share', { configurable: true, value: async (payload) => {
        window.__shareCalls.push(payload);
        if (result === 'abort') throw new DOMException('Canceled', 'AbortError');
      } });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (value) => window.__clipboardCalls.push(value)
      } });
    }, outcome);
    await page.goto('/reading.html?year=2022&tag=Data&view=list');
    await page.locator('#readingSearch').fill('Marvel');
    await page.locator('[data-reading-share]').click();
    await expect(page.locator('[data-reading-share-status]')).toHaveText(outcome === 'success' ? 'Shared successfully.' : 'Share canceled.');
    const calls = await page.evaluate(() => ({ shares: window.__shareCalls, clipboard: window.__clipboardCalls }));
    expect(calls.shares).toHaveLength(1);
    expect(calls.clipboard).toEqual([]);
    const url = new URL(calls.shares[0].url);
    expect(url.searchParams.get('q')).toBe('Marvel');
    expect(url.searchParams.get('year')).toBe('2022');
    expect(url.searchParams.get('tag')).toBe('Data');
    expect(url.searchParams.get('view')).toBe('list');
    expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  });
}

test('theme choice persists and reduced motion exposes cards without pointer effects', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/index.html');
  await page.evaluate(() => document.querySelector('[data-theme-toggle]').click());
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('[data-theme-toggle]').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hero-section')).toHaveClass(/interactive-card/);
  await expect(page.locator('.hero-section')).not.toHaveClass(/interactive-card-pointer/);
  await expect(page.locator('.hero-section')).toHaveClass(/is-visible/);
});

test('pointer enhancement follows device capability and live reduced motion reveals pending cards', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/index.html');
  const hero = page.locator('.hero-section');
  if (testInfo.project.name.startsWith('desktop-')) await expect(hero).toHaveClass(/interactive-card-pointer/);
  else await expect(hero).not.toHaveClass(/interactive-card-pointer/);
  const pending = page.locator('.experience-card').last();
  await expect(pending).not.toHaveClass(/is-visible/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(pending).toHaveClass(/is-visible/);
  await expect(pending).not.toHaveClass(/reveal-delay-/);
});

for (const storage of ['invalid', 'unavailable']) {
  test(`theme and reveal initialization survive ${storage} storage without IntersectionObserver`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
    await page.addInitScript((mode) => {
      delete window.IntersectionObserver;
      if (mode === 'invalid') {
        localStorage.setItem('theme-preference', 'sepia');
      } else {
        Storage.prototype.getItem = () => { throw new Error('Storage denied'); };
        Storage.prototype.setItem = () => { throw new Error('Storage denied'); };
      }
    }, storage);
    await page.goto('/index.html');
    await expect(page.locator('[data-theme-toggle]').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-theme-toggle]').first()).toHaveAttribute('aria-label', 'Switch to light mode');
    await expect(page.locator('.hero-section')).toHaveClass(/is-visible/);
    await expect(page.locator('.hero-section')).not.toHaveClass(/reveal-delay-/);
    await expect(page.locator('.hero-section')).toBeVisible();
  });
}

test('open command palette and expanded accordion have no tagged axe violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.html');
  await page.keyboard.press('Control+K');
  await expect(page.locator('#commandPalette')).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Control+K');
  await page.locator('button[aria-controls="collapseCDC"]').click();
  await expect(page.locator('#collapseCDC')).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('home project links reach their named evidence pages', async ({ page }) => {
  await page.goto('/index.html');
  const links = await page.locator('#work .featured-card a[href*="case-study-"]').evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  expect(new Set(links).size).toBe(3);
  for (const href of new Set(links)) {
    await page.goto(href);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#evidence')).toBeVisible();
    await expect(page.locator('#tradeoffs')).toBeVisible();
  }
});

test.describe('native worker upgrade', () => {
  test.use({ serviceWorkers: 'allow' });
  test('a waiting native worker accepts Reload and changes control exactly once', async ({ page }) => {
    const source = fs.readFileSync(new URL('../../pwabuilder-sw.js', import.meta.url), 'utf8');
    let revision = 1;
    let failStylesheet = false;
    const files = new Map([
      ['/offline.html', ['text/html', '../../offline.html']],
      ['/css/offline.css', ['text/css', '../../css/offline.css']],
      ['/js/main.js', ['application/javascript', '../../js/main.js']],
      ['/js/vendor/workbox-sw.js', ['application/javascript', '../../js/vendor/workbox-sw.js']],
      ['/js/vendor/workbox/workbox-navigation-preload.prod.js', ['application/javascript', '../../js/vendor/workbox/workbox-navigation-preload.prod.js']]
    ].map(([pathname, [contentType, file]]) => [pathname, { contentType, body: fs.readFileSync(new URL(file, import.meta.url)) }]));
    // Native service-worker script requests bypass page routes in Chromium.
    // This confined loopback fixture serves the same reviewed revision bytes.
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (pathname === '/css/offline.css' && failStylesheet) { response.writeHead(503).end('unavailable'); return; }
      const file = pathname === '/pwabuilder-sw.js'
        ? { contentType: 'application/javascript', body: `${source}\n// isolated-browser-revision-${revision}` }
        : files.get(pathname);
      if (!file) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': file.contentType, 'Cache-Control': 'no-store' }).end(file.body);
    });
    try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Native worker fixture listen timed out')), 5000);
      server.once('error', (error) => { clearTimeout(timeout); reject(error); });
      server.listen(0, '127.0.0.1', () => { clearTimeout(timeout); resolve(); });
    });
    await page.route('**/pwabuilder-sw.js', (route) => route.fulfill({
      contentType: 'application/javascript', body: `${source}\n// isolated-browser-revision-${revision}`
    }));
    await page.goto(`http://127.0.0.1:${server.address().port}/offline.html`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/pwabuilder-sw.js');
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.evaluate(() => {
      const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = (...args) => {
        const promise = register(...args);
        window.__mainWorkerRegistered = promise.then(() => new Promise((resolve) => queueMicrotask(resolve)));
        return promise;
      };
    });
    await page.addScriptTag({ url: '/js/main.js' });
    await page.evaluate(() => window.__mainWorkerRegistered);
    revision = 2;
    failStylesheet = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      window.__failedNativeInstall = new Promise((resolve) => registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing.addEventListener('statechange', () => { if (installing.state === 'redundant') resolve(); });
      }, { once: true }));
    });
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.evaluate(() => window.__failedNativeInstall);
    expect(await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const cache = await caches.open('pwabuilder-offline-cache-v3');
      return { waiting: Boolean(registration.waiting), active: registration.active.state, cached: (await cache.keys()).length };
    })).toEqual({ waiting: false, active: 'activated', cached: 2 });
    await expect(page.locator('.sw-update-prompt')).toHaveCount(0);
    failStylesheet = false;
    revision = 3;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect(page.locator('.sw-update-prompt')).toBeVisible();
    let navigations = 0;
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations += 1; });
    const changed = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
    await page.locator('.sw-update-prompt').getByRole('button', { name: 'Reload' }).click();
    await changed;
    await page.waitForLoadState('load');
    expect(navigations).toBe(1);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting)).toBeNull();
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
  });
});
