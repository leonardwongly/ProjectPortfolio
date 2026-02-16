document.addEventListener('DOMContentLoaded', () => {
  const interactiveSelectors = [
    '.hero-section',
    '.featured-card',
    '.skill-card',
    '.experience-card',
    '.credentials-grid .card',
    '.accordion-item',
    '.book-card',
    '.contact-card'
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

  const finePointer = window.matchMedia('(pointer: fine)');
  if (!finePointer.matches) {
    return;
  }

  interactiveElements.forEach((element) => {
    element.classList.add('interactive-card-pointer');
  });
});
