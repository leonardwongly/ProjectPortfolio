#!/usr/bin/env node
/**
 * Builds a print-optimized resume from structured data and exports PDF/DOCX artifacts.
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
 *   - docs/resume.docx            (committed editable resume artifact)
 *   - docs/resume.manifest.json   (committed freshness manifest; hash of the rendered HTML)
 *
 * PDF rendering reuses the Playwright Chromium that the integration tests
 * already install, so no extra dependency is introduced. The generated PDF
 * keeps selectable, ATS-readable text (Chromium does not rasterize it).
 * DOCX rendering uses Pandoc so the editable artifact stays derived from the
 * same deterministic resume HTML as the PDF.
 *
 * Usage:
 *   node scripts/build-resume.mjs              # HTML + PDF + DOCX
 *   node scripts/build-resume.mjs --html-only  # HTML only (no browser needed)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { TextDecoder } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { assertSafeOutputPath, writeFileNoFollow } = require('./lib/safe-output.cjs');
const {
  StableFileReadError,
  readStableFileNoFollow,
  sameFileIdentity
} = require('./lib/safe-input.cjs');
const {
  validateProfileData,
  validateSkillsData,
  validateExperienceData,
  validateCertificationData
} = require('./build.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const RESUME_MANIFEST_DESCRIPTION = 'Freshness manifest for docs/resume.pdf and docs/resume.docx. It records the deterministic rendered HTML hash and exact generated binary hashes. Run `npm run build:resume` after editing the sources below, then commit docs/resume.pdf, docs/resume.docx, and this manifest.';

const RESUME_SOURCE_FILES = ['resume.json', 'profile.json', 'experience.json', 'skills.json', 'certifications.json'];
const MAX_RESUME_SOURCE_BYTES = 512 * 1024;
const MAX_RESUME_HTML_BYTES = 2 * 1024 * 1024;
const MAX_RESUME_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_RESUME_MANIFEST_BYTES = 64 * 1024;
const RESUME_EXPORT_TIMEOUT_MS = 60 * 1000;
const MAX_RESUME_EXPORT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_PANDOC_DIAGNOSTIC_BYTES = 1024 * 1024;

const AI_PATTERN = /\b(AI|LLM|agent|agentic|responsible|explainable|cybersecurity|machine learning)\b/i;

function readJson(name, { rootDir = projectRoot } = {}) {
  const file = path.join(rootDir, 'data', name);
  const label = `data/${name}`;
  let bytes;
  try {
    bytes = readStableFileNoFollow(file, {
      rootDir,
      label,
      maxBytes: MAX_RESUME_SOURCE_BYTES
    });
  } catch (error) {
    throw new Error(`Could not read resume source ${label}: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`Invalid JSON in resume source ${label}: ${error.message}`, { cause: error });
  }
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

// --- Validation: fail fast on malformed resume and shared website data ----

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
    const seenSections = new Set();
    assertArray(resume.section_order, 'resume.section_order', { min: 1, max: 12 }).forEach((key, i) => {
      const value = assertString(key, `resume.section_order[${i}]`, { max: 40 });
      if (!SECTION_KEYS.includes(value)) {
        fail(`resume.section_order[${i}]`, `unknown section "${value}" (allowed: ${SECTION_KEYS.join(', ')})`);
      }
      if (seenSections.has(value)) {
        fail(`resume.section_order[${i}]`, `duplicate section "${value}"`);
      }
      seenSections.add(value);
    });
  }

  return resume;
}

function validateResumeSources(data) {
  assertObject(data, 'resume sources');
  validateResumeData(data.resume);
  validateProfileData(data.profile);
  validateSkillsData(data.skills);
  validateExperienceData(data.experience);
  validateCertificationData(data.certifications);
  return data;
}

/** Stable hash of the deterministic rendered HTML (NOT the non-deterministic PDF bytes). */
function computeResumeHtmlHash(html) {
  return `sha256-${crypto.createHash('sha256').update(html, 'utf8').digest('hex')}`;
}

