import { expect, test } from '@playwright/test';

function isMobileProject(testInfo) {
  return testInfo.project.name.startsWith('mobile-');
}

function isDesktopProject(testInfo) {
  return testInfo.project.name.startsWith('desktop-');
}

async function installServiceWorkerHarness(page, {
  hasController,
  hasWaitingWorker,
  readyState = null
}) {
  await page.addInitScript(({ initialController, initialWaitingWorker, initialReadyState }) => {
    const serviceWorkerListeners = new Map();
    const registrationListeners = new Map();
    const installingWorkerListeners = new Map();
    const calls = {
      controllerChanges: 0,
      installingStateChanges: 0,
      messages: [],
      postMessageAttempts: 0,
      registrationReadyStates: [],
      registrations: [],
      serviceWorkerListenerTypes: [],
      windowLoadListeners: 0
    };
    if (initialReadyState) {
      Object.defineProperty(document, 'readyState', {
        configurable: true,
        value: initialReadyState
      });
    }
    const nativeWindowAddEventListener = window.addEventListener.bind(window);
    window.addEventListener = (type, listener, options) => {
      if (type === 'load') {
        calls.windowLoadListeners += 1;
      }
      return nativeWindowAddEventListener(type, listener, options);
    };
    let activateDuringNextWaitingRead = false;
    let shouldFailNextPostMessage = false;
    const addListener = (listeners, type, listener) => {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    };
    const dispatch = (listeners, type) => {
      for (const listener of listeners.get(type) || []) {
        listener(new Event(type));
      }
    };
    const waitingWorker = {
      postMessage(message) {
        calls.postMessageAttempts += 1;
        if (shouldFailNextPostMessage) {
          shouldFailNextPostMessage = false;
          throw new Error('synthetic postMessage failure');
        }
        calls.messages.push(message);
      }
    };
    let waitingWorkerValue = initialWaitingWorker ? waitingWorker : null;
    const installingWorker = {
      state: 'installing',
      addEventListener(type, listener) {
        addListener(installingWorkerListeners, type, listener);
      }
    };
    const registration = {
      installing: null,
      get waiting() {
        const observedWorker = waitingWorkerValue;
        if (activateDuringNextWaitingRead) {
          activateDuringNextWaitingRead = false;
          waitingWorkerValue = null;
          dispatchControllerChange();
        }
        return observedWorker;
      },
      set waiting(worker) {
        waitingWorkerValue = worker;
      },
      addEventListener(type, listener) {
        addListener(registrationListeners, type, listener);
      }
    };
    const serviceWorker = {
      controller: initialController ? { state: 'activated' } : null,
      addEventListener(type, listener) {
        calls.serviceWorkerListenerTypes.push(type);
        addListener(serviceWorkerListeners, type, listener);
      },
      async register(scriptURL) {
        calls.registrationReadyStates.push(document.readyState);
        calls.registrations.push(scriptURL);
        return registration;
      }
    };

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker
    });

    const dispatchControllerChange = () => {
      calls.controllerChanges += 1;
      serviceWorker.controller = { state: 'activated' };
      dispatch(serviceWorkerListeners, 'controllerchange');
    };

    const installDiscoveredUpdate = () => {
      registration.installing = installingWorker;
      dispatch(registrationListeners, 'updatefound');

      installingWorker.state = 'installed';
      registration.waiting = waitingWorker;
      calls.installingStateChanges += 1;
      dispatch(installingWorkerListeners, 'statechange');
    };

    window.__serviceWorkerHarness = {
      calls,
      activateWaitingWorkerElsewhere() {
        registration.waiting = null;
        dispatchControllerChange();
      },
      activateWaitingWorkerDuringNextRead() {
        activateDuringNextWaitingRead = true;
      },
      dispatchControllerChange,
      failNextPostMessage() {
        shouldFailNextPostMessage = true;
      },
      installDiscoveredUpdate
    };
  }, {
    initialController: hasController,
    initialWaitingWorker: hasWaitingWorker,
    initialReadyState: readyState
  });
}

