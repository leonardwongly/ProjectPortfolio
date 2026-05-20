import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function readGeneratedIndex() {
  return fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
}

function readGeneratedAiOpsPage() {
  return fs.readFileSync(path.join(projectRoot, 'ai-ops-revenue-desk.html'), 'utf8');
}

function htmlIncludesText(html, value) {
  return html.includes(value) || html.includes(value.replace(/&/g, '&amp;').replace(/'/g, '&#39;'));
}

test('generated index includes LinkedIn-derived profile updates', () => {
  const profile = readJson('data/profile.json');
  const certifications = readJson('data/certifications.json');
  const skills = readJson('data/skills.json');
  const experience = readJson('data/experience.json');
  const html = readGeneratedIndex();

  assert.match(html, /Public Service Commission Singapore/);
  assert.match(html, /NCS Group/);
  assert.match(html, /Nanyang Polytechnic/);
  assert.match(html, /Diploma in Business Informatics with Merit/);
  assert.match(html, /2014–2017/);

  profile.articles.forEach((article) => {
    assert.ok(html.includes(article.title), `missing article: ${article.title}`);
    if (article.link) {
      assert.ok(html.includes(article.link), `missing article link: ${article.link}`);
    }
  });

  profile.honors.forEach((honor) => {
    assert.ok(html.includes(honor.title), `missing honor: ${honor.title}`);
  });

  profile.community.forEach((community) => {
    assert.ok(html.includes(community.organization), `missing community organization: ${community.organization}`);
    assert.ok(html.includes(community.logo), `missing community logo: ${community.logo}`);
    community.roles.forEach((role) => {
      assert.ok(htmlIncludesText(html, role.title), `missing community role: ${role.title}`);
    });
    community.responsibilities.forEach((item) => {
      assert.ok(htmlIncludesText(html, item), `missing community responsibility: ${item}`);
    });
  });

  certifications
    .filter((cert) => /AI|LLM/i.test(cert.title))
    .forEach((cert) => {
      assert.ok(html.includes(cert.title), `missing AI credential: ${cert.title}`);
    });

  const linkedAiCredentialTitles = [
    'Certificate of Completion: LLM Application Developer Programme',
    'AI and Cybersecurity'
  ];
  linkedAiCredentialTitles.forEach((title) => {
    const cert = certifications.find((item) => item.title === title);
    assert.ok(cert?.link, `missing linked credential URL: ${title}`);
    assert.ok(html.includes(cert.link), `missing linked credential URL in generated page: ${title}`);
  });

  skills
    .filter((group) => /AI|Security|Product/i.test(group.category))
    .flatMap((group) => group.items)
    .filter((item) => /AI|LLM|Responsible|Cybersecurity|Product|Platform/i.test(item))
    .forEach((item) => {
      assert.ok(htmlIncludesText(html, item), `missing skill item: ${item}`);
    });

  assert.ok(
    experience[0].impact_bullets.some((item) => html.includes(item)),
    'missing current NCS client-context bullet'
  );
});

test('generated index resolves profile tokens and exposes schema.org metadata', () => {
  const html = readGeneratedIndex();
  const source = fs.readFileSync(path.join(projectRoot, 'src/index.html'), 'utf8');

  assert.doesNotMatch(html, /\{\{PROFILE_SCHEMA}}/);
  assert.doesNotMatch(html, /\{\{PROFILE_CREDENTIALS}}/);
  assert.doesNotMatch(html, /\{\{WRITING}}/);
  assert.doesNotMatch(html, /\{\{HONORS}}/);
  assert.doesNotMatch(html, /\{\{COMMUNITY}}/);
  assert.match(source, /\{\{COMMUNITY}}/);
  assert.doesNotMatch(source, /CDC \(Central Singapore\)/);
  assert.match(html, /"@context": "https:\/\/schema.org"/);
  assert.match(html, /"affiliation": \{/);
  assert.match(html, /"memberOf": \[/);
  assert.match(html, /"name": "Public Service Commission Singapore"/);
  assert.match(html, /"@type": "Article"/);
  assert.match(html, /"@type": "ScholarlyArticle"/);
});

test('generated AI Ops page is discoverable and resolves build tokens', () => {
  const indexHtml = readGeneratedIndex();
  const aiOpsHtml = readGeneratedAiOpsPage();

  assert.match(indexHtml, /AI Ops Revenue Desk/);
  assert.match(indexHtml, /ai-ops-revenue-desk\.html/);
  assert.doesNotMatch(aiOpsHtml, /\{\{[A-Z_]+}}/);
  assert.match(aiOpsHtml, /Recover missed leads with one AI-assisted workflow\./);
  assert.match(aiOpsHtml, /SGD 2,500 \+ 750\/mo/);
  assert.doesNotMatch(aiOpsHtml, /USD /);
  assert.match(aiOpsHtml, /Request workflow review/);
  assert.match(aiOpsHtml, /https:\/\/email\.leonardwong\.tech/);
  assert.match(aiOpsHtml, /rel="noopener noreferrer"/);
  assert.match(aiOpsHtml, /Content-Security-Policy/);
});
