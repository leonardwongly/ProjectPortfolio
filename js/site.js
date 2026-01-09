document.addEventListener('DOMContentLoaded', () => {
  const interactiveSelectors = [
    '.hero-panel',
    '.summary-card',
    '.main-timeline .timeline-content',
    '.card',
    '.accordion-item',
    '.book-grid .card'
  ];

  const interactiveElements = new Set();

  interactiveSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      interactiveElements.add(element);
    });
  });

  if (!interactiveElements.size) {
    return;
  }

  interactiveElements.forEach((element) => {
    element.classList.add('interactive-card');
  });

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceMotion.matches) {
    return;
  }

  interactiveElements.forEach((element) => {
    element.addEventListener('mousemove', (event) => {
      const rect = element.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      element.style.setProperty('--cursor-x', `${x}%`);
      element.style.setProperty('--cursor-y', `${y}%`);
    });

    element.addEventListener('mouseleave', () => {
      element.style.removeProperty('--cursor-x');
      element.style.removeProperty('--cursor-y');
    });
  });
});
