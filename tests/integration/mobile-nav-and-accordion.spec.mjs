import { expect, test } from '@playwright/test';

function isMobileProject(testInfo) {
  return testInfo.project.name.startsWith('mobile-');
}

function isDesktopProject(testInfo) {
  return testInfo.project.name.startsWith('desktop-');
}

test.describe('mobile navigation', () => {
  test('navbar toggles and collapses after selecting a nav item', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'Mobile collapse behavior is only valid at mobile breakpoints.');
    await page.goto('/index.html');

    const toggle = page.locator('.navbar-toggler');
    const collapsePanel = page.locator('#navbarCollapse');
    const workLink = page.locator('#navbarCollapse .nav-link[href$="#work"]');

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(collapsePanel).not.toHaveClass(/\bshow\b/);

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(collapsePanel).toHaveClass(/\bshow\b/);

    await workLink.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(collapsePanel).not.toHaveClass(/\bshow\b/);
  });

  test('navbar closes on Escape for keyboard users', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'Mobile collapse behavior is only valid at mobile breakpoints.');
    await page.goto('/index.html');

    const toggle = page.locator('.navbar-toggler');
    const collapsePanel = page.locator('#navbarCollapse');
    const firstNavLink = page.locator('#navbarCollapse .nav-link').first();

    await toggle.click();
    await expect(collapsePanel).toHaveClass(/\bshow\b/);
    await firstNavLink.focus();

    await firstNavLink.press('Escape');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(collapsePanel).not.toHaveClass(/\bshow\b/);
  });

  test('navbar closes on Escape when focus remains on the toggle', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'Mobile collapse behavior is only valid at mobile breakpoints.');
    await page.goto('/index.html');

    const toggle = page.locator('.navbar-toggler');
    const collapsePanel = page.locator('#navbarCollapse');

    await toggle.focus();
    await toggle.press('Enter');

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(collapsePanel).toHaveClass(/\bshow\b/);

    await toggle.press('Escape');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(collapsePanel).not.toHaveClass(/\bshow\b/);
    await expect(toggle).toBeFocused();
  });
});

test.describe('desktop navigation', () => {
  test('navbar links are visible without opening collapse toggle', async ({ page }, testInfo) => {
    test.skip(!isDesktopProject(testInfo), 'Desktop navbar behavior is only valid at desktop breakpoints.');
    await page.goto('/index.html');

    const toggle = page.locator('.navbar-toggler');
    const collapsePanel = page.locator('#navbarCollapse');
    const workLink = page.locator('#navbarCollapse .nav-link[href$="#work"]');

    await expect(toggle).not.toBeVisible();
    await expect(collapsePanel).toBeVisible();
    await expect(workLink).toBeVisible();
    await expect(workLink).toHaveAttribute('href', '/index.html#work');
  });
});

test.describe('command palette', () => {
  test('keeps keyboard focus inside the dialog until closed', async ({ page }, testInfo) => {
    await page.goto('/index.html');

    if (isMobileProject(testInfo)) {
      await page.locator('.navbar-toggler').click();
    }

    const opener = page.locator('[data-cmdk-open]').first();
    const palette = page.locator('#commandPalette');
    const input = page.locator('#cmdkInput');
    const themeAction = page.locator('[data-cmdk-action="theme"]');

    await opener.click();

    await expect(palette).toBeVisible();
    await expect(input).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(themeAction).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('does not leave focus inside the hidden dialog after shortcut close', async ({ page }) => {
    await page.goto('/index.html');

    const palette = page.locator('#commandPalette');
    await page.keyboard.press('Control+K');

    await expect(palette).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(palette).toBeHidden();
    await expect.poll(async () => page.evaluate(() => {
      const commandPalette = document.getElementById('commandPalette');
      return commandPalette?.contains(document.activeElement) ?? false;
    })).toBe(false);
  });
});

test.describe('accordion behavior', () => {
  test('accordion panel expands and collapses via trigger button', async ({ page }) => {
    await page.goto('/index.html');

    const cdcButton = page.locator('button[aria-controls="collapseCDC"]');
    const cdcPanel = page.locator('#collapseCDC');

    await cdcButton.scrollIntoViewIfNeeded();

    await expect(cdcButton).toHaveAttribute('aria-expanded', 'false');
    await expect(cdcPanel).not.toHaveClass(/\bshow\b/);

    await cdcButton.click();
    await expect(cdcButton).toHaveAttribute('aria-expanded', 'true');
    await expect(cdcPanel).toHaveClass(/\bshow\b/);

    await cdcButton.click();
    await expect(cdcButton).toHaveAttribute('aria-expanded', 'false');
    await expect(cdcPanel).not.toHaveClass(/\bshow\b/);
  });

  test('opening second panel collapses the first panel', async ({ page }) => {
    await page.goto('/index.html');

    const cdcButton = page.locator('button[aria-controls="collapseCDC"]');
    const smuButton = page.locator('button[aria-controls="collapseSMU"]');
    const cdcPanel = page.locator('#collapseCDC');
    const smuPanel = page.locator('#collapseSMU');

    await smuButton.scrollIntoViewIfNeeded();

    await cdcButton.click();
    await expect(cdcPanel).toHaveClass(/\bshow\b/);

    await smuButton.click();

    await expect(smuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(smuPanel).toHaveClass(/\bshow\b/);
    await expect(cdcButton).toHaveAttribute('aria-expanded', 'false');
    await expect(cdcPanel).not.toHaveClass(/\bshow\b/);
  });

  test('opening first panel collapses the second panel', async ({ page }) => {
    await page.goto('/index.html');

    const cdcButton = page.locator('button[aria-controls="collapseCDC"]');
    const smuButton = page.locator('button[aria-controls="collapseSMU"]');
    const cdcPanel = page.locator('#collapseCDC');
    const smuPanel = page.locator('#collapseSMU');

    await cdcButton.scrollIntoViewIfNeeded();

    await smuButton.click();
    await expect(smuPanel).toHaveClass(/\bshow\b/);

    await cdcButton.click();

    await expect(cdcButton).toHaveAttribute('aria-expanded', 'true');
    await expect(cdcPanel).toHaveClass(/\bshow\b/);
    await expect(smuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(smuPanel).not.toHaveClass(/\bshow\b/);
  });
});

test.describe('reading controls', () => {
  test('filter buttons expose selected state to assistive technology', async ({ page }) => {
    await page.goto('/reading.html?year=2022&tag=Data');

    const activeYear = page.locator('.filter-pill[data-filter-group="year"][data-filter-value="2022"]');
    const inactiveYear = page.locator('.filter-pill[data-filter-group="year"][data-filter-value="All"]');
    const activeTag = page.locator('.filter-pill[data-filter-group="tag"][data-filter-value="Data"]');

    await expect(activeYear).toHaveAttribute('aria-pressed', 'true');
    await expect(inactiveYear).toHaveAttribute('aria-pressed', 'false');
    await expect(activeTag).toHaveAttribute('aria-pressed', 'true');

    await inactiveYear.click();

    await expect(inactiveYear).toHaveAttribute('aria-pressed', 'true');
    await expect(activeYear).toHaveAttribute('aria-pressed', 'false');
  });

  test('typing a search does not persist free-form text into the URL', async ({ page }) => {
    await page.goto('/reading.html');

    await page.locator('#readingSearch').fill('private search text');
    await page.waitForTimeout(250);

    expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  });
});
