const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, 'src');
const partialDir = path.join(projectRoot, 'partials');
const dataDir = path.join(projectRoot, 'data');
const headersTemplatePath = path.join(srcDir, '_headers.template');

const partials = {
  NAV: fs.readFileSync(path.join(partialDir, 'nav.html'), 'utf8'),
  FOOTER: fs.readFileSync(path.join(partialDir, 'footer.html'), 'utf8')
};

const CSP_INLINE_SCRIPT_HASH_TOKEN = '{{CSP_SCRIPT_HASHES}}';

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

function escapeJsonLd(value) {
  return JSON.stringify(value, null, 8)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function stripTrailingWhitespace(content) {
  return content
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
}

function hashInlineScript(content) {
  return `sha256-${crypto.createHash('sha256').update(content, 'utf8').digest('base64')}`;
}

function isAsciiWhitespace(char) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\f' || char === '\r';
}

function findScriptStartTag(html, fromIndex) {
  const normalizedHtml = html.toLowerCase();
  let start = normalizedHtml.indexOf('<script', fromIndex);

  while (start !== -1) {
    const nextChar = normalizedHtml[start + '<script'.length];
    if (nextChar === '>' || isAsciiWhitespace(nextChar)) {
      return start;
    }
    start = normalizedHtml.indexOf('<script', start + '<script'.length);
  }

  return -1;
}

function findScriptEndTag(html, fromIndex) {
  const normalizedHtml = html.toLowerCase();
  let start = normalizedHtml.indexOf('</script', fromIndex);

  while (start !== -1) {
    const afterName = start + '</script'.length;
    const nextChar = normalizedHtml[afterName];

    if (nextChar === '>' || isAsciiWhitespace(nextChar)) {
      const end = html.indexOf('>', afterName);
      return end === -1 ? null : { start, end: end + 1 };
    }

    start = normalizedHtml.indexOf('</script', afterName);
  }

  return null;
}

function hasScriptSrcAttribute(attrs) {
  let index = 0;

  while (index < attrs.length) {
    while (index < attrs.length && isAsciiWhitespace(attrs[index])) {
      index += 1;
    }

    if (attrs[index] === '/') {
      index += 1;
      continue;
    }

    const nameStart = index;
    while (
      index < attrs.length &&
      !isAsciiWhitespace(attrs[index]) &&
      attrs[index] !== '=' &&
      attrs[index] !== '/' &&
      attrs[index] !== '>'
    ) {
      index += 1;
    }

    const name = attrs.slice(nameStart, index).toLowerCase();
    while (index < attrs.length && isAsciiWhitespace(attrs[index])) {
      index += 1;
    }

    if (attrs[index] !== '=') {
      if (index === nameStart) {
        index += 1;
      }
      continue;
    }

    if (name === 'src') {
      return true;
    }

    index += 1;
    while (index < attrs.length && isAsciiWhitespace(attrs[index])) {
      index += 1;
    }

    const quote = attrs[index];
    if (quote === '"' || quote === "'") {
      index += 1;
      const closingQuote = attrs.indexOf(quote, index);
      index = closingQuote === -1 ? attrs.length : closingQuote + 1;
      continue;
    }

    while (index < attrs.length && !isAsciiWhitespace(attrs[index])) {
      index += 1;
    }
  }

  return false;
}

function collectInlineScriptHashes(html) {
  const hashes = [];
  let fromIndex = 0;
  let start = findScriptStartTag(html, fromIndex);

  while (start !== -1) {
    const openEnd = html.indexOf('>', start + '<script'.length);
    if (openEnd === -1) {
      break;
    }

    const endTag = findScriptEndTag(html, openEnd + 1);
    if (!endTag) {
      break;
    }

    const attrs = html.slice(start + '<script'.length, openEnd);
    if (!hasScriptSrcAttribute(attrs)) {
      hashes.push(hashInlineScript(html.slice(openEnd + 1, endTag.start)));
    }

    fromIndex = endTag.end;
    start = findScriptStartTag(html, fromIndex);
  }

  return hashes;
}

function renderCspScriptHashesDirective(html) {
  const hashes = collectInlineScriptHashes(html);
  return hashes.length ? ` ${hashes.map((hash) => `'${hash}'`).join(' ')}` : '';
}

