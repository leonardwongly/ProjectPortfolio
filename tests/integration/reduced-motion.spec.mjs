// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Reduced motion accessibility', () => {
  test('should respect prefers-reduced-motion for animations', async ({ page }) => {
    // Emulate prefers-reduced-motion: reduce
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto('/index.html');

    // Wait for page load
    await page.waitForLoadState('networkidle');

    // Reduced motion should bypass staggered reveal animation setup.
    const cards = await page.locator('.reveal-on-scroll').all();

    for (const card of cards) {
      await expect(card).toHaveClass(/\bis-visible\b/);
      const className = await card.getAttribute('class');
      expect(className ?? '').not.toMatch(/\breveal-delay-\d+\b/);
    }
  });

  test('should apply animations when reduced motion is not preferred', async ({ page }) => {
    // Emulate prefers-reduced-motion: no-preference (default)
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await page.goto('/index.html');

    await page.waitForLoadState('networkidle');

    const revealCards = page.locator('.reveal-on-scroll');
    await expect(revealCards).not.toHaveCount(0);

    // Non-reduced motion should preserve stagger classes assigned by initRevealOnScroll().
    const staggeredCount = await revealCards.evaluateAll((elements) => {
      return elements.filter((element) => /\breveal-delay-[1-8]\b/.test(element.className)).length;
    });

    expect(staggeredCount).toBeGreaterThan(0);
  });

  test('should not show rapid motion effects with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto('/index.html');

    const hiddenAnimatedCards = page.locator('.reveal-on-scroll:not(.is-visible)');
    await expect(hiddenAnimatedCards).toHaveCount(0);
  });

  test('should maintain functionality with reduced motion enabled', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto('/index.html');

    // Test that interactive elements still work
    const navLinks = page.locator('nav a');
    expect(await navLinks.count()).toBeGreaterThan(0);

    // Test mobile menu without colliding with accordion collapse triggers.
    const navToggle = page.locator('.navbar-toggler');
    if (await navToggle.isVisible()) {
      await navToggle.click();
      // Menu should still function even with reduced motion
      const navMenu = page.locator('#navbarCollapse');
      await expect(navMenu).toBeVisible();
    }

    // Test that scroll behavior is not disrupted
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const scrollPosition = await page.evaluate(() => window.scrollY);
    expect(scrollPosition).toBeGreaterThan(0);
  });
});
