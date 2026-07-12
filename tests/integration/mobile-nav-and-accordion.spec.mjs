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
    const homeLink = page.locator('#navbarCollapse .nav-link[href$="#home"]');

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(collapsePanel).not.toHaveClass(/\bshow\b/);

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(collapsePanel).toHaveClass(/\bshow\b/);

    await homeLink.click();

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
    const workLink = page.locator('#navbarCollapse .nav-link[href="/work.html"]');

    await expect(toggle).not.toBeVisible();
    await expect(collapsePanel).toBeVisible();
    await expect(workLink).toBeVisible();
    await expect(workLink).toHaveAttribute('href', '/work.html');
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

  test('exposes arrow-key command selection to assistive technology', async ({ page }, testInfo) => {
    await page.goto('/index.html');

    if (isMobileProject(testInfo)) {
      await page.locator('.navbar-toggler').click();
    }

    await page.locator('[data-cmdk-open]').first().click();

    const input = page.locator('#cmdkInput');
    const workOption = page.getByRole('option', { name: /flagship work three selected systems/i });

    await expect(input).toHaveAttribute('aria-activedescendant', /cmdk-option-1/);

    await input.press('ArrowDown');

    await expect(workOption).toHaveAttribute('aria-selected', 'true');
    await expect(input).toHaveAttribute('aria-activedescendant', await workOption.getAttribute('id'));

    await input.press('Enter');

    await expect(page).toHaveURL(/\/index\.html#work$/);
  });

  test('announces empty command palette results', async ({ page }, testInfo) => {
    await page.goto('/index.html');

    if (isMobileProject(testInfo)) {
      await page.locator('.navbar-toggler').click();
    }

    await page.locator('[data-cmdk-open]').first().click();

    const input = page.locator('#cmdkInput');
    const empty = page.getByRole('status').filter({ hasText: 'no matches' });

    await input.fill('zzzzzz-no-command');

    await expect(empty).toBeVisible();
    await expect(input).toHaveAttribute('aria-describedby', 'cmdkEmpty');
    await expect(input).not.toHaveAttribute('aria-activedescendant', /.*/);
  });
});

test.describe('portfolio evidence hierarchy', () => {
  test('home presents three flagship projects and linked proof points', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page.locator('#work .featured-card')).toHaveCount(3);
    await expect(page.locator('.hero-highlights a.highlight-card')).toHaveCount(3);
    await expect(page.getByRole('link', { name: 'View all 7 projects' })).toHaveAttribute('href', '/work.html');
  });

  test('project archive presents the complete inventory with explicit status', async ({ page }) => {
    await page.goto('/work.html');

    await expect(page.locator('#projects .featured-card')).toHaveCount(7);
    await expect(page.locator('#projects .project-status')).toHaveCount(7);
    await expect(page.getByRole('heading', { name: 'Systems, tools, and public-interest products' })).toBeVisible();
  });

  test('flagship case studies expose architecture, evidence, and tradeoffs', async ({ page }) => {
    await page.goto('/case-study-agentforge.html');

    await expect(page.getByRole('heading', { name: 'AgentForge Merge Guard', level: 1 })).toBeVisible();
    await expect(page.locator('.architecture-flow li')).toHaveCount(5);
    await expect(page.locator('.decision-card')).toHaveCount(4);
    await expect(page.locator('#evidence')).toBeVisible();
    await expect(page.locator('#tradeoffs')).toBeVisible();
    await expect(page.locator('.navbar .nav-link[href="/work.html"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'Next case study' })).toHaveAttribute('href', '/case-study-agentic.html');
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

    const yearGroup = page.getByRole('group', { name: 'Year' });
    const tagGroup = page.getByRole('group', { name: 'Tags' });
    const activeYear = yearGroup.locator('.filter-pill[data-filter-value="2022"]');
    const inactiveYear = yearGroup.locator('.filter-pill[data-filter-value="All"]');
    const activeTag = tagGroup.locator('.filter-pill[data-filter-value="Data"]');

    await expect(yearGroup).toBeVisible();
    await expect(tagGroup).toBeVisible();

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