function injectCspScriptHashes(template, html) {
  return template.replaceAll(CSP_INLINE_SCRIPT_HASH_TOKEN, renderCspScriptHashesDirective(html));
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
    if (cert.link !== undefined) {
      const link = ensureOptionalString(cert.link, `${fieldPath}.link`, { maxLength: MAX_URL_LENGTH });
      if (link !== '') {
        sanitizeHref(link, `${fieldPath}.link`);
      }
    }
    if (cert.icon !== undefined) {
      sanitizeAssetPath(cert.icon, `${fieldPath}.icon`);
    }
    ensureOptionalString(cert.icon_alt, `${fieldPath}.icon_alt`, { maxLength: 120 });
  });
}

function validateAction(action, fieldPath) {
  ensureObject(action, fieldPath);
  ensureAllowedKeys(action, fieldPath, ['label', 'href', 'variant']);
  ensureString(action.label, `${fieldPath}.label`, { maxLength: 80 });
  sanitizeHref(action.href, `${fieldPath}.href`);
  if (action.variant !== undefined) {
    const variant = ensureString(action.variant, `${fieldPath}.variant`, { maxLength: 20 });
    if (variant !== 'primary' && variant !== 'ghost') {
      failValidation(`${fieldPath}.variant`, 'expected primary or ghost');
    }
  }
}

function validateLabelValue(item, fieldPath) {
  ensureObject(item, fieldPath);
  ensureAllowedKeys(item, fieldPath, ['label', 'value']);
  ensureString(item.label, `${fieldPath}.label`, { maxLength: 80 });
  ensureString(item.value, `${fieldPath}.value`, { maxLength: 120 });
}

function validateLanguageEntry(item, fieldPath) {
  ensureObject(item, fieldPath);
  ensureAllowedKeys(item, fieldPath, ['name', 'proficiency']);
  ensureString(item.name, `${fieldPath}.name`, { maxLength: 80 });
  ensureString(item.proficiency, `${fieldPath}.proficiency`, { maxLength: 120 });
}

function validateCommunityRole(role, fieldPath) {
  ensureObject(role, fieldPath);
  ensureAllowedKeys(role, fieldPath, ['title', 'dates']);
  ensureString(role.title, `${fieldPath}.title`, { maxLength: 160 });
  ensureString(role.dates, `${fieldPath}.dates`, { maxLength: 120 });
}

function validateCommunityEntry(entry, fieldPath) {
  ensureObject(entry, fieldPath);
  ensureAllowedKeys(entry, fieldPath, ['id', 'organization', 'logo', 'logo_alt', 'roles', 'responsibilities']);
  ensureString(entry.id, `${fieldPath}.id`, { maxLength: 40 });
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(entry.id)) {
    failValidation(`${fieldPath}.id`, 'expected an identifier starting with a letter');
  }
  ensureString(entry.organization, `${fieldPath}.organization`, { maxLength: 180 });
  sanitizeAssetPath(entry.logo, `${fieldPath}.logo`);
  ensureString(entry.logo_alt, `${fieldPath}.logo_alt`, { maxLength: 140 });
  ensureArray(entry.roles, `${fieldPath}.roles`, { min: 1, max: 20 }).forEach((role, index) => {
    validateCommunityRole(role, `${fieldPath}.roles[${index}]`);
  });
  ensureArray(entry.responsibilities, `${fieldPath}.responsibilities`, { min: 1, max: 20 }).forEach((item, index) => {
    ensureString(item, `${fieldPath}.responsibilities[${index}]`, { maxLength: 260 });
  });
}

