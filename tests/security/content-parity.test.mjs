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

function readGeneratedWork() {
  return fs.readFileSync(path.join(projectRoot, 'work.html'), 'utf8');
}

function readGeneratedCaseStudy(slug) {
  return fs.readFileSync(path.join(projectRoot, slug), 'utf8');
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

test('home prioritizes exactly three flagship projects and archive retains every project', () => {
  const projects = readJson('data/featured-projects.json');
  const index = readGeneratedIndex();
  const work = readGeneratedWork();
  const homeCards = index.match(/<article class="featured-card"/g) || [];
  const archiveCards = work.match(/<article class="featured-card"/g) || [];

  assert.equal(homeCards.length, 3);
  assert.equal(archiveCards.length, projects.length);
  assert.match(index, /href="\/work\.html"/);
  assert.match(work, /Project Archive/);

  projects.forEach((project) => {
    assert.ok(work.includes(project.title), `missing archived project: ${project.title}`);
    assert.ok(work.includes(project.status), `missing project status: ${project.title}`);
  });

  const featured = projects
    .filter((project) => project.featured)
    .sort((a, b) => a.featured_order - b.featured_order);
  const positions = featured.map((project) => index.indexOf(project.title));
  assert.ok(positions.every((position) => position >= 0), 'missing flagship project on home page');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'flagship projects are not rendered in configured order');
});

test('generated flagship case studies preserve governed evidence and cross-links', () => {
  const projects = readJson('data/featured-projects.json');
  const studies = readJson('data/case-studies.json');
  const work = readGeneratedWork();

  assert.equal(studies.length, 3);
  studies.forEach((study) => {
    const project = projects.find((item) => item.id === study.project_id);
    assert.ok(project?.featured, `case study is not tied to a featured project: ${study.id}`);
    assert.equal(project.case_study, `/${study.slug}`);
    assert.match(work, new RegExp(`href="/${study.slug.replace('.', '\\.')}"`));

    const html = readGeneratedCaseStudy(study.slug);
    assert.ok(html.includes(study.title), `missing case-study title: ${study.title}`);
    assert.ok(htmlIncludesText(html, study.challenge), `missing challenge: ${study.title}`);
    assert.equal((html.match(/<li><strong>/g) || []).length, study.architecture.length);
    assert.equal((html.match(/class="decision-card"/g) || []).length, study.decisions.length);
    assert.match(html, /id="tradeoffs"/);
    assert.match(html, /aria-label="Next case study"/);
    assert.doesNotMatch(html, /\{\{[A-Z_]+}}/);
  });
});
