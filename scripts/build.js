const fs = require('fs');
const path = require('path');

// Import renderer modules
const { renderHero } = require('./renderers/hero');
const { renderContact } = require('./renderers/contact');
const { renderFeaturedWork } = require('./renderers/featured-work');
const { renderSkills } = require('./renderers/skills');
const { renderExperience } = require('./renderers/experience');
const { renderCertifications } = require('./renderers/certifications');
const { renderReadingGrid } = require('./renderers/reading');

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

/**
 * Main build function that generates production HTML files from templates.
 * Validates data, renders sections using modular renderers, and outputs files.
 */
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
    HERO: renderHero(projectRoot),
    FEATURED_WORK: renderFeaturedWork(data.featured, sanitizeHref),
    SKILLS: renderSkills(data.skills),
    EXPERIENCE: renderExperience(data.experience),
    CERTIFICATIONS: renderCertifications(data.certifications, projectRoot, sanitizeHref, sanitizeAssetPath),
    READING_GRID: renderReadingGrid(data.reading, projectRoot, sanitizeHref, sanitizeAssetPath),
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
