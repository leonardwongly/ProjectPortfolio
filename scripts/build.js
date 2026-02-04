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

function renderImpactStrip(items) {
  const cards = items
    .map((item, index) => {
      const value = Number.isFinite(item.value) ? item.value : escapeHtml(item.value);
      const unit = item.unit ? escapeHtml(item.unit) : '';
      const countupAttr = Number.isFinite(item.value) ? `data-countup="${item.value}" data-countup-unit="${unit}"` : '';
      return `
      <div class="impact-card" data-animate-order="${index}">
        <span class="impact-value" ${countupAttr}>${value}${unit}</span>
        <span class="impact-label">${escapeHtml(item.label)}</span>
      </div>`;
    })
    .join('');

  return `
<section class="impact-strip" aria-label="Impact at a glance">
  <div class="impact-inner">
    <p class="eyebrow">Impact at a glance</p>
    <div class="impact-grid">
      ${cards}
    </div>
  </div>
</section>`;
}

function renderFeaturedWork(items) {
  const cards = items
    .map((project) => {
      const tech = project.tech || [];
      const techChips = tech
        .map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`)
        .join('');
      const links = (project.links || [])
        .map((link) => {
          const label = escapeHtml(link.label || 'Link');
          const url = escapeHtml(link.url || '#');
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
    .map((cert) => {
      const title = escapeHtml(cert.title);
      const issuer = escapeHtml(cert.issuer);
      const issued = escapeHtml(cert.issued);
      const credentialId = cert.credential_id ? escapeHtml(cert.credential_id) : '';
      const link = escapeHtml(cert.link);
      const iconPath = cert.icon ? String(cert.icon) : '';
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
  const items = reading.map((entry) => {
    const tags = (entry.tags && entry.tags.length ? entry.tags : inferTags(entry)) || [];
    const tagAttr = tags.map((tag) => tag.toLowerCase()).join(',');
    const year = escapeHtml(entry.year);
    const title = escapeHtml(entry.title);
    const author = escapeHtml(entry.author);
    const isbn = escapeHtml(entry.isbn);
    const link = entry.link ? escapeHtml(entry.link) : '';

    const coverPath = entry.cover ? String(entry.cover) : '';
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

const data = {
  impact: readJson('impact.json'),
  featured: readJson('featured-projects.json'),
  skills: readJson('skills.json'),
  experience: readJson('experience.json'),
  certifications: readJson('certifications.json'),
  reading: readJson('reading.json')
};

const tokens = {
  ...partials,
  HERO: renderHero(),
  IMPACT_STRIP: renderImpactStrip(data.impact),
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