function computeBytesSha256(bytes) {
  return `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}`;
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
    <h2 class="ai-callout__head">${escapeHtml(block.heading || 'AI & Agentic Highlights')}</h2>
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

class ResumeExportTimeoutError extends Error {
  constructor(label, timeoutMs, options) {
    super(`${label} timed out after ${timeoutMs}ms`, options);
    this.name = 'ResumeExportTimeoutError';
    this.code = 'ERR_RESUME_EXPORT_TIMEOUT';
    this.timeoutMs = timeoutMs;
  }
}

function assertResumeExportTimeout(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_RESUME_EXPORT_TIMEOUT_MS) {
    throw new TypeError(
      `Resume export timeout must be a positive safe integer no greater than ${MAX_RESUME_EXPORT_TIMEOUT_MS}.`
    );
  }
  return timeoutMs;
}

function withExporterDeadline(operation, {
  label,
  timeoutMs,
  onTimeout,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
}) {
  assertResumeExportTimeout(timeoutMs);
  if (typeof operation !== 'function') throw new TypeError('Exporter operation must be a function.');
  if (typeof label !== 'string' || label.length === 0) {
    throw new TypeError('Exporter deadline label must be a non-empty string.');
  }
  if (onTimeout !== undefined && typeof onTimeout !== 'function') {
    throw new TypeError('Exporter timeout cleanup must be a function when provided.');
  }
  if (typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function') {
    throw new TypeError('Exporter deadline timers must be functions.');
  }

  let timeoutHandle;
  let expired = false;
  let timeoutError;
  const deadline = Object.freeze({
    get expired() {
      return expired;
    },
    throwIfExpired() {
      if (expired) throw timeoutError;
    }
  });
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeoutImpl(() => {
      expired = true;
      timeoutError = new ResumeExportTimeoutError(label, timeoutMs);
      try {
        Promise.resolve(onTimeout?.(timeoutError)).catch(() => {});
      } catch {
        // The deadline must still reject even if best-effort cleanup itself fails.
      }
      reject(timeoutError);
    }, timeoutMs);
  });
  const operationPromise = Promise.resolve().then(() => operation(deadline));

  return Promise.race([operationPromise, timeoutPromise]).finally(() => {
    if (timeoutHandle !== undefined) clearTimeoutImpl(timeoutHandle);
  });
}

async function loadPlaywrightChromium() {
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
  return chromium;
}

