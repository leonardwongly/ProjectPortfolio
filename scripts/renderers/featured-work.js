const { escapeHtml, safeHref } = require('./utils');

/**
 * Renders the featured work section with project cards.
 *
 * @param {Array} items - Array of featured project objects
 * @param {Function} sanitizeHref - Sanitization function from build.js
 * @returns {string} HTML markup for featured work section
 */
function renderFeaturedWork(items, sanitizeHref) {
  const cards = items
    .map((project, projectIndex) => {
      const tech = project.tech || [];
      const techChips = tech
        .map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`)
        .join('');
      const links = (project.links || [])
        .map((link, linkIndex) => {
          const label = escapeHtml(link.label || 'Link');
          const url = escapeHtml(safeHref(link.url || '#', `featured-projects[${projectIndex}].links[${linkIndex}].url`, {}, sanitizeHref));
          return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        })
        .join('');
      const linkBlock = links ? `<div class="featured-links">${links}</div>` : '';

      return `
      <article class="featured-card" data-tags="${escapeHtml(tech.join(','))}">
        <header>
          <p class="featured-kicker">${escapeHtml(project.timeframe || '')}</p>
          <h3>${escapeHtml(project.title)}</h3>
        </header>
        <div class="featured-block">
          <span class="block-label">Problem</span>
          <p>${escapeHtml(project.problem)}</p>
        </div>
        <div class="featured-block">
          <span class="block-label">Impact</span>
          <p>${escapeHtml(project.impact)}</p>
        </div>
        <div class="chip-row">${techChips}</div>
        ${linkBlock}
      </article>`;
    })
    .join('');

  return `
<section class="section-block" id="work">
  <div class="section-header">
    <p class="eyebrow">Featured Work</p>
    <h2>Selected projects that highlight impact</h2>
    <p class="section-lede">A focused set of projects that show how I deliver secure, data-heavy systems.</p>
  </div>
  <div class="featured-grid">
    ${cards}
  </div>
</section>`;
}

module.exports = { renderFeaturedWork };