test.describe('mobile navigation', () => {
  test('navbar toggles and collapses after selecting a nav item', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'Mobile collapse behavior is only valid at mobile breakpoints.');
    await page.goto('/index.html');

    const toggle = page.locator('.navbar-toggler');
    const collapsePanel = page.locator('#navbarCollapse');
    const homeLink = page.locator('#navbarCollapse .nav-link[href$="#home"]');

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('data-interactive-ready', 'true');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(collapsePanel).not.toHaveClass(/\bshow\b/);

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(collapsePanel).toHaveClass(/\bshow\b/);

    await homeLink.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(collapsePanel).not.toHaveClass(/\bshow\b/);

    await toggle.evaluate((button) => {
      const cloneWithForgedMarker = button.cloneNode(true);
      button.replaceWith(cloneWithForgedMarker);
      window.initNavCollapse();
    });

    await expect(toggle).toHaveAttribute('data-interactive-ready', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(collapsePanel).toHaveClass(/\bshow\b/);
  });

  test('navbar closes on Escape for keyboard users', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'Mobile collapse behavior is only valid at mobile breakpoints.');
    await page.goto('/index.html');

    const toggle = page.locator('.navbar-toggler');
    const collapsePanel = page.locator('#navbarCollapse');
    const firstNavLink = page.locator('#navbarCollapse .nav-link').first();

    await expect(toggle).toHaveAttribute('data-interactive-ready', 'true');
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

    await expect(toggle).toHaveAttribute('data-interactive-ready', 'true');
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

test.describe('service worker updates', () => {
  test('registers once across loading, interactive, and complete initialization states', async ({ context }, testInfo) => {
    test.skip(!isDesktopProject(testInfo), 'Service worker lifecycle behavior is viewport-independent.');

    for (const readyState of ['loading', 'interactive', 'complete']) {
      const scenarioPage = await context.newPage();
      await installServiceWorkerHarness(scenarioPage, {
        hasController: true,
        hasWaitingWorker: false,
        readyState
      });

      try {
        await scenarioPage.goto('/index.html');
        await scenarioPage.evaluate(() => {
          window.initServiceWorker();
          window.initServiceWorker();
          window.dispatchEvent(new Event('load'));
        });

        const calls = await scenarioPage.evaluate(() => window.__serviceWorkerHarness.calls);
        expect(calls.registrations, readyState).toEqual(['/pwabuilder-sw.js']);
        expect(calls.registrationReadyStates, readyState).toEqual([readyState]);
        expect(calls.serviceWorkerListenerTypes, readyState).toEqual(['controllerchange']);
        expect(calls.windowLoadListeners, readyState).toBe(readyState === 'loading' ? 1 : 0);
      } finally {
        await scenarioPage.close();
      }
    }
  });

  test('fallback update token satisfies the worker schema at the zero-random boundary', async ({ page }, testInfo) => {
    test.skip(!isDesktopProject(testInfo), 'Service worker lifecycle behavior is viewport-independent.');
    await installServiceWorkerHarness(page, { hasController: true, hasWaitingWorker: false });
    await page.goto('/index.html');

    const token = await page.evaluate(() => {
      const cryptoDescriptor = Object.getOwnPropertyDescriptor(window, 'crypto');
      const originalDateNow = Date.now;
      const originalRandom = Math.random;

      try {
        Object.defineProperty(window, 'crypto', { configurable: true, value: {} });
        Date.now = () => 0;
        Math.random = () => 0;
        return window.createServiceWorkerToken();
      } finally {
        Date.now = originalDateNow;
        Math.random = originalRandom;
        if (cryptoDescriptor) {
          Object.defineProperty(window, 'crypto', cryptoDescriptor);
        } else {
          delete window.crypto;
        }
      }
    });

    expect(token).toMatch(/^[a-f0-9]{16,64}$/);
  });

  test('first installation taking control does not reload an unsuspecting page', async ({ page }, testInfo) => {
    test.skip(!isDesktopProject(testInfo), 'Service worker lifecycle behavior is viewport-independent.');
    await installServiceWorkerHarness(page, { hasController: false, hasWaitingWorker: false });
    let mainFrameNavigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        mainFrameNavigations += 1;
      }
    });

    await page.goto('/index.html');
    await expect.poll(() => page.evaluate(
      () => window.__serviceWorkerHarness.calls.registrations.length
    )).toBe(1);

    await page.evaluate(async () => {
      window.__serviceWorkerHarness.dispatchControllerChange();
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    await expect.poll(() => page.evaluate(
      () => window.__serviceWorkerHarness.calls.controllerChanges
    )).toBe(1);

    expect(mainFrameNavigations).toBe(1);
  });

  test('discovered update stays actionable after postMessage failure and reloads once after retry', async ({ page }, testInfo) => {
    test.skip(!isDesktopProject(testInfo), 'Service worker lifecycle behavior is viewport-independent.');
    await installServiceWorkerHarness(page, { hasController: true, hasWaitingWorker: false });
    let mainFrameNavigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        mainFrameNavigations += 1;
      }
    });

    await page.goto('/index.html');
    const updatePrompt = page.locator('.sw-update-prompt');
    const reloadButton = updatePrompt.getByRole('button', { name: 'Reload' });

    await expect.poll(() => page.evaluate(
      () => window.__serviceWorkerHarness.calls.registrations.length
    )).toBe(1);
    await expect(updatePrompt).toHaveCount(0);

    await page.evaluate(() => window.__serviceWorkerHarness.installDiscoveredUpdate());
    await expect.poll(() => page.evaluate(
      () => window.__serviceWorkerHarness.calls.installingStateChanges
    )).toBe(1);
    await expect(updatePrompt).toBeVisible();

    await page.evaluate(() => window.__serviceWorkerHarness.failNextPostMessage());
    await reloadButton.click();
    await expect(updatePrompt).toBeVisible();
    expect(mainFrameNavigations).toBe(1);
    expect(await page.evaluate(() => ({
      attempts: window.__serviceWorkerHarness.calls.postMessageAttempts,
      messages: window.__serviceWorkerHarness.calls.messages
    }))).toEqual({ attempts: 1, messages: [] });

    await reloadButton.click();

    const { attempts, message } = await page.evaluate(() => ({
      attempts: window.__serviceWorkerHarness.calls.postMessageAttempts,
      message: window.__serviceWorkerHarness.calls.messages[0]
    }));
    expect(attempts).toBe(2);
    expect(message).toEqual({
      type: 'SKIP_WAITING',
      token: expect.stringMatching(/^[a-f0-9]{32}$/)
    });

    const reloaded = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
    await page.evaluate(() => {
      window.setTimeout(() => {
        window.__serviceWorkerHarness.dispatchControllerChange();
        window.__serviceWorkerHarness.dispatchControllerChange();
      }, 0);
    });
    await reloaded;
    await page.waitForLoadState('load');

    expect(mainFrameNavigations).toBe(2);
  });

  test('prompt stays actionable when another tab activates before or during the activation request', async ({ page }, testInfo) => {
    test.skip(!isDesktopProject(testInfo), 'Service worker lifecycle behavior is viewport-independent.');
    await installServiceWorkerHarness(page, { hasController: true, hasWaitingWorker: true });
    let mainFrameNavigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        mainFrameNavigations += 1;
      }
    });

    await page.goto('/index.html');
    const reloadButton = page.locator('.sw-update-prompt').getByRole('button', { name: 'Reload' });
    await expect(reloadButton).toBeVisible();

    await page.evaluate(async () => {
      window.__serviceWorkerHarness.activateWaitingWorkerElsewhere();
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    await expect.poll(() => page.evaluate(
      () => window.__serviceWorkerHarness.calls.controllerChanges
    )).toBe(1);
    expect(mainFrameNavigations).toBe(1);

    const reloaded = page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame()
    });
    await reloadButton.click();
    await reloaded;
    await page.waitForLoadState('load');

    expect(mainFrameNavigations).toBe(2);

    await expect(reloadButton).toBeVisible();
    await page.evaluate(() => {
      window.__serviceWorkerHarness.activateWaitingWorkerDuringNextRead();
    });

    const racedReload = page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame()
    });
    await reloadButton.click();
    await racedReload;

    expect(mainFrameNavigations).toBe(3);
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

    await expect(cdcButton).toHaveAttribute('data-interactive-ready', 'true');
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

    await expect(cdcButton).toHaveAttribute('data-interactive-ready', 'true');
    await expect(smuButton).toHaveAttribute('data-interactive-ready', 'true');
    await cdcButton.click();
    await expect(cdcPanel).toHaveClass(/\bshow\b/);

    await smuButton.click();

    await expect(smuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(smuPanel).toHaveClass(/\bshow\b/);
    await expect(cdcButton).toHaveAttribute('aria-expanded', 'false');
    await expect(cdcPanel).not.toHaveClass(/\bshow\b/);
  });

  test('recovers from corrupt state and forged listener markers without duplicate ownership', async ({ page }) => {
    await page.goto('/index.html');

    const cdcButton = page.locator('button[aria-controls="collapseCDC"]');
    const cdcPanel = page.locator('#collapseCDC');

    await cdcButton.scrollIntoViewIfNeeded();

    await expect(cdcButton).toHaveAttribute('data-interactive-ready', 'true');
    await cdcButton.evaluate((button) => {
      button.setAttribute('aria-expanded', 'true');
      button.classList.remove('collapsed');
    });

    await cdcButton.click();
    await expect(cdcButton).toHaveAttribute('aria-expanded', 'true');
    await expect(cdcPanel).toHaveClass(/\bshow\b/);

    await cdcButton.click();
    await expect(cdcPanel).not.toHaveClass(/\bshow\b/);

    await cdcButton.evaluate((button) => {
      button.setAttribute('aria-expanded', 'true');
      button.classList.remove('collapsed');
      window.initAccordionState();
    });

    await expect(cdcButton).toHaveAttribute('aria-expanded', 'false');
    await expect(cdcButton).toHaveClass(/\bcollapsed\b/);
    await expect(cdcPanel).not.toHaveClass(/\bshow\b/);

    await cdcButton.click();
    await expect(cdcButton).toHaveAttribute('aria-expanded', 'true');
    await expect(cdcPanel).toHaveClass(/\bshow\b/);

    await cdcButton.click();
    await expect(cdcPanel).not.toHaveClass(/\bshow\b/);

    await cdcButton.evaluate((button) => {
      const cloneWithForgedMarker = button.cloneNode(true);
      button.replaceWith(cloneWithForgedMarker);
      window.initAccordionState();
    });

    await expect(cdcButton).toHaveAttribute('data-interactive-ready', 'true');
    await cdcButton.click();
    await expect(cdcButton).toHaveAttribute('aria-expanded', 'true');
    await expect(cdcPanel).toHaveClass(/\bshow\b/);
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