async function exportPdf(html, outputPath, {
  timeoutMs = RESUME_EXPORT_TIMEOUT_MS,
  loadChromiumImpl = loadPlaywrightChromium,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  assertResumeExportTimeout(timeoutMs);
  if (typeof loadChromiumImpl !== 'function') {
    throw new TypeError('PDF exporter requires a Playwright Chromium loader.');
  }

  let browser;
  let page;
  let pageClosePromise;
  let browserClosePromise;

  function startPageClose() {
    if (!page || pageClosePromise) return pageClosePromise;
    const currentPage = page;
    try {
      pageClosePromise = Promise.resolve(currentPage.close({ runBeforeUnload: false }));
    } catch (error) {
      pageClosePromise = Promise.reject(error);
    }
    return pageClosePromise;
  }

  function startBrowserClose() {
    if (!browser || browserClosePromise) return browserClosePromise;
    const currentBrowser = browser;
    try {
      browserClosePromise = Promise.resolve(currentBrowser.close());
    } catch (error) {
      browserClosePromise = Promise.reject(error);
    }
    return browserClosePromise;
  }

  function forceClosePlaywrightResources() {
    const closeAttempts = [startPageClose(), startBrowserClose()].filter(Boolean);
    return Promise.allSettled(closeAttempts);
  }

  async function closePlaywrightResources() {
    const failures = [];
    const pageClose = startPageClose();
    if (pageClose) {
      try {
        await pageClose;
      } catch (error) {
        failures.push(error);
      }
    }
    const browserClose = startBrowserClose();
    if (browserClose) {
      try {
        await browserClose;
      } catch (error) {
        failures.push(error);
      }
    }
    page = undefined;
    browser = undefined;
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Could not completely close Playwright PDF export resources.');
    }
  }

  return withExporterDeadline(async (deadline) => {
    let exportError;
    try {
      const chromium = await loadChromiumImpl();
      deadline.throwIfExpired();
      try {
        browser = await chromium.launch({ headless: true, timeout: timeoutMs });
      } catch (error) {
        throw new Error(
          'Could not launch Chromium for PDF export. Run `npx playwright install chromium`.\n' +
          `Original error: ${error.message}`,
          { cause: error }
        );
      }
      deadline.throwIfExpired();
      page = await browser.newPage();
      deadline.throwIfExpired();
      await page.setContent(html, { waitUntil: 'networkidle', timeout: timeoutMs });
      deadline.throwIfExpired();
      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '13mm', bottom: '13mm', left: '14mm', right: '14mm' }
      });
      deadline.throwIfExpired();
    } catch (error) {
      exportError = error;
      throw error;
    } finally {
      try {
        await closePlaywrightResources();
      } catch (cleanupError) {
        if (exportError) {
          throw new AggregateError(
            [exportError, cleanupError],
            'PDF export failed and Playwright resource cleanup also failed.'
          );
        }
        throw cleanupError;
      }
    }
  }, {
    label: 'PDF export',
    timeoutMs,
    onTimeout: forceClosePlaywrightResources,
    setTimeoutImpl,
    clearTimeoutImpl
  });
}

function exportDocx(htmlPath, outputPath, {
  timeoutMs = RESUME_EXPORT_TIMEOUT_MS,
  execFileSyncImpl = execFileSync
} = {}) {
  assertResumeExportTimeout(timeoutMs);
  if (typeof execFileSyncImpl !== 'function') {
    throw new TypeError('DOCX exporter requires an execFileSync implementation.');
  }
  try {
    execFileSyncImpl(
      'pandoc',
      [
        htmlPath,
        '--from=html',
        '--to=docx',
        '--output',
        outputPath,
        '--metadata',
        'title=Leonard Wong Resume'
      ],
      {
        stdio: 'pipe',
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_PANDOC_DIAGNOSTIC_BYTES
      }
    );
  } catch (error) {
    const details = error.stderr?.toString().trim() || error.message;
    if (error.code === 'ETIMEDOUT') {
      throw new ResumeExportTimeoutError('DOCX export', timeoutMs, { cause: error });
    }
    throw new Error(
      `Could not export DOCX with pandoc. Install pandoc or ensure it is on PATH.\nOriginal error: ${details}`,
      { cause: error }
    );
  }
}

function getResumePaths(rootDir = projectRoot) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedArtifactsDir = path.join(resolvedRoot, 'artifacts');
  return {
    rootDir: resolvedRoot,
    artifactsDir: resolvedArtifactsDir,
    htmlOutPath: path.join(resolvedArtifactsDir, 'resume.html'),
    pdfOutPath: path.join(resolvedRoot, 'docs', 'resume.pdf'),
    docxOutPath: path.join(resolvedRoot, 'docs', 'resume.docx'),
    manifestOutPath: path.join(resolvedRoot, 'docs', 'resume.manifest.json'),
    buildLockPath: path.join(resolvedArtifactsDir, '.resume-build.lock')
  };
}

function publicationByteLength(bytes) {
  if (Buffer.isBuffer(bytes) || ArrayBuffer.isView(bytes)) return bytes.byteLength;
  return Buffer.byteLength(String(bytes), 'utf8');
}

