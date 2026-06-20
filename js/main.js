const REVEAL_SELECTORS = [
  '.hero-section',
  '.section-header',
  '.featured-card',
  '.skill-card',
  '.experience-card',
  '.credentials-grid .card',
  '.article-card',
  '.honor-card',
  '.accordion-item',
  '.trust-item',
  '.book-card',
  '.contact-card'
];

const THEME_STORAGE_KEY = 'theme-preference';
const TELEMETRY_STORAGE_KEY = 'portfolio-telemetry-session';
const TELEMETRY_ALLOWED_EVENTS = new Set([
  'portfolio_action_clicked',
  'reading_filter_changed',
  'reading_view_changed',
  'reading_share_clicked',
  'reading_share_completed'
]);
const REVEAL_DELAY_CLASS_PREFIX = 'reveal-delay-';
const MAX_REVEAL_DELAY_CLASS = 8;
const SW_UPDATE_EVENT_TYPE = 'SKIP_WAITING';

document.addEventListener('DOMContentLoaded', () => {
  initNavActive();
  initNavCollapse();
  initAccordionState();
  initThemeToggle();
  initCommandPalette();
  initRevealOnScroll();
  initPrivacySafeTelemetry();
  initReadingFilters();
  initServiceWorker();
  window.addEventListener('hashchange', initNavActive);
});

function initCommandPalette() {
  const palette = document.getElementById('commandPalette');
  const input = document.getElementById('cmdkInput');
  const list = document.getElementById('cmdkList');
  if (!palette || !input || !list) {
    return;
  }

  const empty = document.getElementById('cmdkEmpty');
  const items = Array.from(list.querySelectorAll('.cmdk__item'));
  const openers = Array.from(document.querySelectorAll('[data-cmdk-open]'));
  let lastFocused = null;

  const visibleItems = () => items.filter((item) => !item.closest('li').hidden);
  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  const focusableItems = () => Array.from(palette.querySelectorAll(focusableSelector))
    .filter((element) => !element.closest('[hidden]'));
  const isVisible = (element) => element
    && (element.offsetParent !== null || element.getClientRects().length > 0);
  const canRestoreFocus = (element) => element
    && element !== document.body
    && element.isConnected
    && !palette.contains(element)
    && isVisible(element)
    && typeof element.focus === 'function';

  const focusFallback = () => {
    const visibleOpener = openers.find((opener) => isVisible(opener));
    if (visibleOpener) {
      visibleOpener.focus();
      return;
    }

    const content = document.getElementById('content');
    if (!content || typeof content.focus !== 'function') {
      return;
    }

    const hadTabIndex = content.hasAttribute('tabindex');
    const previousTabIndex = content.getAttribute('tabindex');
    content.setAttribute('tabindex', '-1');
    content.focus({ preventScroll: true });
    if (hadTabIndex) {
      content.setAttribute('tabindex', previousTabIndex);
    } else {
      content.removeAttribute('tabindex');
    }
  };

  const setActive = (nextItem) => {
    items.forEach((item) => item.classList.remove('is-active'));
    if (nextItem) {
      nextItem.classList.add('is-active');
      nextItem.scrollIntoView({ block: 'nearest' });
    }
  };

  const filter = () => {
    const query = input.value.trim().toLowerCase();
    let matches = 0;
    items.forEach((item) => {
      const hit = item.textContent.toLowerCase().includes(query);
      item.closest('li').hidden = !hit;
      if (hit) {
        matches += 1;
      }
    });
    if (empty) {
      empty.hidden = matches > 0;
    }
    setActive(visibleItems()[0] || null);
  };

  const open = () => {
    if (!palette.hidden) {
      return;
    }
    lastFocused = document.activeElement;
    palette.hidden = false;
    input.value = '';
    filter();
    input.focus();
  };

  const close = () => {
    if (palette.hidden) {
      return;
    }
    palette.hidden = true;
    if (canRestoreFocus(lastFocused)) {
      lastFocused.focus();
    } else {
      focusFallback();
    }
  };

  openers.forEach((opener) => opener.addEventListener('click', open));

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (palette.hidden) {
        open();
      } else {
        close();
      }
    } else if (event.key === 'Escape' && !palette.hidden) {
      close();
    }
  });

  palette.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || palette.hidden) {
      return;
    }

    const focusable = focusableItems();
    if (!focusable.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  input.addEventListener('input', filter);

  input.addEventListener('keydown', (event) => {
    const current = visibleItems();
    if (!current.length) {
      return;
    }
    const activeIndex = current.findIndex((item) => item.classList.contains('is-active'));
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(current[Math.min(activeIndex + 1, current.length - 1)]);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(current[Math.max(activeIndex - 1, 0)]);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      (current[activeIndex] || current[0]).click();
    }
  });

  list.addEventListener('click', (event) => {
    const item = event.target.closest('.cmdk__item');
    if (!item) {
      return;
    }
    if (item.dataset.cmdkAction === 'theme') {
      event.preventDefault();
      const toggle = document.querySelector('[data-theme-toggle]');
      if (toggle) {
        toggle.click();
      }
    }
    close();
  });

  palette.addEventListener('click', (event) => {
    if (event.target === palette) {
      close();
    }
  });
}

