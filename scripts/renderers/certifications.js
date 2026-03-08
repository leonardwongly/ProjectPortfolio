const fs = require('fs');
const path = require('path');
const { escapeHtml, safeHref, safeAssetPath } = require('./utils');

/**
 * Renders the certifications grid with credential cards.
 *
 * @param {Array} certifications - Array of certification objects
 * @param {string} projectRoot - Absolute path to project root directory
 * @param {Function} sanitizeHref - Sanitization function from build.js
 * @param {Function} sanitizeAssetPath - Sanitization function from build.js
 * @returns {string} HTML markup for certifications grid
 */
function renderCertifications(certifications, projectRoot, sanitizeHref, sanitizeAssetPath) {
  const cards = certifications
    .map((cert, certIndex) => {
      const title = escapeHtml(cert.title);
      const issuer = escapeHtml(cert.issuer);
      const issued = escapeHtml(cert.issued);
      const credentialId = cert.credential_id ? escapeHtml(cert.credential_id) : '';
      const link = escapeHtml(safeHref(cert.link, `certifications[${certIndex}].link`, {}, sanitizeHref));
      const iconPath = cert.icon ? safeAssetPath(String(cert.icon), `certifications[${certIndex}].icon`, sanitizeAssetPath) : '';
      const iconAlt = escapeHtml(cert.icon_alt || `${cert.issuer} logo`);

      let iconMarkup = '';
      if (iconPath) {
        const icon2x = iconPath.replace('-30.', '-60.');
        const hasIcon2x = icon2x !== iconPath && fs.existsSync(path.join(projectRoot, icon2x));
        const iconSrc = escapeHtml(iconPath);
        const iconSrcset = hasIcon2x ? `${iconSrc} 1x, ${escapeHtml(icon2x)} 2x` : `${iconSrc} 1x`;
        iconMarkup = `<img decoding="async" src="${iconSrc}" alt="${iconAlt}" loading="lazy" width="30" height="30" class="circle-img" srcset="${iconSrcset}" sizes="30px"/>`;
      }

      const meta = credentialId ? `${issued} · Credential ID ${credentialId}` : issued;

      return `
      <article class="card p-3">
        <h3 class="card-title">${iconMarkup ? `${iconMarkup}&nbsp;` : ''}${title}</h3>
        <p>${issuer}</p>
        <p class="card-text fw-light">${meta}</p>
        <a class="badge rounded-pill bg-dark shadow" href="${link}" target="_blank" rel="noopener noreferrer">View Certification&nbsp;<svg class="icon icon-arrow" aria-hidden="true" focusable="false"><use href="#icon-arrow-up-right-square"/></svg></a>
      </article>`;
    })
    .join('');

  return `
<div class="certifications-grid">
  ${cards}
</div>`;
}

module.exports = { renderCertifications };