function validateProfileData(profile) {
  ensureObject(profile, 'profile');
  ensureAllowedKeys(profile, 'profile', [
    'person',
    'hero',
    'education',
    'publication',
    'articles',
    'honors',
    'languages',
    'community',
    'contact'
  ]);

  const person = ensureObject(profile.person, 'profile.person');
  ensureAllowedKeys(person, 'profile.person', [
    'name',
    'job_title',
    'location',
    'url',
    'works_for',
    'client_context',
    'same_as',
    'knows_about'
  ]);
  ensureString(person.name, 'profile.person.name', { maxLength: 120 });
  ensureString(person.job_title, 'profile.person.job_title', { maxLength: 120 });
  ensureString(person.location, 'profile.person.location', { maxLength: 120 });
  sanitizeHref(person.url, 'profile.person.url');
  ensureString(person.works_for, 'profile.person.works_for', { maxLength: 160 });
  ensureString(person.client_context, 'profile.person.client_context', { maxLength: 220 });
  ensureArray(person.same_as, 'profile.person.same_as', { min: 1, max: 20 }).forEach((url, index) => {
    sanitizeHref(url, `profile.person.same_as[${index}]`);
  });
  ensureArray(person.knows_about, 'profile.person.knows_about', { min: 1, max: 40 }).forEach((item, index) => {
    ensureString(item, `profile.person.knows_about[${index}]`, { maxLength: 80 });
  });

  const hero = ensureObject(profile.hero, 'profile.hero');
  ensureAllowedKeys(hero, 'profile.hero', ['eyebrow', 'headline', 'lead', 'actions', 'highlights', 'current']);
  ensureString(hero.eyebrow, 'profile.hero.eyebrow', { maxLength: 120 });
  ensureString(hero.headline, 'profile.hero.headline', { maxLength: 180 });
  ensureString(hero.lead, 'profile.hero.lead', { maxLength: 420 });
  ensureArray(hero.actions, 'profile.hero.actions', { min: 1, max: 5 }).forEach((action, index) => {
    validateAction(action, `profile.hero.actions[${index}]`);
  });
  ensureArray(hero.highlights, 'profile.hero.highlights', { min: 1, max: 6 }).forEach((item, index) => {
    validateLabelValue(item, `profile.hero.highlights[${index}]`);
  });
  const current = ensureObject(hero.current, 'profile.hero.current');
  ensureAllowedKeys(current, 'profile.hero.current', ['label', 'value', 'sub']);
  ensureString(current.label, 'profile.hero.current.label', { maxLength: 80 });
  ensureString(current.value, 'profile.hero.current.value', { maxLength: 120 });
  ensureString(current.sub, 'profile.hero.current.sub', { maxLength: 180 });

  ensureArray(profile.education, 'profile.education', { min: 1, max: 20 }).forEach((entry, index) => {
    const fieldPath = `profile.education[${index}]`;
    ensureObject(entry, fieldPath);
    ensureAllowedKeys(entry, fieldPath, ['institution', 'credential', 'dates']);
    ensureString(entry.institution, `${fieldPath}.institution`, { maxLength: 160 });
    ensureString(entry.credential, `${fieldPath}.credential`, { maxLength: 180 });
    ensureString(entry.dates, `${fieldPath}.dates`, { maxLength: 80 });
  });

  const publication = ensureObject(profile.publication, 'profile.publication');
  ensureAllowedKeys(publication, 'profile.publication', ['title', 'venue', 'date', 'note', 'authors', 'links']);
  ensureString(publication.title, 'profile.publication.title', { maxLength: 260 });
  ensureString(publication.venue, 'profile.publication.venue', { maxLength: 120 });
  ensureString(publication.date, 'profile.publication.date', { maxLength: 80 });
  ensureOptionalString(publication.note, 'profile.publication.note', { maxLength: 220 });
  ensureString(publication.authors, 'profile.publication.authors', { maxLength: 260 });
  ensureArray(publication.links, 'profile.publication.links', { min: 1, max: 8 }).forEach((link, index) => {
    const fieldPath = `profile.publication.links[${index}]`;
    ensureObject(link, fieldPath);
    ensureAllowedKeys(link, fieldPath, ['label', 'url']);
    ensureString(link.label, `${fieldPath}.label`, { maxLength: 80 });
    sanitizeHref(link.url, `${fieldPath}.url`);
  });

  ensureArray(profile.articles, 'profile.articles', { max: 30 }).forEach((article, index) => {
    const fieldPath = `profile.articles[${index}]`;
    ensureObject(article, fieldPath);
    ensureAllowedKeys(article, fieldPath, ['title', 'published', 'summary', 'link', 'tags']);
    ensureString(article.title, `${fieldPath}.title`, { maxLength: 220 });
    ensureString(article.published, `${fieldPath}.published`, { maxLength: 80 });
    ensureString(article.summary, `${fieldPath}.summary`, { maxLength: 420 });
    const articleLink = ensureOptionalString(article.link, `${fieldPath}.link`, { maxLength: MAX_URL_LENGTH });
    if (articleLink) {
      sanitizeHref(articleLink, `${fieldPath}.link`);
    }
    ensureArray(article.tags || [], `${fieldPath}.tags`, { max: 12 }).forEach((tag, tagIndex) => {
      ensureString(tag, `${fieldPath}.tags[${tagIndex}]`, { maxLength: 60 });
    });
  });

  ensureArray(profile.honors, 'profile.honors', { max: 60 }).forEach((honor, index) => {
    const fieldPath = `profile.honors[${index}]`;
    ensureObject(honor, fieldPath);
    ensureAllowedKeys(honor, fieldPath, ['title', 'issuer', 'issued', 'description']);
    ensureString(honor.title, `${fieldPath}.title`, { maxLength: 180 });
    ensureString(honor.issuer, `${fieldPath}.issuer`, { maxLength: 180 });
    ensureString(honor.issued, `${fieldPath}.issued`, { maxLength: 80 });
    ensureOptionalString(honor.description, `${fieldPath}.description`, { maxLength: 260 });
  });

  ensureArray(profile.languages || [], 'profile.languages', { max: 20 }).forEach((item, index) => {
    validateLanguageEntry(item, `profile.languages[${index}]`);
  });

  ensureArray(profile.community || [], 'profile.community', { max: 20 }).forEach((entry, index) => {
    validateCommunityEntry(entry, `profile.community[${index}]`);
  });

  const contact = ensureObject(profile.contact, 'profile.contact');
  ensureAllowedKeys(contact, 'profile.contact', ['eyebrow', 'headline', 'lede', 'actions', 'meta']);
  ensureString(contact.eyebrow, 'profile.contact.eyebrow', { maxLength: 80 });
  ensureString(contact.headline, 'profile.contact.headline', { maxLength: 180 });
  ensureString(contact.lede, 'profile.contact.lede', { maxLength: 260 });
  ensureArray(contact.actions, 'profile.contact.actions', { min: 1, max: 5 }).forEach((action, index) => {
    validateAction(action, `profile.contact.actions[${index}]`);
  });
  ensureArray(contact.meta, 'profile.contact.meta', { max: 8 }).forEach((item, index) => {
    ensureString(item, `profile.contact.meta[${index}]`, { maxLength: 80 });
  });
}

