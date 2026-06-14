#!/usr/bin/env node
/**
 * Builds a print-optimized resume from structured data and exports a PDF.
 *
 * Sources:
 *   - data/resume.json        (resume-only: title, contact, summary, AI highlights, order)
 *   - data/profile.json       (education, publication — shared with the website)
 *   - data/experience.json    (work history — shared with the website)
 *   - data/skills.json        (skills, AI-first — shared with the website)
 *   - data/certifications.json(credentials — shared with the website)
 *
 * Output:
 *   - artifacts/resume.html       (intermediate, gitignored — handy for inspection)
 *   - docs/resume.pdf             (committed asset linked from the site)
 *   - docs/resume.manifest.json   (committed freshness manifest; hash of the rendered HTML)
 *
 * PDF rendering reuses the Playwright Chromium that the integration tests
 * already install, so no extra dependency is introduced. The generated PDF
 * keeps selectable, ATS-readable text (Chromium does not rasterize it).
 *
 * Usage:
 *   node scripts/build-resume.mjs              # HTML + PDF
 *   node scripts/build-resume.mjs --html-only  # HTML only (no browser needed)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(projectRoot, 'artifacts');
const htmlOutPath = path.join(artifactsDir, 'resume.html');
const pdfOutPath = path.join(projectRoot, 'docs', 'resume.pdf');
const manifestOutPath = path.join(projectRoot, 'docs', 'resume.manifest.json');

const RESUME_SOURCE_FILES = ['resume.json', 'profile.json', 'experience.json', 'skills.json', 'certifications.json'];

const AI_PATTERN = /\b(AI|LLM|agent|agentic|responsible|explainable|cybersecurity|machine learning)\b/i;

function readJson(name, { rootDir = projectRoot } = {}) {
  const file = path.join(rootDir, 'data', name);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing data file: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadResumeData({ rootDir = projectRoot } = {}) {
  return {
    resume: readJson('resume.json', { rootDir }),
    profile: readJson('profile.json', { rootDir }),
    experience: readJson('experience.json', { rootDir }),
    skills: readJson('skills.json', { rootDir }),
    certifications: readJson('certifications.json', { rootDir })
  };
}

// --- Validation: fail fast on a malformed resume.json --------------------
// The shared data files (profile/experience/skills/certifications) are already
// validated by scripts/build.js during `npm run build`; here we only validate
// the resume-only file that build.js does not know about.

const RESUME_TEXT_MAX = 1000;
const SECTION_KEYS = ['summary', 'ai_highlights', 'skills', 'experience', 'education', 'publication', 'certifications'];

function fail(field, reason) {
  throw new Error(`Invalid data at ${field}: ${reason}`);
}

function assertObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, 'expected an object');
  return value;
}

function assertAllowedKeys(value, field, allowed) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail(field, `unexpected key(s): ${extras.join(', ')}`);
}

function assertString(value, field, { required = true, max = RESUME_TEXT_MAX } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(field, 'expected a string');
    return '';
  }
  if (typeof value !== 'string') fail(field, 'expected a string');
  const trimmed = value.trim();
  if (required && trimmed.length === 0) fail(field, 'expected a non-empty string');
  if (trimmed.length > max) fail(field, `string exceeds max length ${max}`);
  return trimmed;
}

function assertArray(value, field, { min = 0, max = 100 } = {}) {
  if (!Array.isArray(value)) fail(field, 'expected an array');
  if (value.length < min) fail(field, `expected at least ${min} item(s)`);
  if (value.length > max) fail(field, `expected at most ${max} item(s)`);
  return value;
}

function assertHttpsUrl(value, field) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    fail(field, 'malformed URL');
  }
  if (url.protocol !== 'https:') fail(field, 'only https URLs are allowed');
  if (url.username || url.password) fail(field, 'credentials in URL are not allowed');
  return url.toString();
}

function validateResumeData(resume) {
  assertObject(resume, 'resume');
  assertAllowedKeys(resume, 'resume', ['name', 'title', 'location', 'contact', 'summary', 'ai_highlights', 'section_order']);
  assertString(resume.name, 'resume.name', { max: 120 });
  assertString(resume.title, 'resume.title', { max: 200 });
  assertString(resume.location, 'resume.location', { required: false, max: 120 });
  assertString(resume.summary, 'resume.summary', { required: false, max: RESUME_TEXT_MAX });

  if (resume.contact !== undefined) {
    const contact = assertObject(resume.contact, 'resume.contact');
    assertAllowedKeys(contact, 'resume.contact', ['email', 'phone', 'links']);
    assertString(contact.email, 'resume.contact.email', { required: false, max: 160 });
    assertString(contact.phone, 'resume.contact.phone', { required: false, max: 40 });
    if (contact.links !== undefined) {
      assertArray(contact.links, 'resume.contact.links', { max: 10 }).forEach((link, i) => {
        const fieldPath = `resume.contact.links[${i}]`;
        assertObject(link, fieldPath);
        assertAllowedKeys(link, fieldPath, ['label', 'url']);
        assertString(link.label, `${fieldPath}.label`, { max: 80 });
        assertHttpsUrl(link.url, `${fieldPath}.url`);
      });
    }
  }

  if (resume.ai_highlights !== undefined) {
    const block = assertObject(resume.ai_highlights, 'resume.ai_highlights');
    assertAllowedKeys(block, 'resume.ai_highlights', ['heading', 'items']);
    assertString(block.heading, 'resume.ai_highlights.heading', { required: false, max: 120 });
    assertArray(block.items, 'resume.ai_highlights.items', { min: 1, max: 12 }).forEach((item, i) => {
      assertString(item, `resume.ai_highlights.items[${i}]`, { max: 400 });
    });
  }

  if (resume.section_order !== undefined) {
    assertArray(resume.section_order, 'resume.section_order', { min: 1, max: 12 }).forEach((key, i) => {
      const value = assertString(key, `resume.section_order[${i}]`, { max: 40 });
      if (!SECTION_KEYS.includes(value)) {
        fail(`resume.section_order[${i}]`, `unknown section "${value}" (allowed: ${SECTION_KEYS.join(', ')})`);
      }
    });
  }

  return resume;
}

/** Stable hash of the deterministic rendered HTML (NOT the non-deterministic PDF bytes). */
function computeResumeHtmlHash(html) {
  return `sha256-${crypto.createHash('sha256').update(html, 'utf8').digest('hex')}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Allow only https links in the rendered resume; drop anything else. */
function safeHttpsHref(rawValue) {
  try {
    const url = new URL(String(rawValue));
    if (url.protocol === 'https:' && !url.username && !url.password) {
      return url.toString();
    }
  } catch {
    /* fall through */
  }
  return '';
}

function stripIssuedPrefix(value) {
  return String(value ?? '')
    .replace(/^Issued\s+/i, '')
    .replace(/\s*-\s*No Expiration Date\s*$/i, '')
    .trim();
}

function highlightAiText(text) {
  // Escape first, then wrap AI/agentic keywords in <strong> so they stand out.
  const escaped = escapeHtml(text);
  return escaped.replace(
    /(Agentic|Agent workflows?|Agents?|AI|LLM|RAG|Responsible &amp; Explainable AI|Responsible AI|Explainable AI|Cybersecurity)/g,
    '<strong class="kw">$1</strong>'
  );
}

function renderContact(resume) {
  const parts = [];
  const email = String(resume.contact?.email ?? '').trim();
  if (email) {
    parts.push(`<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`);
  }
  const phone = String(resume.contact?.phone ?? '').trim();
  if (phone) {
    parts.push(`<span>${escapeHtml(phone)}</span>`);
  }
  (resume.contact?.links ?? []).forEach((link) => {
    const href = safeHttpsHref(link.url);
    const label = escapeHtml(link.label || link.url);
    if (href) {
      parts.push(`<a href="${escapeHtml(href)}">${label}</a>`);
    }
  });
  return parts.join('<span class="sep" aria-hidden="true">·</span>');
}

function renderSummary(resume) {
  if (!resume.summary) return '';
  return `
  <section class="block">
    <p class="summary">${highlightAiText(resume.summary)}</p>
  </section>`;
}

function renderAiHighlights(resume) {
  const block = resume.ai_highlights;
  if (!block || !Array.isArray(block.items) || block.items.length === 0) return '';
  const items = block.items
    .map((item) => `<li>${highlightAiText(item)}</li>`)
    .join('');
  return `
  <section class="block ai-callout" aria-label="${escapeHtml(block.heading || 'AI & Agentic')}">
    <h2 class="ai-callout__head">${escapeHtml(block.heading || 'AI &amp; Agentic Highlights')}</h2>
    <ul class="ai-callout__list">${items}</ul>
  </section>`;
}

function renderSkills(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return '';
  const rows = skills
    .map((group) => {
      const isAi = AI_PATTERN.test(group.category);
      const items = (group.items || []).map((item) => escapeHtml(item)).join(' · ');
      return `
      <div class="skill-row${isAi ? ' skill-row--ai' : ''}">
        <span class="skill-row__cat">${escapeHtml(group.category)}</span>
        <span class="skill-row__items">${items}</span>
      </div>`;
    })
    .join('');
  return `
  <section class="block">
    <h2 class="block__head">Skills</h2>
    <div class="skills">${rows}</div>
  </section>`;
}

function renderExperience(experience) {
  if (!Array.isArray(experience) || experience.length === 0) return '';
  const entries = experience
    .map((role) => {
      const bullets = (role.impact_bullets || [])
        .map((item) => `<li>${highlightAiText(item)}</li>`)
        .join('');
      const tech = (role.tech || []).map((item) => escapeHtml(item)).join(' · ');
      return `
      <article class="role">
        <div class="role__head">
          <span class="role__org">${escapeHtml(role.org)}</span>
          <span class="role__dates">${escapeHtml(role.dates)}</span>
        </div>
        <p class="role__title">${escapeHtml(role.role)}</p>
        <ul class="role__bullets">${bullets}</ul>
        ${tech ? `<p class="role__tech"><span>Tech:</span> ${tech}</p>` : ''}
      </article>`;
    })
    .join('');
  return `
  <section class="block">
    <h2 class="block__head">Experience</h2>
    ${entries}
  </section>`;
}

function renderEducation(profile) {
  const education = profile.education || [];
  if (education.length === 0) return '';
  const rows = education
    .map(
      (entry) => `
      <div class="edu-row">
        <span class="edu-row__inst">${escapeHtml(entry.institution)}</span>
        <span class="edu-row__cred">${escapeHtml(entry.credential)}</span>
        <span class="edu-row__dates">${escapeHtml(entry.dates)}</span>
      </div>`
    )
    .join('');
  return `
  <section class="block">
    <h2 class="block__head">Education</h2>
    <div class="edu">${rows}</div>
  </section>`;
}

function renderPublication(profile) {
  const pub = profile.publication;
  if (!pub || !pub.title) return '';
  const meta = [pub.venue, pub.date].filter(Boolean).map((value) => escapeHtml(value)).join(' · ');
  return `
  <section class="block">
    <h2 class="block__head">Publication</h2>
    <p class="pub__title">${escapeHtml(pub.title)}</p>
    ${meta ? `<p class="pub__meta">${meta}</p>` : ''}
    ${pub.authors ? `<p class="pub__authors">${escapeHtml(pub.authors)}</p>` : ''}
  </section>`;
}

function renderCertifications(certifications) {
  if (!Array.isArray(certifications) || certifications.length === 0) return '';
  // AI / responsible-AI credentials first, preserving original order within each group.
  const ai = [];
  const rest = [];
  certifications.forEach((cert) => {
    (AI_PATTERN.test(cert.title) ? ai : rest).push(cert);
  });
  const ordered = [...ai, ...rest];
  const items = ordered
    .map((cert) => {
      const isAi = AI_PATTERN.test(cert.title);
      const date = escapeHtml(stripIssuedPrefix(cert.issued));
      return `
      <li class="cert${isAi ? ' cert--ai' : ''}">
        <span class="cert__name">${escapeHtml(cert.title)}</span>
        <span class="cert__meta">${escapeHtml(cert.issuer)}${date ? ` · ${date}` : ''}</span>
      </li>`;
    })
    .join('');
  return `
  <section class="block">
    <h2 class="block__head">Certifications</h2>
    <ul class="certs">${items}</ul>
  </section>`;
}

const SECTION_RENDERERS = {
  summary: (data) => renderSummary(data.resume),
  ai_highlights: (data) => renderAiHighlights(data.resume),
  skills: (data) => renderSkills(data.skills),
  experience: (data) => renderExperience(data.experience),
  education: (data) => renderEducation(data.profile),
  publication: (data) => renderPublication(data.profile),
  certifications: (data) => renderCertifications(data.certifications)
};

function renderResumeHtml(data) {
  const { resume } = data;
  const order = Array.isArray(resume.section_order) && resume.section_order.length
    ? resume.section_order
    : Object.keys(SECTION_RENDERERS);
  const body = order
    .map((key) => (SECTION_RENDERERS[key] ? SECTION_RENDERERS[key](data) : ''))
    .filter(Boolean)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(resume.name)} — Resume</title>
<style>
  :root {
    --accent: #4338ca;
    --accent-soft: #eef0ff;
    --ink: #1f2430;
    --muted: #5b6472;
    --rule: #d7dbe3;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    font-size: 10.4pt;
    line-height: 1.42;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  a { color: var(--accent); text-decoration: none; }
  strong.kw { color: var(--accent); font-weight: 700; }

  header.resume-head { border-bottom: 2px solid var(--accent); padding-bottom: 8px; margin-bottom: 12px; }
  .name { font-size: 23pt; font-weight: 800; letter-spacing: -0.01em; margin: 0; }
  .title { font-size: 11pt; font-weight: 700; color: var(--accent); margin: 3px 0 6px; }
  .contact { font-size: 9pt; color: var(--muted); margin: 0; }
  .contact .sep { margin: 0 6px; color: var(--rule); }

  section.block { margin: 0 0 11px; }
  .block__head {
    font-size: 9.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--accent); margin: 0 0 6px; padding-bottom: 2px; border-bottom: 1px solid var(--rule);
  }
  .summary { margin: 0; font-size: 10.6pt; }

  /* AI & Agentic callout — the visual focal point of the resume */
  .ai-callout {
    background: var(--accent-soft);
    border: 1px solid #c8ccf7;
    border-left: 4px solid var(--accent);
    border-radius: 6px;
    padding: 9px 12px 10px;
  }
  .ai-callout__head {
    font-size: 10.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--accent); margin: 0 0 5px;
  }
  .ai-callout__list { margin: 0; padding-left: 16px; }
  .ai-callout__list li { margin: 2px 0; }

  .skills { display: grid; gap: 3px; }
  .skill-row { display: grid; grid-template-columns: 130px 1fr; gap: 10px; align-items: baseline; }
  .skill-row__cat { font-weight: 700; color: var(--ink); }
  .skill-row__items { color: var(--muted); }
  .skill-row--ai .skill-row__cat { color: var(--accent); }
  .skill-row--ai .skill-row__items { color: var(--ink); }

  .role { margin: 0 0 8px; }
  .role__head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .role__org { font-weight: 700; font-size: 10.8pt; }
  .role__dates { color: var(--muted); font-size: 9pt; white-space: nowrap; }
  .role__title { margin: 1px 0 3px; color: var(--muted); font-style: italic; font-size: 9.6pt; }
  .role__bullets { margin: 0; padding-left: 16px; }
  .role__bullets li { margin: 1.5px 0; }
  .role__tech { margin: 3px 0 0; font-size: 8.8pt; color: var(--muted); }
  .role__tech span { font-weight: 700; }

  .edu { display: grid; gap: 4px; }
  .edu-row { display: grid; grid-template-columns: 1fr auto; row-gap: 0; column-gap: 10px; }
  .edu-row__inst { font-weight: 700; }
  .edu-row__cred { grid-column: 1 / 2; color: var(--muted); }
  .edu-row__dates { grid-column: 2 / 3; grid-row: 1 / 2; color: var(--muted); font-size: 9pt; white-space: nowrap; }

  .pub__title { margin: 0; font-weight: 600; }
  .pub__meta, .pub__authors { margin: 1px 0 0; color: var(--muted); font-size: 9pt; }

  .certs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 18px; }
  .cert { display: flex; flex-direction: column; }
  .cert__name { font-weight: 600; font-size: 9.4pt; }
  .cert--ai .cert__name { color: var(--accent); }
  .cert__meta { color: var(--muted); font-size: 8.5pt; }

  @media print { body { font-size: 10.2pt; } a { color: var(--accent); } }
</style>
</head>
<body>
  <header class="resume-head">
    <h1 class="name">${escapeHtml(resume.name)}</h1>
    <p class="title">${escapeHtml(resume.title)}</p>
    <p class="contact">${renderContact(resume)}</p>
  </header>
  ${body}
</body>
</html>`;
}

