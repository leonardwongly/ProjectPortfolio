const REVEAL_SELECTORS = [
  '.hero-panel',
  '.summary-card',
  '.section-title',
  '.main-timeline .timeline',
  '.card.animate__animated',
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

document.addEventListener('DOMContentLoaded', () => {
  initCountUps();
  initRevealOnScroll();
  initCloudflareBadge();
});

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

function initCloudflareBadge() {
  const badgeHost = document.getElementById('cloudflare-badge');
  if (!badgeHost) {
    return;
  }

  try {
    const badgeScript = document.createElement('script');
    badgeScript.dataset.cfbadgetype = 'f';
    badgeScript.dataset.cfbadgeskin = 'icon';
    badgeHost.appendChild(badgeScript);

    const queue = window.CloudFlare = window.CloudFlare || [];
    queue.push((cloudflare) => {
      cloudflare(['cloudflare/badge']);
    });

    if (!document.querySelector('script[data-cloudflare-badge="loader"]')) {
      const loader = document.createElement('script');
      loader.dataset.cloudflareBadge = 'loader';
      loader.src = 'https://ajax.cloudflare.com/cdn-cgi/nexp/cloudflare.js';
      loader.async = true;
      loader.defer = true;
      loader.crossOrigin = 'anonymous';
      loader.referrerPolicy = 'no-referrer';
      const firstScript = document.getElementsByTagName('script')[0];
      const parent = (firstScript && firstScript.parentNode) ? firstScript.parentNode : (document.head || document.body);
      parent.insertBefore(loader, firstScript || null);
    }
  } catch (error) {
    console.error('Cloudflare badge code could not be loaded.', error);
  }
}