function publishResumeBundle({ rootDir, entries, writeFileImpl = writeFileNoFollow }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('Resume publication entries must be a non-empty array.');
  }

  const seenPaths = new Set();
  const snapshots = entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' ||
        typeof entry.label !== 'string' || !Object.hasOwn(entry, 'bytes') ||
        !Number.isSafeInteger(entry.maxBytes) || entry.maxBytes < 1) {
      throw new TypeError('Each resume publication entry requires a path, bytes, label, and positive maxBytes.');
    }
    const resolvedPath = assertSafeOutputPath(rootDir, entry.path, entry.label);
    if (seenPaths.has(resolvedPath)) {
      throw new Error(`Duplicate resume publication path: ${resolvedPath}`);
    }
    seenPaths.add(resolvedPath);
    const byteLength = publicationByteLength(entry.bytes);
    if (byteLength < 1 || byteLength > entry.maxBytes) {
      throw new Error(`Generated ${entry.label} is outside the allowed 1-${entry.maxBytes} byte range.`);
    }
    try {
      return {
        existed: true,
        bytes: readStableFileNoFollow(entry.path, {
          rootDir,
          label: entry.label,
          maxBytes: entry.maxBytes
        })
      };
    } catch (error) {
      if (error instanceof StableFileReadError && error.reason === 'missing') {
        return { existed: false, bytes: null };
      }
      throw error;
    }
  });

  const published = [];
  try {
    entries.forEach((entry, index) => {
      writeFileImpl(rootDir, entry.path, entry.bytes, entry.label);
      const stats = fs.lstatSync(entry.path, { bigint: true });
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error(`Published ${entry.label} is not a regular file.`);
      }
      published.push({ index, stats });
    });
  } catch (publicationError) {
    const rollbackErrors = [];
    for (let cursor = published.length - 1; cursor >= 0; cursor -= 1) {
      const { index, stats: publishedStats } = published[cursor];
      const entry = entries[index];
      const snapshot = snapshots[index];
      try {
        if (snapshot.existed) {
          writeFileNoFollow(rootDir, entry.path, snapshot.bytes, `rollback ${entry.label}`);
        } else {
          const currentStats = fs.lstatSync(entry.path, { bigint: true });
          if (!currentStats.isFile() || !sameFileIdentity(publishedStats, currentStats)) {
            throw new Error(`Published ${entry.label} changed before rollback; refusing to remove it.`);
          }
          fs.unlinkSync(entry.path);
        }
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [publicationError, ...rollbackErrors],
        `Resume publication failed and ${rollbackErrors.length} rollback operation(s) also failed.`
      );
    }
    throw publicationError;
  }
}