function validateReadingData(items) {
  const list = ensureArray(items, 'reading', { min: 1, max: 2000 });
  const seen = new Map();
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
    ensureString(entry.author, `${fieldPath}.author`, { maxLength: 160 });
    ensureString(entry.isbn, `${fieldPath}.isbn`, { maxLength: 80 });

    const identityKeys = [
      `isbn:${String(entry.isbn).trim().toLowerCase()}`,
      `title-year:${String(entry.title).trim().toLowerCase()}|${year}`
    ];
    identityKeys.forEach((key) => {
      if (seen.has(key)) {
        failValidation(fieldPath, `duplicate reading record matches reading[${seen.get(key)}] by ${key}`);
      }
      seen.set(key, index);
    });

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

function validateReadingAssetInventory(items, { rootDir = projectRoot } = {}) {
  const missing = [];
  items.forEach((entry, index) => {
    if (entry.cover === undefined || String(entry.cover).trim() === '') {
      return;
    }

    const coverPath = sanitizeAssetPath(entry.cover, `reading[${index}].cover`);
    const absolutePath = path.join(rootDir, coverPath);
    if (!fs.existsSync(absolutePath)) {
      missing.push(`reading[${index}].cover: ${coverPath}`);
    }
  });

  if (missing.length > 0) {
    failValidation('reading', `missing declared cover asset(s): ${missing.join(', ')}`);
  }
}

function validateDataCollections(allData) {
  ensureObject(allData, 'data');
  validateProfileData(allData.profile);
  validateFeaturedData(allData.featured);
  validateSkillsData(allData.skills);
  validateExperienceData(allData.experience);
  validateCertificationData(allData.certifications);
  validateReadingData(allData.reading);
}

function linkShouldOpenInNewTab(href) {
  return hasUrlScheme(href) || href.endsWith('.pdf');
}

function renderActionLinks(actions, fieldPath, className = 'hero-actions') {
  const links = actions
    .map((action, index) => {
      const href = safeHref(action.href, `${fieldPath}[${index}].href`);
      const target = linkShouldOpenInNewTab(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
      const variant = action.variant === 'primary' ? 'btn-primary' : 'btn-ghost';
      return `<a class="btn ${variant}" href="${escapeHtml(href)}"${target}>${escapeHtml(action.label)}</a>`;
    })
    .join('');

  return `<div class="${escapeHtml(className)}">${links}</div>`;
}

function renderProfileSchema(profile, certifications) {
  const person = profile.person;
  const publicationUrl = profile.publication.links[0]?.url || person.url;
  const community = profile.community || [];
  const languages = profile.languages || [];
  const personNode = {
    '@type': 'Person',
    name: person.name,
    url: person.url,
    jobTitle: person.job_title,
    worksFor: { '@type': 'Organization', name: person.works_for },
    affiliation: { '@type': 'Organization', name: 'Public Service Commission Singapore' },
    alumniOf: profile.education.map((entry) => ({
      '@type': 'CollegeOrUniversity',
      name: entry.institution
    })),
    sameAs: person.same_as,
    knowsAbout: person.knows_about,
    award: profile.honors.map((honor) => honor.title),
    hasCredential: certifications.map((cert) => ({
      '@type': 'EducationalOccupationalCredential',
      name: cert.title,
      credentialCategory: 'certificate',
      recognizedBy: {
        '@type': 'Organization',
        name: cert.issuer
      }
    }))
  };

  if (community.length > 0) {
    personNode.memberOf = community.map((entry) => ({
      '@type': 'Organization',
      name: entry.organization
    }));
  }
  if (languages.length > 0) {
    personNode.knowsLanguage = languages.map((entry) => entry.name);
  }

  const graph = [
    personNode,
    {
      '@type': 'WebSite',
      name: 'Leonard Wong Portfolio',
      url: person.url,
      description: 'Hiring-focused portfolio of Leonard Wong, software engineer specializing in secure, data-driven platforms.',
      publisher: { '@type': 'Person', name: person.name }
    },
    {
      '@type': 'ScholarlyArticle',
      headline: profile.publication.title,
      datePublished: profile.publication.date,
      publisher: profile.publication.venue,
      url: publicationUrl,
      author: profile.publication.authors
        .split(/\s*&\s*|\s*,\s*/)
        .filter(Boolean)
        .map((name) => ({ '@type': 'Person', name }))
    },
    ...profile.articles.map((article) => ({
      '@type': 'Article',
      headline: article.title,
      datePublished: article.published,
      url: article.link,
      author: { '@type': 'Person', name: person.name },
      about: article.tags || []
    }))
  ];

  return escapeJsonLd({
    '@context': 'https://schema.org',
    '@graph': graph
  });
}

function renderHero(profile) {
  const hero = profile.hero;
  const webp220 = path.join(projectRoot, 'images/leo-220.webp');
  const webp440 = path.join(projectRoot, 'images/leo-440.webp');
  const hasWebp = fs.existsSync(webp220) && fs.existsSync(webp440);
  const pictureSource = hasWebp
    ? '<source type="image/webp" srcset="images/leo-220.webp 1x, images/leo-440.webp 2x" />'
    : '';
  const highlights = hero.highlights
    .map((item) => `
        <div class="highlight-card">
          <span class="highlight-label">${escapeHtml(item.label)}</span>
          <span class="highlight-value">${escapeHtml(item.value)}</span>
        </div>`)
    .join('');
  return `
<section class="hero-section section-block" id="home">
  <div class="hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">${escapeHtml(hero.eyebrow)}</p>
      <h1>${escapeHtml(hero.headline)}</h1>
      <p class="lead">${escapeHtml(hero.lead)}</p>
      ${renderActionLinks(hero.actions, 'profile.hero.actions')}
      <div class="hero-highlights">
        ${highlights}
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
        <p class="now-label">${escapeHtml(hero.current.label)}</p>
        <p class="now-value">${escapeHtml(hero.current.value)}</p>
        <p class="now-sub">${escapeHtml(hero.current.sub)}</p>
      </div>
    </div>
  </div>
</section>`;
}

function renderProfileCredentials(profile) {
  const educationItems = profile.education
    .map((entry) => `<li>${escapeHtml(entry.institution)} — ${escapeHtml(entry.credential)}, ${escapeHtml(entry.dates)}</li>`)
    .join('');
  const publicationLinks = profile.publication.links
    .map((link, index) => {
      const href = safeHref(link.url, `profile.publication.links[${index}].url`);
      return `<a class="badge rounded-pill bg-dark shadow" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}&nbsp;<svg class="icon icon-arrow" aria-hidden="true" focusable="false"><use href="#icon-arrow-up-right-square"/></svg></a>`;
    })
    .join('');
  const note = profile.publication.note ? `<p class="text-muted">${escapeHtml(profile.publication.venue)} · ${escapeHtml(profile.publication.note)}</p>` : `<p class="text-muted">${escapeHtml(profile.publication.venue)}</p>`;

  return `
        <div class="credentials-grid">
            <div class="card p-4">
                <h3>Education</h3>
                <ul class="experience-list">
                    ${educationItems}
                </ul>
            </div>
            <div class="card p-4">
                <h3>Publication</h3>
                <p><strong>${escapeHtml(profile.publication.title)}</strong></p>
                ${note}
                <p>${escapeHtml(profile.publication.authors)}</p>
                <div class="credential-link-row">${publicationLinks}</div>
            </div>
        </div>`;
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
      const link = cert.link ? escapeHtml(safeHref(cert.link, `certifications[${certIndex}].link`)) : '';
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
      const linkMarkup = link
        ? `<a class="badge rounded-pill bg-dark shadow" href="${link}" target="_blank" rel="noopener noreferrer">View Certification&nbsp;<svg class="icon icon-arrow" aria-hidden="true" focusable="false"><use href="#icon-arrow-up-right-square"/></svg></a>`
        : '<span class="badge rounded-pill bg-secondary shadow-sm">Credential link pending</span>';

      return `
      <article class="card p-3">
        <h3 class="card-title">${iconMarkup ? `${iconMarkup}&nbsp;` : ''}${title}</h3>
        <p>${issuer}</p>
        <p class="card-text fw-light">${meta}</p>
        ${linkMarkup}
      </article>`;
    })
    .join('');

  return `
<div class="certifications-grid">
  ${cards}
</div>`;
}

