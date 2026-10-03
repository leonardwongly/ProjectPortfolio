import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('real worker registers and serves its offline assets on localhost', async ({ page, context, baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'Clearing the HTTP cache requires the Chromium DevTools protocol.');
  const localhostURL = new URL('/offline.html', baseURL);
  localhostURL.hostname = 'localhost';
  await page.goto(localhostURL.href);
  const activeScriptURL = await page.evaluate(async () => {
    await navigator.serviceWorker.register('/pwabuilder-sw.js');
    const registration = await navigator.serviceWorker.ready;
    return registration.active.scriptURL;
  });
  expect(activeScriptURL).toBe(new URL('/pwabuilder-sw.js', localhostURL).href);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const session = await context.newCDPSession(page);
  await session.send('Network.clearBrowserCache');
  await session.detach();
  await context.setOffline(true);
  await page.goto(new URL('/unavailable/nested/page', localhostURL).href);
  await expect(page.getByRole('heading', { level: 1, name: 'You’re offline right now.' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const stylesheet = document.querySelector('link[rel="stylesheet"]');
    return Boolean(stylesheet?.sheet && stylesheet.sheet.cssRules.length > 0);
  })).toBe(true);
});

for (const colorScheme of ['light', 'dark']) {
  test(`offline fallback retains its styles and visible links with an empty HTTP cache (${colorScheme})`, async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Clearing the HTTP cache requires the Chromium DevTools protocol.');
    await page.emulateMedia({ colorScheme });
    await page.goto('/index.html');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    const session = await context.newCDPSession(page);
    await session.send('Network.clearBrowserCache');
    await session.detach();
    await context.setOffline(true);
    await page.goto('/unavailable/nested/page');

    await expect(page.getByRole('heading', { level: 1, name: 'You’re offline right now.' })).toBeVisible();
    await expect(page.locator('script, button')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const stylesheet = document.querySelector('link[rel="stylesheet"]');
      return Boolean(stylesheet?.sheet && stylesheet.sheet.cssRules.length > 0);
    })).toBe(true);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
      .toBe(colorScheme === 'dark' ? 'rgb(21, 21, 21)' : 'rgb(247, 241, 234)');

    for (const [name, pathname] of [['Home', '/index.html'], ['Work', '/work.html'], ['Reading', '/reading.html']]) {
      const link = page.getByRole('navigation', { name: 'Site pages' }).getByRole('link', { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', pathname);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${pathname.replaceAll('.', '\\.')}$`));
      await expect(page.getByRole('heading', { level: 1, name: 'You’re offline right now.' })).toBeVisible();
    }

    await context.setOffline(false);
    await page.getByRole('link', { name: 'Work', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Systems, tools, and public-interest products' })).toBeVisible();
  });
}

test('real worker activation preserves unrelated caches and removes its retired offline cache', async ({ page }) => {
  await page.goto('/offline.html');
  await page.evaluate(async () => {
    await caches.open('pwabuilder-offline-cache-v2');
    await caches.open('unrelated-application-cache');
    await navigator.serviceWorker.register('/pwabuilder-sw.js');
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const names = await page.evaluate(() => caches.keys());
  expect(names).toContain('pwabuilder-offline-cache-v3');
  expect(names).toContain('unrelated-application-cache');
  expect(names).not.toContain('pwabuilder-offline-cache-v2');
});
