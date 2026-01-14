const REVEAL_SELECTORS = [
  '.hero-panel',
  '.summary-card',
  '.section-title',
  '.main-timeline .timeline',
  '.card.animate__animated',
  '.project-item',
  '.year-heading',
  '.page-hint',
  '.book-grid .card',
  '.badge.shadow',
  '.badge.shadow-sm'
];

const COUNT_UP_CONFIGS = [
  { id: 'countUpJob', from: 'Jan 4, 2022 00:00:00' },
  { id: 'countUpProject', from: 'Dec 1, 2020 00:00:00' }
];

const THEME_STORAGE_KEY = 'theme-preference';

document.addEventListener('DOMContentLoaded', () => {
  initNavActive();
  initThemeToggle();
  initCountUps();
  initRevealOnScroll();
});

function initNavActive() {
  const links = Array.from(document.querySelectorAll('.navbar .nav-link'));
  if (!links.length) {
    return;
  }

  const currentPath = window.location.pathname.replace(/\/$/, '');

  links.forEach((link) => {
    const targetPath = new URL(link.href, window.location.origin).pathname.replace(/\/$/, '');
    const isHome = targetPath.endsWith('/index.html');
    const isCurrent = isHome
      ? currentPath === '' || currentPath === '/' || currentPath.endsWith('/index.html')
      : currentPath.endsWith(targetPath);

    if (isCurrent) {
      link.setAttribute('aria-current', 'page');
      link.classList.add('active');
    }
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

function initCountUps() {
  COUNT_UP_CONFIGS.forEach(({ id, from }) => {
    const container = document.getElementById(id);
    if (!container) {
      return;
    }

    const start = new Date(from);
    if (Number.isNaN(start.getTime())) {
      return;
    }

    const update = () => {
      const now = new Date();
      const diff = now - start;

      const msYear = 31536000000;
      const msMonth = 2592000000;
      const msDay = 86400000;

      const years = Math.floor(diff / msYear);
      const months = Math.floor((diff % msYear) / msMonth);
      const days = Math.floor(((diff % msYear) % msMonth) / msDay);

      const yearsEl = container.querySelector('.years');
      const monthsEl = container.querySelector('.months');
      const daysEl = container.querySelector('.days');

      if (yearsEl) {
        yearsEl.textContent = String(years).padStart(2, '0');
      }
      if (monthsEl) {
        monthsEl.textContent = String(months).padStart(2, '0');
      }
      if (daysEl) {
        daysEl.textContent = String(days).padStart(2, '0');
      }
    };

    update();
    window.setInterval(update, 1000);
  });
}

function initRevealOnScroll() {
  const collected = [];
  const seen = new Set();

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
      element.style.removeProperty('--animation-delay');
    });
  };

  if (!('IntersectionObserver' in window) || reduceMotion.matches) {
    applyImmediate();
    return;
  }

  const baseDelay = 70;

  collected.forEach((element, index) => {
    const hasCustomOrder = element.hasAttribute('data-animate-order');
    const sourceOrder = hasCustomOrder ? element.dataset.animateOrder : element.dataset.animateAutoOrder;
    const parsedOrder = Number.parseInt(sourceOrder ?? index, 10);
    const normalizedOrder = Number.isFinite(parsedOrder) ? Math.max(parsedOrder, 0) : index;
    const delay = (hasCustomOrder ? normalizedOrder : Math.min(normalizedOrder, 8)) * baseDelay;
    element.style.setProperty('--animation-delay', `${delay}ms`);
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