function renderWriting(profile) {
  if (!profile.articles.length) {
    return '';
  }

  const cards = profile.articles
    .map((article, index) => {
      const tags = article.tags || [];
      const href = article.link ? safeHref(article.link, `profile.articles[${index}].link`) : '';
      const tagChips = tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('');
      const linkMarkup = href
        ? `<div class="featured-links">
          <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Read Article&nbsp;<svg class="icon icon-arrow" aria-hidden="true" focusable="false"><use href="#icon-arrow-up-right-square"/></svg></a>
        </div>`
        : '';

      return `
      <article class="featured-card article-card" data-tags="${escapeHtml(tags.join(','))}">
        <header>
          <p class="featured-kicker">${escapeHtml(article.published)}</p>
          <h3>${escapeHtml(article.title)}</h3>
        </header>
        <p>${escapeHtml(article.summary)}</p>
        ${tagChips ? `<div class="chip-row">${tagChips}</div>` : ''}
        ${linkMarkup}
      </article>`;
    })
    .join('');

  return `
<section class="section-block" id="writing">
  <div class="section-header">
    <p class="eyebrow">Writing</p>
    <h2>Articles and public analysis</h2>
    <p class="section-lede">Selected writing on security, privacy, and business topics.</p>
  </div>
  <div class="featured-grid writing-grid">
    ${cards}
  </div>
</section>`;
}

