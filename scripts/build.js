const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, 'src');
const partialDir = path.join(projectRoot, 'partials');
const dataDir = path.join(projectRoot, 'data');

const partials = {
  NAV: fs.readFileSync(path.join(partialDir, 'nav.html'), 'utf8'),
  FOOTER: fs.readFileSync(path.join(partialDir, 'footer.html'), 'utf8')
};

function readJson(name) {
  const file = path.join(dataDir, name);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing data file: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MAX_TEXT_LENGTH = 600;
const MAX_URL_LENGTH = 2048;

function failValidation(fieldPath, reason) {
  throw new Error(`Invalid data at ${fieldPath}: ${reason}`);
}

function ensureObject(value, fieldPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failValidation(fieldPath, 'expected an object');
  }
  return value;
}

function ensureArray(value, fieldPath, { min = 0, max = 1000 } = {}) {
  if (!Array.isArray(value)) {
    failValidation(fieldPath, 'expected an array');
  }
  if (value.length < min) {
    failValidation(fieldPath, `expected at least ${min} item(s)`);
  }
  if (value.length > max) {
    failValidation(fieldPath, `expected at most ${max} item(s)`);
  }
  return value;
}

function ensureAllowedKeys(value, fieldPath, allowedKeys) {
  const extras = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (extras.length) {
    failValidation(fieldPath, `unexpected key(s): ${extras.join(', ')}`);
  }
}

function ensureString(value, fieldPath, { allowEmpty = false, maxLength = MAX_TEXT_LENGTH } = {}) {
  if (typeof value !== 'string') {
    failValidation(fieldPath, 'expected a string');
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    failValidation(fieldPath, 'expected a non-empty string');
  }
  if (trimmed.length > maxLength) {
    failValidation(fieldPath, `string exceeds max length ${maxLength}`);
  }
  return trimmed;
}

function ensureOptionalString(value, fieldPath, { maxLength = MAX_TEXT_LENGTH } = {}) {
  if (value === undefined || value === null) {
    return '';
  }
  return ensureString(value, fieldPath, { allowEmpty: true, maxLength });
}

function hasUrlScheme(value) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function assertNoTraversal(pathPart, fieldPath) {
  if (pathPart.includes('\0') || pathPart.includes('\\')) {
    failValidation(fieldPath, 'path contains disallowed characters');
  }
  let decoded = pathPart;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch (error) {
    failValidation(fieldPath, 'path contains invalid URL encoding');
  }
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '..')) {
    failValidation(fieldPath, 'path traversal is not allowed');
  }
  if (segments.some((segment) => segment === '.')) {
    failValidation(fieldPath, 'dot path segments are not allowed');
  }
  if (segments.some((segment) => segment.length === 0)) {
    failValidation(fieldPath, 'empty path segments are not allowed');
  }
  const normalized = path.posix.normalize(pathPart);
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    failValidation(fieldPath, 'path traversal is not allowed');
  }
}

