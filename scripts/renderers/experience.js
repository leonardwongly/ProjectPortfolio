const { escapeHtml } = require('./utils');

/**
 * Renders the experience section with work history cards.
 *
 * @param {Array} experience - Array of work experience objects
 * @returns {string} HTML markup for experience section
 */
function renderExperience(experience) {
  const entries = experience
    .map((role) => {
      const bullets = (role.impact_bullets || [])
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('');
      const tech = (role.tech || [])
        .map((item) => `<span class="chip">${escapeHtml(item)}</span>`)
        .join('');

      return `
      <article class="experience-card" data-role="${escapeHtml(role.role)}">
        <header>
          <h3>${escapeHtml(role.org)}</h3>
          <p class="experience-meta">${escapeHtml(role.role)} · ${escapeHtml(role.dates)}</p>
        </header>
        <ul class="experience-list">${bullets}</ul>
        <div class="chip-row">${tech}</div>
      </article>`;
    })
    .join('');

  return `
<section class="section-block" id="experience">
  <div class="section-header">
    <p class="eyebrow">Experience</p>
    <h2>Engineering roles with measurable outcomes</h2>
  </div>
  <div class="experience-grid">
    ${entries}
  </div>
</section>`;
}

module.exports = { renderExperience };