function renderHonors(profile) {
  if (!profile.honors.length) {
    return '';
  }

  const cards = profile.honors
    .map((honor) => {
      const description = honor.description
        ? `<p class="honor-description">${escapeHtml(honor.description)}</p>`
        : '';

      return `
      <article class="card p-3 honor-card">
        <p class="featured-kicker">${escapeHtml(honor.issued)}</p>
        <h3>${escapeHtml(honor.title)}</h3>
        <p>${escapeHtml(honor.issuer)}</p>
        ${description}
      </article>`;
    })
    .join('');

  return `
<section class="section-block" id="honors">
  <div class="section-header">
    <p class="eyebrow">Honors &amp; Awards</p>
    <h2>Recognition across study and industry</h2>
    <p class="section-lede">Scholarships, internship recognition, and academic excellence awards.</p>
  </div>
  <div class="honors-grid">
    ${cards}
  </div>
</section>`;
}

function renderCommunity(profile) {
  const community = profile.community || [];
  const languages = profile.languages || [];
  if (!community.length && !languages.length) {
    return '';
  }

  const communityCards = community
    .map((entry) => {
      const id = escapeHtml(entry.id);
      const organization = escapeHtml(entry.organization);
      const logo = safeAssetPath(entry.logo, `profile.community.${entry.id}.logo`);
      const logo2x = logo.replace('-30.', '-60.');
      const hasLogo2x = logo2x !== logo && fs.existsSync(path.join(projectRoot, logo2x));
      const logoSrcset = hasLogo2x ? `${escapeHtml(logo)} 1x, ${escapeHtml(logo2x)} 2x` : `${escapeHtml(logo)} 1x`;
      const roles = entry.roles
        .map((role) => `<li>${escapeHtml(role.dates)} · ${escapeHtml(role.title)}</li>`)
        .join('');
      const responsibilities = entry.responsibilities
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('');

      return `
            <div class="accordion-item">
                <h2 class="accordion-header" id="heading${id}">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse"
                            data-bs-target="#collapse${id}" aria-expanded="false" aria-controls="collapse${id}">
                        <img decoding="async" src="${escapeHtml(logo)}" alt="${escapeHtml(entry.logo_alt)}" loading="lazy" class="circle-img" width="30" height="30" srcset="${logoSrcset}" sizes="30px"/>&nbsp;<strong>${organization}</strong>
                    </button>
                </h2>
                <div id="collapse${id}" class="accordion-collapse collapse" aria-labelledby="heading${id}"
                     data-bs-parent="#accordionList">
                    <div class="accordion-body">
                        <h3>Roles</h3>
                        <ul class="experience-list">${roles}</ul>
                        <h3>Responsibilities</h3>
                        <ul class="experience-list">${responsibilities}</ul>
                    </div>
                </div>
            </div>`;
    })
    .join('');

  const languageCards = languages.length
    ? `
        <div class="skills-grid community-languages">
          ${languages.map((item) => `
          <div class="skill-card">
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(item.proficiency)}</p>
          </div>`).join('')}
        </div>`
    : '';

  return `
    <section class="section-block" id="community">
        <div class="section-header">
            <p class="eyebrow">Community</p>
            <h2>Leadership and mentorship</h2>
        </div>
        ${communityCards ? `<div class="accordion accordion-flush" id="accordionList">${communityCards}</div>` : ''}
        ${languageCards}
    </section>`;
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
  const MAX_HIGH_DPI_IMAGE_BYTES = 250 * 1024;

  function shouldUseAsHighDpi(relativePath) {
    if (!relativePath) {
      return false;
    }

    try {
      const absolutePath = path.join(projectRoot, relativePath);
      return fs.existsSync(absolutePath) && fs.statSync(absolutePath).size <= MAX_HIGH_DPI_IMAGE_BYTES;
    } catch (error) {
      return false;
    }
  }

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
    if (cover2xPath === coverPath || !shouldUseAsHighDpi(cover2xPath)) {
      cover2xPath = coverPath;
    }

    const hasCover = coverPath && fs.existsSync(path.join(projectRoot, coverPath));
    const safeCover2x = cover2xPath && fs.existsSync(path.join(projectRoot, cover2xPath)) ? cover2xPath : coverPath;
    const cover = escapeHtml(coverPath);
    const cover2x = escapeHtml(safeCover2x);

    if (!hasCover) {
      missingCovers.add(coverPath || `${entry.title} (${entry.year})`);
    }

    let media = '';
    if (hasCover) {
      const webp1xPath = coverPath.replace('.jpg', '.webp').replace('.jpeg', '.webp');
      const webp2xCandidatePath = safeCover2x.replace('.jpg', '.webp').replace('.jpeg', '.webp');
      const hasWebp1x = fs.existsSync(path.join(projectRoot, webp1xPath));
      const useWebp2x = webp2xCandidatePath !== webp1xPath && shouldUseAsHighDpi(webp2xCandidatePath);
      const webp2xPath = useWebp2x ? webp2xCandidatePath : webp1xPath;
      const hasWebp = hasWebp1x && fs.existsSync(path.join(projectRoot, webp2xPath));
      const webp1x = escapeHtml(webp1xPath);
      const webp2x = escapeHtml(webp2xPath);
      const webpSrcset = webp2xPath === webp1xPath ? `${webp1x} 1x` : `${webp1x} 1x, ${webp2x} 2x`;
      const imageSrcset = safeCover2x === coverPath ? `${cover} 1x` : `${cover} 1x, ${cover2x} 2x`;
      const webpSource = hasWebp
        ? `<source type="image/webp" srcset="${webpSrcset}" />`
        : '';

      const image = `
      <picture>
        ${webpSource}
        <img decoding="async" src="${cover}" class="book-cover" srcset="${imageSrcset}" sizes="(min-width: 992px) 16vw, 44vw" alt="Cover of ${title}" loading="lazy" />
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
    <div class="reading-share">
      <button type="button" class="btn btn-ghost" data-reading-share>Share this view</button>
      <p class="reading-share-status" data-reading-share-status role="status" aria-live="polite"></p>
    </div>
  </div>

  <div class="reading-grid" data-reading-grid data-view="grid">
    ${items}
  </div>
  <p class="reading-empty" data-reading-empty hidden>No matches yet. Try clearing filters.</p>
</section>`;
}

