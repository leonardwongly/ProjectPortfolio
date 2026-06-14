import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  renderResumeHtml,
  validateResumeData,
  computeResumeHtmlHash
} from '../../scripts/build-resume.mjs';
import { checkResumeFreshness } from '../../scripts/check-resume-freshness.mjs';

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname);

function validResume() {
  return {
    name: 'Example Person',
    title: 'Software Engineer · AI & Agentic Development',
    location: 'Singapore',
    contact: {
      email: 'me@example.com',
      phone: '+65 0000 0000',
      links: [{ label: 'example.com', url: 'https://example.com' }]
    },
    summary: 'AI and agentic development on secure platforms.',
    ai_highlights: { heading: 'AI & Agentic Highlights', items: ['Agentic development.'] },
    section_order: ['summary', 'ai_highlights', 'skills']
  };
}

function minimalData(resume) {
  return {
    resume,
    profile: { education: [], publication: {} },
    experience: [],
    skills: [],
    certifications: []
  };
}

test('validateResumeData accepts a valid payload', () => {
  assert.doesNotThrow(() => validateResumeData(validResume()));
});

test('validateResumeData rejects unknown top-level keys', () => {
  const resume = validResume();
  resume.unexpected = 'value';
  assert.throws(() => validateResumeData(resume), /unexpected key\(s\): unexpected/);
});

test('validateResumeData requires name and title', () => {
  const noName = validResume();
  delete noName.name;
  assert.throws(() => validateResumeData(noName), /resume\.name/);

  const noTitle = validResume();
  noTitle.title = '   ';
  assert.throws(() => validateResumeData(noTitle), /resume\.title: expected a non-empty string/);
});

test('validateResumeData rejects non-https contact links', () => {
  const resume = validResume();
  resume.contact.links[0].url = 'javascript:alert(1)';
  assert.throws(() => validateResumeData(resume), /only https URLs are allowed|malformed URL/);
});

test('validateResumeData rejects unknown section_order entries', () => {
  const resume = validResume();
  resume.section_order = ['summary', 'bogus'];
  assert.throws(() => validateResumeData(resume), /unknown section "bogus"/);
});

test('validateResumeData enforces ai_highlights item bounds', () => {
  const empty = validResume();
  empty.ai_highlights.items = [];
  assert.throws(() => validateResumeData(empty), /at least 1 item/);
});

test('rendered resume HTML escapes untrusted field values', () => {
  const data = minimalData({
    name: '</style><script>alert(1)</script>',
    title: 'Engineer',
    contact: {},
    summary: '<img src=x onerror=alert(1)>',
    section_order: ['summary']
  });
  const html = renderResumeHtml(data);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img src=x onerror/);
});

test('computeResumeHtmlHash is deterministic and content-sensitive', () => {
  const data = minimalData(validResume());
  const first = computeResumeHtmlHash(renderResumeHtml(data));
  const second = computeResumeHtmlHash(renderResumeHtml(data));
  assert.equal(first, second);
  assert.match(first, /^sha256-[0-9a-f]{64}$/);

  const changed = minimalData(validResume());
  changed.resume.summary = 'A different summary entirely.';
  assert.notEqual(first, computeResumeHtmlHash(renderResumeHtml(changed)));
});

test('committed resume PDF is in sync with its sources', () => {
  const { ok, failures } = checkResumeFreshness();
  assert.ok(ok, failures.join('\n'));
});

test('freshness check fails when a source changes without regenerating', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-freshness-'));
  try {
    fs.cpSync(path.join(projectRoot, 'data'), path.join(tempRoot, 'data'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'docs'), { recursive: true });
    fs.copyFileSync(
      path.join(projectRoot, 'docs/resume.manifest.json'),
      path.join(tempRoot, 'docs/resume.manifest.json')
    );
    fs.writeFileSync(path.join(tempRoot, 'docs/resume.pdf'), 'placeholder'); // presence only

    // In sync before mutation.
    assert.ok(checkResumeFreshness({ rootDir: tempRoot }).ok);

    // Mutate a source so the rendered HTML — and its hash — change.
    const resumePath = path.join(tempRoot, 'data/resume.json');
    const resume = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
    resume.summary = `${resume.summary} (edited without rebuild)`;
    fs.writeFileSync(resumePath, JSON.stringify(resume, null, 2));

    const result = checkResumeFreshness({ rootDir: tempRoot });
    assert.equal(result.ok, false);
    assert.match(result.failures.join('\n'), /was not regenerated/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