async function exportPdf(html) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    try {
      ({ chromium } = await import('@playwright/test'));
    } catch (error) {
      throw new Error(
        'Playwright is not available. Install it with `npm install` (and `npx playwright install chromium`).'
      );
    }
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(
      `Could not launch Chromium for PDF export. Run \`npx playwright install chromium\`.\nOriginal error: ${error.message}`
    );
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: pdfOutPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '13mm', bottom: '13mm', left: '14mm', right: '14mm' }
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  const htmlOnly = process.argv.includes('--html-only');

  const data = loadResumeData();
  validateResumeData(data.resume);

  const html = renderResumeHtml(data);

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(htmlOutPath, html);
  console.log(`Resume HTML written: ${path.relative(projectRoot, htmlOutPath)}`);

  if (htmlOnly) {
    console.log('Skipping PDF export and manifest update (--html-only).');
    return;
  }

  fs.mkdirSync(path.dirname(pdfOutPath), { recursive: true });
  await exportPdf(html);
  const { size } = fs.statSync(pdfOutPath);
  console.log(`Resume PDF written: ${path.relative(projectRoot, pdfOutPath)} (${(size / 1024).toFixed(1)} KiB)`);

  const manifest = {
    $generatedBy: 'scripts/build-resume.mjs',
    description: 'Freshness manifest for docs/resume.pdf. htmlSha256 is the hash of the deterministic rendered resume HTML. Run `npm run build:resume` after editing the sources below, then commit docs/resume.pdf and this manifest.',
    htmlSha256: computeResumeHtmlHash(html),
    sources: RESUME_SOURCE_FILES.map((name) => `data/${name}`)
  };
  fs.writeFileSync(manifestOutPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Resume manifest written: ${path.relative(projectRoot, manifestOutPath)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

export {
  renderResumeHtml,
  escapeHtml,
  safeHttpsHref,
  loadResumeData,
  validateResumeData,
  computeResumeHtmlHash,
  RESUME_SOURCE_FILES
};
