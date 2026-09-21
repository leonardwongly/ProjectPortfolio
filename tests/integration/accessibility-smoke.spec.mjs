import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { routeLoopbackHttpsRequests } from './local-http-compat.mjs';

test.beforeEach(async ({ page }) => {
  await routeLoopbackHttpsRequests(page);
});

const PAGE_PATHS = [
  '/index.html',
  '/work.html',
  '/case-study-agentforge.html',
  '/case-study-agentic.html',
  '/case-study-apple-calendar-mcp.html',
  '/reading.html',
  '/offline.html'
];

const THEMES = ['light', 'dark'];

test.describe('accessibility smoke', () => {
  for (const pagePath of PAGE_PATHS) {
    for (const theme of THEMES) {
      test(`${pagePath} (${theme}) has no axe violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.goto(pagePath);

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();

        expect(results.violations).toEqual([]);
      });
    }
  }
});

for (const theme of THEMES) {
  test(`opened interactive states (${theme}) have no axe violations`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/index.html');
    const check = async () => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    };
    if (testInfo.project.name.startsWith('mobile-')) {
      await page.locator('.navbar-toggler').click();
      await expect(page.locator('#navbarCollapse')).toHaveClass(/\bshow\b/);
      await check();
    }
    await page.locator('[data-cmdk-open]').first().click();
    await expect(page.locator('#cmdkInput')).toBeFocused();
    await check();
    await page.locator('[data-cmdk-close]').click();
    await expect(page.locator('#commandPalette')).toBeHidden();
    const expanded = page.locator('button[aria-controls="collapseCDC"]');
    await page.evaluate(() => {
      document.querySelectorAll('.section-block').forEach((section) => {
        section.style.contentVisibility = 'visible';
      });
    });
    await expanded.scrollIntoViewIfNeeded();
    await expanded.click();
    await expect(expanded).toHaveAttribute('aria-expanded', 'true');
    await check();
  });
}

test('pages reflow at 320 CSS pixels without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const pagePath of PAGE_PATHS) {
    await page.goto(pagePath);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), pagePath).toBe(true);
  }
});