function sanitizeRelativeLink(rawValue, fieldPath) {
  const value = ensureString(rawValue, fieldPath, { maxLength: MAX_URL_LENGTH });
  if (value.startsWith('//')) {
    failValidation(fieldPath, 'protocol-relative URLs are not allowed');
  }
  if (value.startsWith('#')) {
    if (!/^#[A-Za-z0-9:_-]+$/.test(value)) {
      failValidation(fieldPath, 'invalid fragment identifier');
    }
    return value;
  }

  const [pathPart, queryAndHash = ''] = value.split(/([?#].*)/, 2);
  if (!pathPart) {
    failValidation(fieldPath, 'relative URL must include a path or fragment');
  }
  if (pathPart.startsWith('/')) {
    assertNoTraversal(pathPart.slice(1), fieldPath);
    return `${path.posix.normalize(pathPart)}${queryAndHash}`;
  }

  assertNoTraversal(pathPart, fieldPath);
  return `${path.posix.normalize(pathPart)}${queryAndHash}`;
}

function sanitizeHref(rawValue, fieldPath) {
  const value = ensureString(rawValue, fieldPath, { maxLength: MAX_URL_LENGTH });

  if (hasUrlScheme(value)) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch (error) {
      failValidation(fieldPath, 'malformed URL');
    }
    if (parsed.protocol !== 'https:') {
      failValidation(fieldPath, 'only https URLs are allowed');
    }
    if (parsed.username || parsed.password) {
      failValidation(fieldPath, 'credentials in URL are not allowed');
    }
    return parsed.toString();
  }

  return sanitizeRelativeLink(value, fieldPath);
}

function sanitizeAssetPath(rawValue, fieldPath) {
  const value = ensureString(rawValue, fieldPath, { maxLength: 512 });
  if (hasUrlScheme(value) || value.startsWith('/') || value.startsWith('//')) {
    failValidation(fieldPath, 'asset path must be relative');
  }
  if (value.includes('?') || value.includes('#')) {
    failValidation(fieldPath, 'asset path cannot include query/hash');
  }
  assertNoTraversal(value, fieldPath);
  return path.posix.normalize(value);
}

function safeHref(rawValue, fieldPath, { fallback = '#' } = {}) {
  try {
    return sanitizeHref(rawValue, fieldPath);
  } catch (error) {
    console.warn(`[build] ${error.message}. Falling back to "${fallback}".`);
    return fallback;
  }
}

function safeAssetPath(rawValue, fieldPath) {
  try {
    return sanitizeAssetPath(rawValue, fieldPath);
  } catch (error) {
    console.warn(`[build] ${error.message}. Dropping unsafe asset path.`);
    return '';
  }
}

function validateFeaturedData(items) {
  const list = ensureArray(items, 'featured-projects', { min: 1, max: 50 });
  list.forEach((project, index) => {
    const fieldPath = `featured-projects[${index}]`;
    ensureObject(project, fieldPath);
    ensureAllowedKeys(project, fieldPath, ['id', 'title', 'timeframe', 'problem', 'impact', 'tech', 'links']);
    ensureString(project.id, `${fieldPath}.id`, { maxLength: 80 });
    ensureString(project.title, `${fieldPath}.title`, { maxLength: 200 });
    ensureString(project.timeframe, `${fieldPath}.timeframe`, { maxLength: 120 });
    ensureString(project.problem, `${fieldPath}.problem`, { maxLength: 900 });
    ensureString(project.impact, `${fieldPath}.impact`, { maxLength: 900 });
    ensureArray(project.tech || [], `${fieldPath}.tech`, { max: 20 }).forEach((item, itemIndex) => {
      ensureString(item, `${fieldPath}.tech[${itemIndex}]`, { maxLength: 80 });
    });
    ensureArray(project.links || [], `${fieldPath}.links`, { max: 12 }).forEach((link, linkIndex) => {
      const linkPath = `${fieldPath}.links[${linkIndex}]`;
      ensureObject(link, linkPath);
      ensureAllowedKeys(link, linkPath, ['label', 'url']);
      ensureString(link.label, `${linkPath}.label`, { maxLength: 80 });
      sanitizeHref(link.url, `${linkPath}.url`);
    });
  });
}

function validateSkillsData(items) {
  const list = ensureArray(items, 'skills', { min: 1, max: 30 });
  list.forEach((group, index) => {
    const fieldPath = `skills[${index}]`;
    ensureObject(group, fieldPath);
    ensureAllowedKeys(group, fieldPath, ['category', 'items']);
    ensureString(group.category, `${fieldPath}.category`, { maxLength: 80 });
    ensureArray(group.items, `${fieldPath}.items`, { min: 1, max: 40 }).forEach((item, itemIndex) => {
      ensureString(item, `${fieldPath}.items[${itemIndex}]`, { maxLength: 80 });
    });
  });
}

function validateExperienceData(items) {
  const list = ensureArray(items, 'experience', { min: 1, max: 60 });
  list.forEach((role, index) => {
    const fieldPath = `experience[${index}]`;
    ensureObject(role, fieldPath);
    ensureAllowedKeys(role, fieldPath, ['org', 'role', 'dates', 'impact_bullets', 'tech']);
    ensureString(role.org, `${fieldPath}.org`, { maxLength: 120 });
    ensureString(role.role, `${fieldPath}.role`, { maxLength: 160 });
    ensureString(role.dates, `${fieldPath}.dates`, { maxLength: 80 });
    ensureArray(role.impact_bullets, `${fieldPath}.impact_bullets`, { min: 1, max: 20 }).forEach((item, itemIndex) => {
      ensureString(item, `${fieldPath}.impact_bullets[${itemIndex}]`, { maxLength: 500 });
    });
    ensureArray(role.tech || [], `${fieldPath}.tech`, { max: 30 }).forEach((item, itemIndex) => {
      ensureString(item, `${fieldPath}.tech[${itemIndex}]`, { maxLength: 80 });
    });
  });
}

function validateCertificationData(items) {
  const list = ensureArray(items, 'certifications', { min: 1, max: 120 });
  list.forEach((cert, index) => {
    const fieldPath = `certifications[${index}]`;
    ensureObject(cert, fieldPath);
    ensureAllowedKeys(cert, fieldPath, ['title', 'issuer', 'issued', 'credential_id', 'link', 'icon', 'icon_alt']);
    ensureString(cert.title, `${fieldPath}.title`, { maxLength: 220 });
    ensureString(cert.issuer, `${fieldPath}.issuer`, { maxLength: 220 });
    ensureString(cert.issued, `${fieldPath}.issued`, { maxLength: 120 });
    ensureOptionalString(cert.credential_id, `${fieldPath}.credential_id`, { maxLength: 120 });
    sanitizeHref(cert.link, `${fieldPath}.link`);
    if (cert.icon !== undefined) {
      sanitizeAssetPath(cert.icon, `${fieldPath}.icon`);
    }
    ensureOptionalString(cert.icon_alt, `${fieldPath}.icon_alt`, { maxLength: 120 });
  });
}

function validateReadingData(items) {
  const list = ensureArray(items, 'reading', { min: 1, max: 2000 });
  list.forEach((entry, index) => {
    const fieldPath = `reading[${index}]`;
    ensureObject(entry, fieldPath);
    ensureAllowedKeys(entry, fieldPath, ['year', 'title', 'author', 'isbn', 'cover', 'link', 'tags']);

    if (typeof entry.year !== 'number' && typeof entry.year !== 'string') {
      failValidation(`${fieldPath}.year`, 'expected year as number or string');
    }
    const year = Number.parseInt(String(entry.year), 10);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      failValidation(`${fieldPath}.year`, 'expected year in range 1900..2100');
    }

    ensureString(entry.title, `${fieldPath}.title`, { maxLength: 240 });
    ensureOptionalString(entry.author, `${fieldPath}.author`, { maxLength: 160 });
    ensureString(entry.isbn, `${fieldPath}.isbn`, { maxLength: 80 });
    if (entry.link !== undefined) {
      ensureOptionalString(entry.link, `${fieldPath}.link`, { maxLength: MAX_URL_LENGTH });
      if (String(entry.link).trim() !== '') {
        sanitizeHref(entry.link, `${fieldPath}.link`);
      }
    }
    if (entry.cover !== undefined) {
      ensureOptionalString(entry.cover, `${fieldPath}.cover`, { maxLength: 512 });
      if (String(entry.cover).trim() !== '') {
        sanitizeAssetPath(entry.cover, `${fieldPath}.cover`);
      }
    }
    if (entry.tags !== undefined) {
      ensureArray(entry.tags, `${fieldPath}.tags`, { max: 20 }).forEach((tag, tagIndex) => {
        ensureString(tag, `${fieldPath}.tags[${tagIndex}]`, { maxLength: 40 });
      });
    }
  });
}

function validateDataCollections(allData) {
  ensureObject(allData, 'data');
  validateFeaturedData(allData.featured);
  validateSkillsData(allData.skills);
  validateExperienceData(allData.experience);
  validateCertificationData(allData.certifications);
  validateReadingData(allData.reading);
}

function renderHero() {
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

function renderFeaturedWork(items) {
  const cards = items
    .map((project, projectIndex) => {
      const tech = project.tech || [];
      const techChips = tech
        .map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`)
        .join('');
      const links = (project.links || [])
        .map((link, linkIndex) => {
          const label = escapeHtml(link.label || 'Link');
          const url = escapeHtml(safeHref(link.url || '#', `featured-projects[${projectIndex}].links[${linkIndex}].url`));
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

function renderCertifications(certifications) {
  const cards = certifications
    .map((cert, certIndex) => {
      const title = escapeHtml(cert.title);
      const issuer = escapeHtml(cert.issuer);
      const issued = escapeHtml(cert.issued);
      const credentialId = cert.credential_id ? escapeHtml(cert.credential_id) : '';
      const link = escapeHtml(safeHref(cert.link, `certifications[${certIndex}].link`));
      const iconPath = cert.icon ? safeAssetPath(String(cert.icon), `certifications[${certIndex}].icon`) : '';
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

function inferTags(entry) {
  const title = entry.title.toLowerCase();
  const tags = new Set();
  if (/(security|xss|hack|cyber)/.test(title)) tags.add('Security');
  if (/(data|analytics|ai|algorithm)/.test(title)) tags.add('Data');
  if (/(apple|business|strategy|leader|ceo|management|product)/.test(title)) tags.add('Business');
  if (/(design|ux|creative)/.test(title)) tags.add('Design');
  if (/(history|political|story|journey|memoir)/.test(title)) tags.add('Biography');
  return Array.from(tags);
}

function renderReadingGrid(reading) {
  const missingCovers = new Set();
  const items = reading.map((entry, entryIndex) => {
    const tags = (entry.tags && entry.tags.length ? entry.tags : inferTags(entry)) || [];
    const tagAttr = tags.map((tag) => tag.toLowerCase()).join(',');
    const year = escapeHtml(entry.year);
    const title = escapeHtml(entry.title);
    const author = escapeHtml(entry.author);
    const isbn = escapeHtml(entry.isbn);
    const link = entry.link ? escapeHtml(safeHref(entry.link, `reading[${entryIndex}].link`)) : '';

    const coverPath = entry.cover ? safeAssetPath(String(entry.cover), `reading[${entryIndex}].cover`) : '';
    let cover2xPath = coverPath.replace('-300.jpg', '.jpg').replace('-300.jpeg', '.jpeg');
    if (cover2xPath === coverPath) {
      cover2xPath = coverPath;
    }

    const hasCover = coverPath && fs.existsSync(path.join(projectRoot, coverPath));
    const hasCover2x = cover2xPath && fs.existsSync(path.join(projectRoot, cover2xPath));
    const safeCover2x = hasCover2x ? cover2xPath : coverPath;
    const cover = escapeHtml(coverPath);
    const cover2x = escapeHtml(safeCover2x);

    if (!hasCover) {
      missingCovers.add(coverPath || `${entry.title} (${entry.year})`);
    }

    let media = '';
    if (hasCover) {
      const webp1xPath = coverPath.replace('.jpg', '.webp').replace('.jpeg', '.webp');
      const webp2xPath = safeCover2x.replace('.jpg', '.webp').replace('.jpeg', '.webp');
      const hasWebp = fs.existsSync(path.join(projectRoot, webp1xPath)) && fs.existsSync(path.join(projectRoot, webp2xPath));
      const webp1x = escapeHtml(webp1xPath);
      const webp2x = escapeHtml(webp2xPath);
      const webpSource = hasWebp
        ? `<source type="image/webp" srcset="${webp1x} 1x, ${webp2x} 2x" />`
        : '';

      const image = `
      <picture>
        ${webpSource}
        <img decoding="async" src="${cover}" class="book-cover" srcset="${cover} 1x, ${cover2x} 2x" sizes="(min-width: 992px) 16vw, 44vw" alt="Cover of ${title}" loading="lazy" />
      </picture>`;

      media = link
        ? `<a href="${link}" target="_blank" rel="noopener noreferrer">${image}</a>`
        : image;
    } else {
      const placeholder = `
      <div class="book-placeholder">
        <p class="book-placeholder-title">${title}</p>
        <p class="book-placeholder-author">${author}</p>
        <p class="book-placeholder-isbn">ISBN ${isbn}</p>
      </div>`;
      media = link
        ? `<a href="${link}" target="_blank" rel="noopener noreferrer">${placeholder}</a>`
        : placeholder;
    }

    return `
      <article class="book-card" data-reading-item data-year="${year}" data-tags="${tagAttr}" data-title="${title}" data-author="${author}" data-isbn="${isbn}">
        <div class="book-media">${media}</div>
        <div class="book-body">
          <p class="book-year">${year}</p>
          <h3>${title}</h3>
          <p class="book-author">${author}</p>
          <p class="book-isbn">ISBN ${isbn}</p>
          ${tags.length ? `<div class="chip-row">${tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
        </div>
      </article>`;
  }).join('');

  const years = Array.from(new Set(reading.map((entry) => entry.year))).sort((a, b) => b - a);
  const tags = new Set();
  reading.forEach((entry) => {
    const derived = entry.tags && entry.tags.length ? entry.tags : inferTags(entry);
    derived.forEach((tag) => tags.add(tag));
  });
  const tagList = Array.from(tags).sort();

  const yearButtons = ['All', ...years.map(String)]
    .map((value) => {
      const label = value === 'All' ? 'All years' : value;
      return `<button type="button" class="filter-pill" data-filter-group="year" data-filter-value="${value}">${label}</button>`;
    })
    .join('');

  const tagButtons = tagList.length
    ? [`<button type="button" class="filter-pill" data-filter-group="tag" data-filter-value="All">All tags</button>`]
        .concat(tagList.map((tag) => `<button type="button" class="filter-pill" data-filter-group="tag" data-filter-value="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`))
        .join('')
    : '';

  if (missingCovers.size > 0) {
    console.warn(`Missing book covers (${missingCovers.size}):\n- ${Array.from(missingCovers).join('\n- ')}`);
  }

  return `
<section class="section-block reading-section" data-reading>
  <div class="section-header">
    <p class="eyebrow">Reading</p>
    <h2>Books that shaped my thinking</h2>
    <p class="section-lede">Search by title, author, ISBN, or filter by year and tag.</p>
  </div>

  <div class="reading-controls">
    <label class="search-field">
      <span>Search</span>
      <input type="search" id="readingSearch" placeholder="Search by title, author, ISBN" autocomplete="off" />
    </label>
    <div class="filter-group">
      <p class="filter-label">Year</p>
      <div class="filter-pills" data-filter-group="year">${yearButtons}</div>
      ${tagList.length ? `<p class="filter-label">Tags</p><div class="filter-pills" data-filter-group="tag">${tagButtons}</div>` : ''}
    </div>
    <div class="view-toggle" role="group" aria-label="Toggle reading view">
      <button type="button" class="view-pill" data-view="grid" aria-pressed="true">Grid</button>
      <button type="button" class="view-pill" data-view="list" aria-pressed="false">List</button>
    </div>
  </div>

  <div class="reading-grid" data-reading-grid data-view="grid">
    ${items}
  </div>
  <p class="reading-empty" data-reading-empty hidden>No matches yet. Try clearing filters.</p>
</section>`;
}

function renderContact() {
  return `
<section class="section-block" id="contact">
  <div class="contact-card">
    <div>
      <p class="eyebrow">Let’s connect</p>
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

function buildSite() {
  const data = {
    featured: readJson('featured-projects.json'),
    skills: readJson('skills.json'),
    experience: readJson('experience.json'),
    certifications: readJson('certifications.json'),
    reading: readJson('reading.json')
  };

  validateDataCollections(data);

  const tokens = {
    ...partials,
    HERO: renderHero(),
    FEATURED_WORK: renderFeaturedWork(data.featured),
    SKILLS: renderSkills(data.skills),
    EXPERIENCE: renderExperience(data.experience),
    CERTIFICATIONS: renderCertifications(data.certifications),
    READING_GRID: renderReadingGrid(data.reading),
    CONTACT: renderContact()
  };

  const pages = ['index.html', 'reading.html', 'offline.html'];

  pages.forEach((page) => {
    const srcPath = path.join(srcDir, page);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Missing source page: ${srcPath}`);
    }

    let content = fs.readFileSync(srcPath, 'utf8');
    Object.entries(tokens).forEach(([key, value]) => {
      const token = `{{${key}}}`;
      if (content.includes(token)) {
        content = content.replaceAll(token, value);
      }
    });

    const leftover = content.match(/\{\{[A-Z_]+}}/g);
    if (leftover) {
      throw new Error(`Unresolved tokens in ${page}: ${leftover.join(', ')}`);
    }

    fs.writeFileSync(path.join(projectRoot, page), content);
  });

  console.log('Build complete: generated', pages.join(', '));
}

if (require.main === module) {
  buildSite();
}

module.exports = {
  buildSite,
  sanitizeHref,
  sanitizeAssetPath,
  sanitizeRelativeLink,
  validateDataCollections
};
