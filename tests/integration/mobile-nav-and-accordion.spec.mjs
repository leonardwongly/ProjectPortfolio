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
});