function initNavActive() {
  const links = Array.from(document.querySelectorAll('.navbar .nav-link'));
  if (!links.length) {
    return;
  }

  const currentPath = window.location.pathname.replace(/\/$/, '');
  const currentHash = window.location.hash;

  links.forEach((link) => {
    link.classList.remove('active');
    link.removeAttribute('aria-current');
  });

  links.forEach((link) => {
    const url = new URL(link.href, window.location.origin);
    const targetPath = url.pathname.replace(/\/$/, '');
    const targetHash = url.hash;
    const isHome = targetPath.endsWith('/index.html');
    const pathMatches = isHome
      ? currentPath === '' || currentPath === '/' || currentPath.endsWith('/index.html')
      : currentPath.endsWith(targetPath);

    let isCurrent = false;
    if (pathMatches) {
      if (targetHash) {
        isCurrent = currentHash === targetHash || (!currentHash && targetHash === '#home');
      } else {
        isCurrent = true;
      }
    }

    if (isCurrent) {
      link.setAttribute('aria-current', 'page');
      link.classList.add('active');
    }
  });
}

function initNavCollapse() {
  const toggle = document.querySelector('.navbar-toggler');
  if (!toggle) {
    return;
  }

  const targetSelector = toggle.getAttribute('data-bs-target');
  if (!targetSelector || !targetSelector.startsWith('#')) {
    return;
  }

  const panel = document.querySelector(targetSelector);
  if (!panel) {
    return;
  }

  const setExpanded = (expanded) => {
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    panel.classList.toggle('show', expanded);
  };

  setExpanded(panel.classList.contains('show'));

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    setExpanded(!expanded);
  });

  const closeOnEscape = (event) => {
    if (event.key !== 'Escape' || toggle.getAttribute('aria-expanded') !== 'true') {
      return;
    }
    event.preventDefault();
    setExpanded(false);
    toggle.focus();
  };

  toggle.addEventListener('keydown', closeOnEscape);

  panel.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      setExpanded(false);
    });
  });

  panel.addEventListener('keydown', closeOnEscape);
}

