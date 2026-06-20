import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGE_PATHS = [
  '/index.html',
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
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();

        expect(results.violations).toEqual([]);
      });
    }
  }
});
