/**
 * Renders the contact section with action buttons and metadata.
 *
 * @returns {string} HTML markup for contact section
 */
function renderContact() {
  return `
<section class="section-block" id="contact">
  <div class="contact-card">
    <div>
      <p class="eyebrow">Let's connect</p>
      <h2>Open to impactful platform and security work.</h2>
      <p class="section-lede">For roles, collaborations, or speaking requests, reach out directly.</p>
    </div>
    <div class="contact-actions">
      <a class="btn btn-primary" href="https://email.leonardwong.tech" target="_blank" rel="noopener noreferrer">Email</a>
      <a class="btn btn-ghost" href="https://linkedin.leonardwong.tech" target="_blank" rel="noopener noreferrer">LinkedIn</a>
      <a class="btn btn-ghost" href="docs/resume.pdf" target="_blank" rel="noopener noreferrer">Resume</a>
    </div>
    <div class="contact-meta">
      <span>Based in Singapore</span>
      <span>Security + Platform Engineering</span>
    </div>
  </div>
</section>`;
}

module.exports = { renderContact };