function initAccordionState() {
  const buttons = Array.from(document.querySelectorAll('.accordion-button[data-bs-target^="#"]'));
  if (!buttons.length) {
    return;
  }

  const setButtonState = (button, expanded) => {
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.classList.toggle('collapsed', !expanded);
  };

  const closeSiblings = (panel, scope) => {
    scope.querySelectorAll('.accordion-collapse.show').forEach((candidate) => {
      if (candidate === panel) {
        return;
      }
      candidate.classList.remove('show');
      if (candidate.id) {
        const candidateButton = document.querySelector(`.accordion-button[data-bs-target="#${candidate.id}"]`);
        if (candidateButton) {
          setButtonState(candidateButton, false);
        }
      }
    });
  };

  buttons.forEach((button) => {
    const targetSelector = button.getAttribute('data-bs-target');
    if (!targetSelector) {
      return;
    }
    const panel = document.querySelector(targetSelector);
    if (!panel) {
      return;
    }

    setButtonState(button, panel.classList.contains('show'));

    button.addEventListener('click', (event) => {
      event.preventDefault();
      const expanded = button.getAttribute('aria-expanded') === 'true';
      const nextExpanded = !expanded;

      if (nextExpanded) {
        const parentSelector = panel.getAttribute('data-bs-parent');
        const scope = parentSelector ? document.querySelector(parentSelector) : panel.closest('.accordion');
        if (scope) {
          closeSiblings(panel, scope);
        }
      }

      panel.classList.toggle('show', nextExpanded);
      setButtonState(button, nextExpanded);
    });
  });
}

function initThemeToggle() {
  const toggles = Array.from(document.querySelectorAll('[data-theme-toggle]'));
  if (!toggles.length) {
    return;
  }

  const stored = readStoredTheme();
  if (stored) {
    applyTheme(stored);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  updateThemeToggleLabels(getEffectiveTheme(), toggles);

  toggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      updateThemeToggleLabels(next, toggles);
    });
  });

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemChange = () => {
    if (!readStoredTheme()) {
      updateThemeToggleLabels(getEffectiveTheme(), toggles);
    }
  };

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleSystemChange);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(handleSystemChange);
  }
}

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch (error) {
    return null;
  }
}

function getEffectiveTheme() {
  const stored = readStoredTheme();
  if (stored) {
    return stored;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    // Ignore storage errors (private mode, etc.).
  }
}

function updateThemeToggleLabels(theme, toggles) {
  toggles.forEach((toggle) => {
    const label = toggle.querySelector('[data-theme-label]');
    if (label) {
      label.textContent = theme === 'dark' ? 'Dark' : 'Light';
    }
    toggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    toggle.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
    );
  });
}

