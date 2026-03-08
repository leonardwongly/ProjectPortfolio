const { escapeHtml } = require('./utils');

/**
 * Renders the skills section with categorized skill chips.
 *
 * @param {Array} skills - Array of skill group objects
 * @returns {string} HTML markup for skills section
 */
function renderSkills(skills) {
  const groups = skills
    .map((group) => {
      const items = (group.items || [])
        .map((item) => `<span class="chip">${escapeHtml(item)}</span>`)
        .join('');
      return `
      <div class="skill-card">
        <h3>${escapeHtml(group.category)}</h3>
        <div class="chip-row">${items}</div>
      </div>`;
    })
    .join('');

  return `
<section class="section-block" id="skills">
  <div class="section-header">
    <p class="eyebrow">Skills</p>
    <h2>Technical breadth with delivery depth</h2>
  </div>
  <div class="skills-grid">
    ${groups}
  </div>
</section>`;
}

module.exports = { renderSkills };
