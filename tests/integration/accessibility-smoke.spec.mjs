import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGE_PATHS = [
  '/index.html',
  '/reading.html',
  '/offline.html'
];

test.describe('accessibility smoke', () => {
  for (const pagePath of PAGE_PATHS) {
    test(`${pagePath} has no serious or critical axe violations`, async ({ page }) => {
      await page.goto(pagePath);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const blockingViolations = results.violations.filter((violation) => (
        violation.impact === 'serious' || violation.impact === 'critical'
      ));

      expect(blockingViolations).toEqual([]);
    });
  }
});
