const REVEAL_SELECTORS = [
  '.hero-section',
  '.section-header',
  '.featured-card',
  '.skill-card',
  '.experience-card',
  '.credentials-grid .card',
  '.accordion-item',
  '.book-card',
  '.contact-card'
];

const THEME_STORAGE_KEY = 'theme-preference';

document.addEventListener('DOMContentLoaded', () => {
  initNavActive();
  initThemeToggle();
  initRevealOnScroll();
  initReadingFilters();
  window.addEventListener('hashchange', initNavActive);
});

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

function initReadingFilters() {
  const section = document.querySelector('[data-reading]');
  if (!section) {
    return;
  }

  const searchInput = section.querySelector('#readingSearch');
  const items = Array.from(section.querySelectorAll('[data-reading-item]'));
  const emptyState = section.querySelector('[data-reading-empty]');
  const grid = section.querySelector('[data-reading-grid]');
  const filterButtons = Array.from(section.querySelectorAll('.filter-pill'));
  const viewButtons = Array.from(section.querySelectorAll('.view-pill'));

  let activeYear = 'All';
  let activeTag = 'All';
  let query = '';

  const updateFilters = () => {
    let visibleCount = 0;
    const normalizedQuery = query.trim().toLowerCase();

    items.forEach((item) => {
      const year = item.dataset.year;
      const tags = (item.dataset.tags || '').split(',').filter(Boolean);
      const text = `${item.dataset.title || ''} ${item.dataset.author || ''} ${item.dataset.isbn || ''}`.toLowerCase();

      const matchesYear = activeYear === 'All' || year === activeYear;
      const matchesTag = activeTag === 'All' || tags.includes(activeTag.toLowerCase());
      const matchesQuery = !normalizedQuery || text.includes(normalizedQuery);

      const shouldShow = matchesYear && matchesTag && matchesQuery;
      item.hidden = !shouldShow;
      if (shouldShow) {
        visibleCount += 1;
      }
    });

    if (emptyState) {
      emptyState.hidden = visibleCount !== 0;
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

      filterButtons.forEach((btn) => {
        if (btn.dataset.filterGroup === group) {
          btn.classList.toggle('is-active', btn === button);
        }
      });

      updateFilters();
    });
  });

  if (filterButtons.length) {
    const firstYear = filterButtons.find((btn) => btn.dataset.filterGroup === 'year');
    if (firstYear) {
      firstYear.classList.add('is-active');
    }
    const firstTag = filterButtons.find((btn) => btn.dataset.filterGroup === 'tag');
    if (firstTag) {
      firstTag.classList.add('is-active');
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      query = event.target.value;
      updateFilters();
    });
  }

  viewButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      if (grid) {
        grid.dataset.view = view;
      }
      viewButtons.forEach((btn) => {
        btn.setAttribute('aria-pressed', btn === button ? 'true' : 'false');
      });
    });
  });

  updateFilters();
}