function renderContact(profile) {
  const contact = profile.contact;
  const meta = contact.meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('');

  return `
<section class="section-block" id="contact">
  <div class="contact-card">
    <div>
      <p class="eyebrow">${escapeHtml(contact.eyebrow)}</p>
      <h2>${escapeHtml(contact.headline)}</h2>
      <p class="section-lede">${escapeHtml(contact.lede)}</p>
    </div>
    ${renderActionLinks(contact.actions, 'profile.contact.actions', 'contact-actions')}
    <div class="contact-meta">
      ${meta}
    </div>
  </div>
</section>`;
}

function buildSite() {
  const data = {
    profile: readJson('profile.json'),
    featured: readJson('featured-projects.json'),
    skills: readJson('skills.json'),
    experience: readJson('experience.json'),
    certifications: readJson('certifications.json'),
    reading: readJson('reading.json')
  };

  validateDataCollections(data);
  validateReadingAssetInventory(data.reading);

  const tokens = {
    ...partials,
    PROFILE_SCHEMA: renderProfileSchema(data.profile, data.certifications),
    HERO: renderHero(data.profile),
    FEATURED_WORK: renderFeaturedWork(data.featured),
    SKILLS: renderSkills(data.skills),
    EXPERIENCE: renderExperience(data.experience),
    WRITING: renderWriting(data.profile),
    PROFILE_CREDENTIALS: renderProfileCredentials(data.profile),
    CERTIFICATIONS: renderCertifications(data.certifications),
    HONORS: renderHonors(data.profile),
    COMMUNITY: renderCommunity(data.profile),
    READING_GRID: renderReadingGrid(data.reading),
    CONTACT: renderContact(data.profile)
  };

  const pages = ['index.html', 'reading.html', 'offline.html'];
  const renderedPages = new Map();

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

    const leftover = content.match(/\{\{[A-Z_]+}}/g)?.filter((token) => token !== CSP_INLINE_SCRIPT_HASH_TOKEN);
    if (leftover && leftover.length > 0) {
      throw new Error(`Unresolved tokens in ${page}: ${leftover.join(', ')}`);
    }

    renderedPages.set(page, stripTrailingWhitespace(content));
  });

  const indexPage = renderedPages.get('index.html');
  if (!indexPage) {
    throw new Error('Missing rendered index page content');
  }

  renderedPages.forEach((content, page) => {
    const finalContent = page === 'index.html'
      ? injectCspScriptHashes(content, content)
      : content;
    fs.writeFileSync(path.join(projectRoot, page), finalContent);
  });

  if (!fs.existsSync(headersTemplatePath)) {
    throw new Error(`Missing headers template: ${headersTemplatePath}`);
  }

  const headersTemplate = fs.readFileSync(headersTemplatePath, 'utf8');
  const headersContent = injectCspScriptHashes(headersTemplate, indexPage);
  fs.writeFileSync(path.join(projectRoot, '_headers'), headersContent);

  console.log('Build complete: generated', pages.join(', '));
}

if (require.main === module) {
  buildSite();
}

module.exports = {
  buildSite,
  collectInlineScriptHashes,
  hashInlineScript,
  injectCspScriptHashes,
  renderCspScriptHashesDirective,
  renderProfileSchema,
  sanitizeHref,
  sanitizeAssetPath,
  sanitizeRelativeLink,
  validateDataCollections,
  validateReadingAssetInventory,
  validateProfileData
};
