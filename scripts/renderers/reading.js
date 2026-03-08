const fs = require('fs');
const path = require('path');
const { escapeHtml, safeHref, safeAssetPath } = require('./utils');

/**
 * Infers tags for a book entry based on title keywords.
 *
 * @param {Object} entry - Reading entry object
 * @returns {Array<string>} Array of inferred tags
 */
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

/**
 * Determines if an image file is small enough to use as high-DPI variant.
 *
 * @param {string} relativePath - Relative path to image file
 * @param {string} projectRoot - Absolute path to project root
 * @returns {boolean} True if file exists and is under 250KB
 */
function shouldUseAsHighDpi(relativePath, projectRoot) {
  const MAX_HIGH_DPI_IMAGE_BYTES = 250 * 1024;

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

/**
 * Renders the reading grid with book cards, filters, and search.
 *
 * @param {Array} reading - Array of reading entry objects
 * @param {string} projectRoot - Absolute path to project root directory
 * @param {Function} sanitizeHref - Sanitization function from build.js
 * @param {Function} sanitizeAssetPath - Sanitization function from build.js
 * @returns {string} HTML markup for reading section
 */
function renderReadingGrid(reading, projectRoot, sanitizeHref, sanitizeAssetPath) {
  const missingCovers = new Set();
  const items = reading.map((entry, entryIndex) => {
    const tags = (entry.tags && entry.tags.length ? entry.tags : inferTags(entry)) || [];
    const tagAttr = tags.map((tag) => tag.toLowerCase()).join(',');
    const year = escapeHtml(entry.year);
    const title = escapeHtml(entry.title);
    const author = escapeHtml(entry.author);
    const isbn = escapeHtml(entry.isbn);
    const link = entry.link ? escapeHtml(safeHref(entry.link, `reading[${entryIndex}].link`, {}, sanitizeHref)) : '';

    const coverPath = entry.cover ? safeAssetPath(String(entry.cover), `reading[${entryIndex}].cover`, sanitizeAssetPath) : '';
    let cover2xPath = coverPath.replace('-300.jpg', '.jpg').replace('-300.jpeg', '.jpeg');
    if (cover2xPath === coverPath || !shouldUseAsHighDpi(cover2xPath, projectRoot)) {
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
      const useWebp2x = webp2xCandidatePath !== webp1xPath && shouldUseAsHighDpi(webp2xCandidatePath, projectRoot);
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

module.exports = { renderReadingGrid, inferTags, shouldUseAsHighDpi };