function acquireResumeBuildLock({ rootDir = projectRoot } = {}) {
  const paths = getResumePaths(rootDir);
  fs.mkdirSync(paths.artifactsDir, { recursive: true });
  const lockPath = assertSafeOutputPath(paths.rootDir, paths.buildLockPath, 'resume build lock');
  const flags = fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0) |
    (fs.constants.O_CLOEXEC || 0);
  let descriptor;

  try {
    descriptor = fs.openSync(lockPath, flags, 0o600);
  } catch (error) {
    if (error.code === 'EEXIST' || error.code === 'ELOOP') {
      throw new Error(
        `Resume build lock is already held or unsafe: ${path.relative(paths.rootDir, lockPath)}. ` +
        'Wait for the active build to finish; remove a stale lock only after verifying no build is running.'
      );
    }
    throw error;
  }

  let lockStats;
  try {
    lockStats = fs.fstatSync(descriptor, { bigint: true });
    if (!lockStats.isFile() || lockStats.nlink !== 1n) {
      throw new Error('Resume build lock is not an owned single-link regular file.');
    }
    fs.writeFileSync(
      descriptor,
      `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
      'utf8'
    );
    fs.fsyncSync(descriptor);
    const writtenStats = fs.fstatSync(descriptor, { bigint: true });
    const currentStats = fs.lstatSync(lockPath, { bigint: true });
    if (!writtenStats.isFile() || writtenStats.nlink !== 1n ||
        !currentStats.isFile() || currentStats.nlink !== 1n ||
        !sameFileIdentity(writtenStats, currentStats)) {
      throw new Error('Resume build lock changed ownership during acquisition.');
    }
    lockStats = writtenStats;
  } catch (error) {
    let ownedStats = lockStats;
    try {
      if (!ownedStats) ownedStats = fs.fstatSync(descriptor, { bigint: true });
      const currentStats = fs.lstatSync(lockPath, { bigint: true });
      if (ownedStats.isFile() && ownedStats.nlink === 1n &&
          currentStats.isFile() && currentStats.nlink === 1n &&
          sameFileIdentity(ownedStats, currentStats)) {
        fs.unlinkSync(lockPath);
      }
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') error.lockCleanupError = cleanupError;
    } finally {
      try {
        fs.closeSync(descriptor);
      } catch (closeError) {
        error.lockCloseError = closeError;
      }
    }
    throw error;
  }

  let released = false;
  return {
    path: lockPath,
    release() {
      if (released) return;
      released = true;
      let releaseError;
      try {
        const currentStats = fs.lstatSync(lockPath, { bigint: true });
        if (!currentStats.isFile() || currentStats.nlink !== 1n ||
            !sameFileIdentity(lockStats, currentStats)) {
          throw new Error('Resume build lock changed ownership before release; refusing to remove it.');
        }
        fs.unlinkSync(lockPath);
      } catch (error) {
        releaseError = error;
      } finally {
        fs.closeSync(descriptor);
      }
      if (releaseError) throw releaseError;
    }
  };
}

async function withResumeBuildLock(options, operation) {
  const lock = acquireResumeBuildLock(options);
  let operationError;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      lock.release();
    } catch (releaseError) {
      if (operationError) {
        throw new AggregateError(
          [operationError, releaseError],
          'Resume build operation failed and the build lock could not be safely released.'
        );
      }
      throw releaseError;
    }
  }
}

async function buildResume({
  rootDir = projectRoot,
  htmlOnly = false,
  exportTimeoutMs = RESUME_EXPORT_TIMEOUT_MS,
  exportPdfImpl = exportPdf,
  exportDocxImpl = exportDocx,
  publishFileImpl = writeFileNoFollow,
  temporaryRoot = os.tmpdir(),
  log = console.log
} = {}) {
  assertResumeExportTimeout(exportTimeoutMs);
  const paths = getResumePaths(rootDir);
  fs.mkdirSync(paths.artifactsDir, { recursive: true });

  return withResumeBuildLock({ rootDir: paths.rootDir }, async () => {
    const data = loadResumeData({ rootDir: paths.rootDir });
    validateResumeSources(data);
    const html = renderResumeHtml(data);

    if (htmlOnly) {
      writeFileNoFollow(paths.rootDir, paths.htmlOutPath, html, 'resume HTML');
      log(`Resume HTML written: ${path.relative(paths.rootDir, paths.htmlOutPath)}`);
      log('Skipping PDF export and manifest update (--html-only).');
      return { html, paths, manifest: null };
    }

    fs.mkdirSync(path.dirname(paths.pdfOutPath), { recursive: true });
    const temporaryDirectory = fs.mkdtempSync(path.join(temporaryRoot, 'projectportfolio-resume-'));
    const temporaryHtmlPath = path.join(temporaryDirectory, 'resume.html');
    const temporaryPdfPath = path.join(temporaryDirectory, 'resume.pdf');
    const temporaryDocxPath = path.join(temporaryDirectory, 'resume.docx');

    try {
      writeFileNoFollow(temporaryDirectory, temporaryHtmlPath, html, 'temporary resume HTML');
      await exportPdfImpl(html, temporaryPdfPath, {
        htmlPath: temporaryHtmlPath,
        timeoutMs: exportTimeoutMs
      });
      await exportDocxImpl(temporaryHtmlPath, temporaryDocxPath, {
        timeoutMs: exportTimeoutMs
      });

      const pdfBytes = readStableFileNoFollow(temporaryPdfPath, {
        rootDir: temporaryDirectory,
        label: 'temporary resume PDF',
        maxBytes: MAX_RESUME_ARTIFACT_BYTES
      });
      const docxBytes = readStableFileNoFollow(temporaryDocxPath, {
        rootDir: temporaryDirectory,
        label: 'temporary resume DOCX',
        maxBytes: MAX_RESUME_ARTIFACT_BYTES
      });
      const manifest = {
        $generatedBy: 'scripts/build-resume.mjs',
        description: RESUME_MANIFEST_DESCRIPTION,
        htmlSha256: computeResumeHtmlHash(html),
        pdfSha256: computeBytesSha256(pdfBytes),
        docxSha256: computeBytesSha256(docxBytes),
        sources: RESUME_SOURCE_FILES.map((name) => `data/${name}`)
      };
      const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;

      // Every shared file is individually atomic and the exclusive lock spans
      // the complete bundle, so concurrent builders cannot interleave versions.
      // If an atomic write still fails, previously published entries are
      // restored from bounded stable snapshots before the lock is released.
      publishResumeBundle({
        rootDir: paths.rootDir,
        writeFileImpl: publishFileImpl,
        entries: [
          { path: paths.htmlOutPath, bytes: html, label: 'resume HTML', maxBytes: MAX_RESUME_HTML_BYTES },
          { path: paths.pdfOutPath, bytes: pdfBytes, label: 'resume PDF', maxBytes: MAX_RESUME_ARTIFACT_BYTES },
          { path: paths.docxOutPath, bytes: docxBytes, label: 'resume DOCX', maxBytes: MAX_RESUME_ARTIFACT_BYTES },
          { path: paths.manifestOutPath, bytes: manifestBytes, label: 'resume manifest', maxBytes: MAX_RESUME_MANIFEST_BYTES }
        ]
      });

      log(`Resume HTML written: ${path.relative(paths.rootDir, paths.htmlOutPath)}`);
      log(
        `Resume PDF written: ${path.relative(paths.rootDir, paths.pdfOutPath)} ` +
        `(${(pdfBytes.length / 1024).toFixed(1)} KiB)`
      );
      log(
        `Resume DOCX written: ${path.relative(paths.rootDir, paths.docxOutPath)} ` +
        `(${(docxBytes.length / 1024).toFixed(1)} KiB)`
      );
      log(`Resume manifest written: ${path.relative(paths.rootDir, paths.manifestOutPath)}`);
      return { html, paths, manifest };
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
}

function parseArgs(argv = process.argv.slice(2)) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');
  let htmlOnly = false;
  for (const argument of argv) {
    if (typeof argument !== 'string' || argument.length === 0) {
      throw new Error('Resume build arguments must be non-empty strings.');
    }
    if (argument === '--html-only') {
      if (htmlOnly) throw new Error('Duplicate argument: --html-only');
      htmlOnly = true;
      continue;
    }
    if (argument.startsWith('--html-only=')) {
      throw new Error('Argument --html-only does not accept a value.');
    }
    if (argument === '--') {
      throw new Error('Missing argument after --.');
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { htmlOnly };
}

async function main() {
  await buildResume(parseArgs());
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
  validateResumeSources,
  computeResumeHtmlHash,
  computeBytesSha256,
  parseArgs,
  readStableFileNoFollow,
  StableFileReadError,
  getResumePaths,
  publishResumeBundle,
  acquireResumeBuildLock,
  withResumeBuildLock,
  buildResume,
  exportPdf,
  exportDocx,
  ResumeExportTimeoutError,
  RESUME_MANIFEST_DESCRIPTION,
  RESUME_SOURCE_FILES,
  MAX_RESUME_SOURCE_BYTES,
  RESUME_EXPORT_TIMEOUT_MS,
  MAX_RESUME_EXPORT_TIMEOUT_MS,
  MAX_PANDOC_DIAGNOSTIC_BYTES
};