function initRevealOnScroll() {
  const collected = [];
  const seen = new Set();

  const clearRevealDelayClass = (element) => {
    for (let step = 0; step <= MAX_REVEAL_DELAY_CLASS; step += 1) {
      element.classList.remove(`${REVEAL_DELAY_CLASS_PREFIX}${step}`);
    }
  };

  const applyRevealDelayClass = (element, step) => {
    const boundedStep = Math.min(Math.max(step, 0), MAX_REVEAL_DELAY_CLASS);
    clearRevealDelayClass(element);
    element.classList.add(`${REVEAL_DELAY_CLASS_PREFIX}${boundedStep}`);
  };

  REVEAL_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element, position) => {
      if (!seen.has(element)) {
        seen.add(element);
        element.classList.add('reveal-on-scroll');
        if (!element.dataset.animateAutoOrder) {
          element.dataset.animateAutoOrder = String(position);
        }
        collected.push(element);
      }
    });
  });

  if (!collected.length) {
    return;
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyImmediate = () => {
    collected.forEach((element) => {
      element.classList.add('is-visible');
      clearRevealDelayClass(element);
    });
  };

  if (!('IntersectionObserver' in window) || reduceMotion.matches) {
    applyImmediate();
    return;
  }

  collected.forEach((element, index) => {
    const hasCustomOrder = element.hasAttribute('data-animate-order');
    const sourceOrder = hasCustomOrder ? element.dataset.animateOrder : element.dataset.animateAutoOrder;
    const parsedOrder = Number.parseInt(sourceOrder ?? index, 10);
    const normalizedOrder = Number.isFinite(parsedOrder) ? Math.max(parsedOrder, 0) : index;
    const delayStep = hasCustomOrder ? normalizedOrder : Math.min(normalizedOrder, MAX_REVEAL_DELAY_CLASS);
    applyRevealDelayClass(element, delayStep);
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -5% 0px' });

  collected.forEach((element) => observer.observe(element));

  if (typeof reduceMotion.addEventListener === 'function') {
    reduceMotion.addEventListener('change', (event) => {
      if (event.matches) {
        applyImmediate();
      }
    });
  } else if (typeof reduceMotion.addListener === 'function') {
    reduceMotion.addListener((event) => {
      if (event.matches) {
        applyImmediate();
      }
    });
  }
}

function createServiceWorkerToken() {
  if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 18)}`;
}

function initServiceWorker() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    return;
  }

  let refreshing = false;
  let updatePrompt = null;

  const createUpdatePrompt = (activateUpdate) => {
    if (updatePrompt) {
      return updatePrompt;
    }

    const prompt = document.createElement('section');
    prompt.className = 'sw-update-prompt';
    prompt.hidden = true;
    prompt.setAttribute('role', 'region');
    prompt.setAttribute('aria-labelledby', 'sw-update-prompt-message');

    const message = document.createElement('p');
    message.id = 'sw-update-prompt-message';
    message.className = 'sw-update-prompt__message';
    message.setAttribute('aria-live', 'polite');
    message.textContent = 'A site update is ready.';

    const actions = document.createElement('div');
    actions.className = 'sw-update-prompt__actions';

    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'btn btn-primary btn-sm';
    reload.textContent = 'Reload';
    reload.addEventListener('click', activateUpdate);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'btn btn-ghost btn-sm';
    dismiss.textContent = 'Later';
    dismiss.addEventListener('click', () => {
      prompt.hidden = true;
    });

    actions.append(reload, dismiss);
    prompt.append(message, actions);
    document.body.append(prompt);
    updatePrompt = prompt;
    return prompt;
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) {
      return;
    }
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/pwabuilder-sw.js');

      const requestActivation = () => {
        if (!registration.waiting) {
          return;
        }
        registration.waiting.postMessage({
          type: SW_UPDATE_EVENT_TYPE,
          token: createServiceWorkerToken()
        });
      };

      const showUpdatePrompt = () => {
        const prompt = createUpdatePrompt(requestActivation);
        prompt.hidden = false;
      };

      if (registration.waiting) {
        showUpdatePrompt();
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) {
          return;
        }

        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdatePrompt();
          }
        });
      });
    } catch (error) {
      // Ignore service worker registration errors.
    }
  });
}

function sanitizeTelemetryValue(value) {
  if (typeof value === 'boolean' || Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return value.trim().replace(/\s+/g, '_').toLowerCase().slice(0, 80);
  }

  return undefined;
}

function readTelemetrySession() {
  try {
    const raw = sessionStorage.getItem(TELEMETRY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeTelemetrySession(snapshot) {
  try {
    sessionStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    // Ignore storage errors (private mode, storage disabled, etc.).
  }
}

function trackEvent(eventName, properties = {}) {
  if (
    typeof eventName !== 'string' ||
    !TELEMETRY_ALLOWED_EVENTS.has(eventName) ||
    !/^[a-z0-9_]+$/.test(eventName)
  ) {
    return;
  }

  const safeProperties = {};
  Object.entries(properties).forEach(([key, value]) => {
    if (typeof key !== 'string' || !/^[a-z0-9_]+$/.test(key)) {
      return;
    }

    const sanitized = sanitizeTelemetryValue(value);
    if (sanitized !== undefined) {
      safeProperties[key] = sanitized;
    }
  });

  const sessionSnapshot = readTelemetrySession();
  sessionSnapshot[eventName] = (Number.parseInt(sessionSnapshot[eventName] || 0, 10) || 0) + 1;
  writeTelemetrySession(sessionSnapshot);

  try {
    window.dispatchEvent(new CustomEvent('portfolio:track', {
      detail: { event: eventName, properties: safeProperties }
    }));
  } catch (error) {
    // Ignore analytics adapter errors.
  }
}

function initPrivacySafeTelemetry() {
  document.querySelectorAll('[data-telemetry-event]').forEach((element) => {
    element.addEventListener('click', () => {
      const eventName = element.getAttribute('data-telemetry-event') || '';
      trackEvent(eventName, {
        surface: element.getAttribute('data-telemetry-surface') || 'unknown',
        action: element.getAttribute('data-telemetry-action') || 'unknown',
        destination: element.getAttribute('data-telemetry-destination') || 'unknown'
      });
    });
  });
}

function sanitizeReadingQuery(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ').slice(0, 120);
}

function debounce(fn, delayMs) {
  let timeoutId;
  return (...args) => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      timeoutId = undefined;
      fn(...args);
    }, delayMs);
  };
}

function initReadingFilters() {
  const section = document.querySelector('[data-reading]');
  if (!section) {
    return;
  }

  const searchInput = section.querySelector('#readingSearch');
  const items = Array.from(section.querySelectorAll('[data-reading-item]'));
  const emptyState = section.querySelector('[data-reading-empty]');
  const resultCount = section.querySelector('[data-reading-count]');
  const grid = section.querySelector('[data-reading-grid]');
  const filterButtons = Array.from(section.querySelectorAll('.filter-pill'));
  const viewButtons = Array.from(section.querySelectorAll('.view-pill'));
  const shareButton = section.querySelector('[data-reading-share]');
  const shareStatus = section.querySelector('[data-reading-share-status]');
  const urlParams = new URLSearchParams(window.location.search);
  const indexedItems = items.map((item) => ({
    element: item,
    year: item.dataset.year || '',
    tags: (item.dataset.tags || '').split(',').filter(Boolean),
    searchableText: `${item.dataset.title || ''} ${item.dataset.author || ''} ${item.dataset.isbn || ''} ${item.dataset.tags || ''}`.toLowerCase()
  }));
  const yearValues = new Set(
    filterButtons
      .filter((button) => button.dataset.filterGroup === 'year')
      .map((button) => button.dataset.filterValue || 'All')
  );
  const tagValues = new Set(
    filterButtons
      .filter((button) => button.dataset.filterGroup === 'tag')
      .map((button) => button.dataset.filterValue || 'All')
  );
  const viewValues = new Set(
    viewButtons
      .map((button) => button.dataset.view)
      .filter((value) => value === 'grid' || value === 'list')
  );

  let activeYear = yearValues.has(urlParams.get('year')) ? (urlParams.get('year') || 'All') : 'All';
  let activeTag = tagValues.has(urlParams.get('tag')) ? (urlParams.get('tag') || 'All') : 'All';
  let query = sanitizeReadingQuery(urlParams.get('q') || '');
  let activeView = viewValues.has(urlParams.get('view')) ? (urlParams.get('view') || 'grid') : 'grid';
  let statusTimeout;

  const setShareStatus = (message, state) => {
    if (!shareStatus) {
      return;
    }

    shareStatus.textContent = message;
    if (state === 'success' || state === 'error') {
      shareStatus.dataset.state = state;
    } else {
      shareStatus.removeAttribute('data-state');
    }

    if (statusTimeout) {
      window.clearTimeout(statusTimeout);
      statusTimeout = undefined;
    }

    if (message) {
      statusTimeout = window.setTimeout(() => {
        shareStatus.textContent = '';
        shareStatus.removeAttribute('data-state');
      }, 5000);
    }
  };

  const setActiveFilterButton = (group, value) => {
    filterButtons.forEach((button) => {
      if (button.dataset.filterGroup !== group) {
        return;
      }
      const buttonValue = button.dataset.filterValue || 'All';
      const isActive = buttonValue === value;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  const setActiveView = (view) => {
    activeView = viewValues.has(view) ? view : 'grid';
    if (grid) {
      grid.dataset.view = activeView;
    }
    viewButtons.forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.view === activeView ? 'true' : 'false');
    });
  };

  const buildFilterParams = ({ includeQuery = false } = {}) => {
    const params = new URLSearchParams();
    if (activeYear !== 'All') {
      params.set('year', activeYear);
    }
    if (activeTag !== 'All') {
      params.set('tag', activeTag);
    }
    const normalizedQuery = sanitizeReadingQuery(query);
    if (includeQuery && normalizedQuery) {
      params.set('q', normalizedQuery);
    }
    if (activeView !== 'grid') {
      params.set('view', activeView);
    }
    return params;
  };

  const updateAddressBar = () => {
    const params = buildFilterParams();
    const queryString = params.toString();
    const next = `${window.location.pathname}${queryString ? `?${queryString}` : ''}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (next !== current) {
      try {
        window.history.replaceState(null, '', next);
      } catch (error) {
        // Ignore history update errors.
      }
    }
  };
  const updateAddressBarDebounced = debounce(updateAddressBar, 120);

  const buildShareMetrics = () => ({
    view: activeView,
    has_query: query.length > 0,
    year_filter: activeYear === 'All' ? 'all' : 'active',
    tag_filter: activeTag === 'All' ? 'all' : 'active'
  });

  const updateFilters = () => {
    let visibleCount = 0;
    const normalizedQuery = query.toLowerCase();

    indexedItems.forEach((entry) => {
      const { element, year, tags, searchableText } = entry;

      const matchesYear = activeYear === 'All' || year === activeYear;
      const matchesTag = activeTag === 'All' || tags.includes(activeTag.toLowerCase());
      const matchesQuery = !normalizedQuery || searchableText.includes(normalizedQuery);

      const shouldShow = matchesYear && matchesTag && matchesQuery;
      element.hidden = !shouldShow;
      if (shouldShow) {
        visibleCount += 1;
      }
    });

    if (emptyState) {
      emptyState.hidden = visibleCount !== 0;
    }
    if (resultCount) {
      const total = indexedItems.length;
      resultCount.textContent = visibleCount === total
        ? `${total} books shown`
        : `${visibleCount} of ${total} books shown`;
    }
  };

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const group = button.dataset.filterGroup;
      const value = button.dataset.filterValue || 'All';
      if (group === 'year') {
        activeYear = value;
      } else if (group === 'tag') {
        activeTag = value;
      }

      setActiveFilterButton(group, value);

      updateFilters();
      updateAddressBar();
      trackEvent('reading_filter_changed', {
        group,
        value: value === 'All' ? 'all' : 'active'
      });
    });
  });

  if (searchInput) {
    searchInput.value = query;
    searchInput.addEventListener('input', (event) => {
      query = sanitizeReadingQuery(event.target.value || '');
      if (event.target.value !== query) {
        event.target.value = query;
      }
      updateFilters();
      updateAddressBarDebounced();
    });
  }

  viewButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      setActiveView(view);
      updateAddressBar();
      trackEvent('reading_view_changed', { view: activeView });
    });
  });

  if (shareButton) {
    shareButton.addEventListener('click', async () => {
      const params = buildFilterParams({ includeQuery: true });
      const queryString = params.toString();
      const shareUrl = `${window.location.origin}${window.location.pathname}${queryString ? `?${queryString}` : ''}`;
      const metrics = buildShareMetrics();

      trackEvent('reading_share_clicked', metrics);

      if (window.isSecureContext && typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: 'Leonard Wong Reading',
            text: 'Books that shaped my thinking.',
            url: shareUrl
          });
          setShareStatus('Shared successfully.', 'success');
          trackEvent('reading_share_completed', { ...metrics, method: 'native' });
          return;
        } catch (error) {
          if (error && error.name === 'AbortError') {
            setShareStatus('Share canceled.', 'error');
            return;
          }
        }
      }

      if (window.isSecureContext && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(shareUrl);
          setShareStatus('Link copied. You can paste it anywhere.', 'success');
          trackEvent('reading_share_completed', { ...metrics, method: 'clipboard' });
          return;
        } catch (error) {
          // Fall back to manual copy guidance.
        }
      }

      setShareStatus('Copy is unavailable here. Share from the address bar.', 'error');
      trackEvent('reading_share_completed', { ...metrics, method: 'manual' });
    });
  }

  setActiveFilterButton('year', activeYear);
  setActiveFilterButton('tag', activeTag);
  setActiveView(activeView);
  updateFilters();
  updateAddressBar();
}
