#!/usr/bin/env node
/**
 * Guards against stale resume artifacts.
 *
 * The PDF and DOCX outputs are non-deterministic, so byte comparison is
 * unreliable. Instead we re-render the deterministic resume HTML from the
 * current data files, hash it, and compare against the hash recorded in
 * docs/resume.manifest.json when the artifacts were last generated. A mismatch
 * means a source changed without regenerating the resume artifacts.
 *
 * Usage:
 *   node scripts/check-resume-freshness.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadResumeData,
  renderResumeHtml,
  validateResumeData,
  computeResumeHtmlHash
} from './build-resume.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const PDF_REL = 'docs/resume.pdf';
const DOCX_REL = 'docs/resume.docx';
const MANIFEST_REL = 'docs/resume.manifest.json';

function checkResumeFreshness({ rootDir = projectRoot } = {}) {
  const failures = [];
  const pdfPath = path.join(rootDir, PDF_REL);
  const docxPath = path.join(rootDir, DOCX_REL);
  const manifestPath = path.join(rootDir, MANIFEST_REL);

  if (!fs.existsSync(pdfPath)) {
    failures.push(`Missing ${PDF_REL}. Run \`npm run build:resume\`.`);
  }

  if (!fs.existsSync(docxPath)) {
    failures.push(`Missing ${DOCX_REL}. Run \`npm run build:resume\`.`);
  }

  if (!fs.existsSync(manifestPath)) {
    failures.push(`Missing ${MANIFEST_REL}. Run \`npm run build:resume\`.`);
    return { ok: false, failures };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    failures.push(`Could not parse ${MANIFEST_REL}: ${error.message}`);
    return { ok: false, failures };
  }

  const data = loadResumeData({ rootDir });
  validateResumeData(data.resume);
  const currentHash = computeResumeHtmlHash(renderResumeHtml(data));

  if (manifest.htmlSha256 !== currentHash) {
    failures.push(
      'Resume sources changed but docs/resume.pdf and docs/resume.docx were not regenerated.\n' +
        `  manifest htmlSha256: ${manifest.htmlSha256}\n` +
        `  current  htmlSha256: ${currentHash}\n` +
        '  Fix: run `npm run build:resume`, then commit docs/resume.pdf, docs/resume.docx, and docs/resume.manifest.json.'
    );
  }

  return { ok: failures.length === 0, failures, currentHash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { ok, failures } = checkResumeFreshness();
  if (!ok) {
    console.error('Resume freshness check failed:');
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
  } else {
    console.log('Resume freshness check passed.');
  }
}

export { checkResumeFreshness };
