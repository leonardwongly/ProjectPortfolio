const fs = require('fs');
const path = require('path');

/**
 * Renders the hero section with profile portrait and introduction.
 * Automatically detects and uses WebP images if available.
 *
 * @param {string} projectRoot - Absolute path to project root directory
 * @returns {string} HTML markup for hero section
 */
function renderHero(projectRoot) {
  const webp220 = path.join(projectRoot, 'images/leo-220.webp');
  const webp440 = path.join(projectRoot, 'images/leo-440.webp');
  const hasWebp = fs.existsSync(webp220) && fs.existsSync(webp440);
  const pictureSource = hasWebp
    ? '<source type="image/webp" srcset="images/leo-220.webp 1x, images/leo-440.webp 2x" />'
    : '';
  return `
<section class="hero-section section-block" id="home">
  <div class="hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Software Engineer · Singapore</p>
      <h1>Building secure, data-driven platforms with measurable impact.</h1>
      <p class="lead">
        Software Engineer at NCS Group and graduate student at NUS ISS. I ship reliable internal products,
        automate data-heavy workflows, and integrate security early.
      </p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="docs/resume.pdf" target="_blank" rel="noopener noreferrer">View Resume</a>
        <a class="btn btn-ghost" href="#contact">Contact</a>
      </div>
      <div class="hero-highlights">
        <div class="highlight-card">
          <span class="highlight-label">Focus</span>
          <span class="highlight-value">Security · Platforms</span>
        </div>
        <div class="highlight-card">
          <span class="highlight-label">Strength</span>
          <span class="highlight-value">Data Automation</span>
        </div>
        <div class="highlight-card">
          <span class="highlight-label">Now</span>
          <span class="highlight-value">NCS · NUS ISS</span>
        </div>
      </div>
    </div>
    <div class="hero-visual">
      <div class="hero-portrait">
        <picture>
          ${pictureSource}
          <img decoding="async" fetchpriority="high" src="images/leo-220.jpeg" alt="Portrait of Leonard Wong" loading="eager" width="220" height="220" srcset="images/leo-220.jpeg 1x, images/leo-440.jpeg 2x" sizes="(min-width: 992px) 220px, 60vw" />
        </picture>
      </div>
      <div class="now-card">
        <p class="now-label">Currently</p>
        <p class="now-value">Software Engineer @ NCS Group</p>
        <p class="now-sub">Graduate Student · NUS ISS</p>
      </div>
    </div>
  </div>
</section>`;
}

module.exports = { renderHero };
