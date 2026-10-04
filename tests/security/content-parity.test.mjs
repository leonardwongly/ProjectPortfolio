import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'parse5';

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname);

const HTML_ENTITIES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
});

const CASE_STUDY_LIST_SECTIONS = Object.freeze([
  { id: 'ownership', fields: ['ownership', 'controls'] },
  { id: 'evidence', fields: ['validation', 'outcomes'] },
  { id: 'tradeoffs', fields: ['limitations', 'next_steps'] }
]);

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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ENTITIES[character]);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertIncludesEscaped(scope, value, fieldPath) {
  assert.ok(scope.includes(escapeHtml(value)), `missing ${fieldPath}: ${value}`);
}

function assertIncludesEscapedList(scope, values, fieldPath) {
  values.forEach((value, index) => {
    assertIncludesEscaped(scope, value, `${fieldPath}[${index}]`);
  });
}

function assertIncludesEscapedFields(scope, record, fields, fieldPath) {
  fields.forEach((field) => {
    assert.ok(Object.hasOwn(record, field), `missing canonical field ${fieldPath}.${field}`);
    assertIncludesEscaped(scope, record[field], `${fieldPath}.${field}`);
  });
}

function extractClassElements(html, tagName, className) {
  const pattern = new RegExp(
    `<${tagName}\\b(?=[^>]*\\sclass="[^"]*\\b${escapeRegExp(className)}\\b[^"]*")[^>]*>[\\s\\S]*?<\\/${tagName}>`,
    'g'
  );
  return html.match(pattern) || [];
}

function extractSection(html, id, context = 'generated page') {
  const pattern = new RegExp(`<section\\b[^>]*\\bid="${escapeRegExp(id)}"[^>]*>[\\s\\S]*?<\\/section>`, 'g');
  const matches = html.match(pattern) || [];
  assert.equal(matches.length, 1, `expected exactly one #${id} section in ${context}`);
  return matches[0];
}

function extractProfileSchema(html) {
  const match = html.match(/<script\s+type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(match, 'missing profile JSON-LD script');
  return JSON.parse(match[1]);
}

test('generated index preserves canonical profile, skill, and experience content', () => {
  const profile = readJson('data/profile.json');
  const certifications = readJson('data/certifications.json');
  const skills = readJson('data/skills.json');
  const experience = readJson('data/experience.json');
  const html = readGeneratedIndex();
  const writingSection = extractSection(html, 'writing', 'index');
  const articleCards = extractClassElements(writingSection, 'article', 'article-card');
  assert.equal(articleCards.length, profile.articles.length, 'article card count must match profile data');
  profile.articles.forEach((article, articleIndex) => {
    const card = articleCards[articleIndex];
    ['title', 'published', 'summary'].forEach((field) => {
      assertIncludesEscaped(card, article[field], `profile.articles[${articleIndex}].${field}`);
    });
    assertIncludesEscapedList(card, article.tags || [], `profile.articles[${articleIndex}].tags`);
    if (article.link) {
      assertIncludesEscaped(card, article.link, `profile.articles[${articleIndex}].link`);
    }
  });

  const honorsSection = extractSection(html, 'honors', 'index');
  const honorCards = extractClassElements(honorsSection, 'article', 'honor-card');
  assert.equal(honorCards.length, profile.honors.length, 'honor card count must match profile data');
  profile.honors.forEach((honor, honorIndex) => {
    ['title', 'issuer', 'issued', 'description'].forEach((field) => {
      if (honor[field]) {
        assertIncludesEscaped(honorCards[honorIndex], honor[field], `profile.honors[${honorIndex}].${field}`);
      }
    });
  });

  const communitySection = extractSection(html, 'community', 'index');
  profile.community.forEach((community, communityIndex) => {
    ['organization', 'logo', 'logo_alt'].forEach((field) => {
      assertIncludesEscaped(communitySection, community[field], `profile.community[${communityIndex}].${field}`);
    });
    community.roles.forEach((role, roleIndex) => {
      ['title', 'dates'].forEach((field) => {
        assertIncludesEscaped(
          communitySection,
          role[field],
          `profile.community[${communityIndex}].roles[${roleIndex}].${field}`
        );
      });
    });
    assertIncludesEscapedList(
      communitySection,
      community.responsibilities,
      `profile.community[${communityIndex}].responsibilities`
    );
  });

  const credentialsSection = extractSection(html, 'credentials', 'index');
  profile.education.forEach((education, educationIndex) => {
    ['institution', 'credential', 'dates'].forEach((field) => {
      assertIncludesEscaped(credentialsSection, education[field], `profile.education[${educationIndex}].${field}`);
    });
  });
  certifications.forEach((certification, certificationIndex) => {
    assertIncludesEscaped(credentialsSection, certification.title, `certifications[${certificationIndex}].title`);
    assertIncludesEscaped(credentialsSection, certification.issuer, `certifications[${certificationIndex}].issuer`);
    const displayDate = String(certification.issued).replace(/^Issued\s+/i, '').replace(/\s*[-·].*$/, '');
    assertIncludesEscaped(credentialsSection, displayDate, `certifications[${certificationIndex}].issued`);
    if (certification.link) {
      assertIncludesEscaped(credentialsSection, certification.link, `certifications[${certificationIndex}].link`);
    }
  });

  const skillsSection = extractSection(html, 'skills', 'index');
  skills.forEach((group, groupIndex) => {
    assertIncludesEscaped(skillsSection, group.category, `skills[${groupIndex}].category`);
    assertIncludesEscapedList(skillsSection, group.items, `skills[${groupIndex}].items`);
  });

  const experienceSection = extractSection(html, 'experience', 'index');
  const experienceCards = extractClassElements(experienceSection, 'article', 'experience-card');
  assert.equal(experienceCards.length, experience.length, 'experience card count must match canonical data');
  experience.forEach((role, roleIndex) => {
    const card = experienceCards[roleIndex];
    ['org', 'role', 'dates'].forEach((field) => {
      assertIncludesEscaped(card, role[field], `experience[${roleIndex}].${field}`);
    });
    assertIncludesEscapedList(card, role.impact_bullets, `experience[${roleIndex}].impact_bullets`);
    assertIncludesEscapedList(card, role.tech, `experience[${roleIndex}].tech`);
  });
});

test('generated index resolves profile tokens and exposes schema.org metadata', () => {
  const profile = readJson('data/profile.json');
  const certifications = readJson('data/certifications.json');
  const html = readGeneratedIndex();
  const source = fs.readFileSync(path.join(projectRoot, 'src/index.html'), 'utf8');

  assert.doesNotMatch(html, /\{\{PROFILE_SCHEMA}}/);
  assert.doesNotMatch(html, /\{\{PROFILE_CREDENTIALS}}/);
  assert.doesNotMatch(html, /\{\{WRITING}}/);
  assert.doesNotMatch(html, /\{\{HONORS}}/);
  assert.doesNotMatch(html, /\{\{COMMUNITY}}/);
  assert.match(source, /\{\{COMMUNITY}}/);
  assert.doesNotMatch(source, /CDC \(Central Singapore\)/);

  const schema = extractProfileSchema(html);
  assert.equal(schema['@context'], 'https://schema.org');
  assert.ok(Array.isArray(schema['@graph']), 'profile schema graph must be an array');
  const personNode = schema['@graph'].find((node) => node['@type'] === 'Person');
  assert.ok(personNode, 'profile schema must contain a Person node');
  assert.equal(personNode.affiliation?.name, 'Public Service Commission Singapore');
  assert.deepEqual(
    personNode.memberOf?.map((membership) => membership.name),
    profile.community.map((community) => community.organization),
    'schema community memberships must follow canonical profile data'
  );
  assert.deepEqual(
    personNode.hasCredential?.map((credential) => credential.name),
    certifications.map((certification) => certification.title),
    'schema credentials must follow canonical certification data'
  );

  const scholarlyArticle = schema['@graph'].find((node) => node['@type'] === 'ScholarlyArticle');
  assert.equal(scholarlyArticle?.headline, profile.publication.title);
  assert.deepEqual(
    schema['@graph'].filter((node) => node['@type'] === 'Article').map((article) => article.headline),
    profile.articles.map((article) => article.title),
    'schema articles must follow canonical profile data'
  );
});

test('home prioritizes exactly three flagship projects and archive retains every project', () => {
  const projects = readJson('data/featured-projects.json');
  const index = readGeneratedIndex();
  const work = readGeneratedWork();
  const featured = projects
    .filter((project) => project.featured)
    .sort((a, b) => a.featured_order - b.featured_order);
  const homeSection = extractSection(index, 'work', 'index');
  const archiveSection = extractSection(work, 'projects', 'work archive');
  const homeCards = extractClassElements(homeSection, 'article', 'featured-card');
  const archiveCards = extractClassElements(archiveSection, 'article', 'featured-card');

  assert.equal(featured.length, 3, 'canonical project data must define exactly three flagships');
  assert.equal(homeCards.length, featured.length, 'home must render every and only flagship project');
  assert.equal(archiveCards.length, projects.length, 'archive card count must match canonical project data');
  assert.ok(homeSection.includes('href="/work.html"'), 'home must link to the complete project archive');
  assert.match(archiveSection, /<p class="eyebrow">Project Archive<\/p>/);

  featured.forEach((project, projectIndex) => {
    assert.ok(
      homeCards[projectIndex].includes(`<h3>${escapeHtml(project.title)}</h3>`),
      `flagship order mismatch at featured-projects.${project.id}`
    );
  });

  projects.forEach((project, projectIndex) => {
    const card = archiveCards[projectIndex];
    assertIncludesEscapedFields(
      card,
      project,
      ['title', 'timeframe', 'problem', 'impact', 'status'],
      `featured-projects[${projectIndex}]`
    );
    assertIncludesEscapedList(card, project.capabilities, `featured-projects[${projectIndex}].capabilities`);
    assertIncludesEscapedList(card, project.tech || [], `featured-projects[${projectIndex}].tech`);
    (project.links || []).forEach((link, linkIndex) => {
      assertIncludesEscaped(card, link.label, `featured-projects[${projectIndex}].links[${linkIndex}].label`);
      assertIncludesEscaped(card, link.url, `featured-projects[${projectIndex}].links[${linkIndex}].url`);
    });
  });
});

test('generated flagship case studies preserve governed evidence and cross-links', () => {
  const projects = readJson('data/featured-projects.json');
  const studies = readJson('data/case-studies.json');
  const work = readGeneratedWork();
  const archiveSection = extractSection(work, 'projects', 'work archive');
  const archiveCards = extractClassElements(archiveSection, 'article', 'featured-card');
  const featuredProjects = projects.filter((project) => project.featured);

  assert.equal(studies.length, featuredProjects.length, 'every flagship must have one case study');
  assert.deepEqual(
    studies.map((study) => study.project_id).sort(),
    featuredProjects.map((project) => project.id).sort(),
    'case studies must cover every flagship project exactly once'
  );
  studies.forEach((study, studyIndex) => {
    const project = projects.find((item) => item.id === study.project_id);
    assert.ok(project?.featured, `case study is not tied to a featured project: ${study.id}`);
    assert.equal(project.case_study, `/${study.slug}`);
    const projectIndex = projects.indexOf(project);
    assert.ok(
      archiveCards[projectIndex].includes(`href="${escapeHtml(project.case_study)}"`),
      `archive project does not link to case study: ${study.id}`
    );

    const html = readGeneratedCaseStudy(study.slug);
    assert.ok(
      html.includes(`<article class="case-study" data-case-study="${escapeHtml(study.id)}">`),
      `case-study page does not identify canonical id: ${study.id}`
    );

    const hero = extractClassElements(html, 'header', 'case-hero');
    assert.equal(hero.length, 1, `expected one case-study hero: ${study.id}`);
    assertIncludesEscapedFields(
      hero[0],
      study,
      ['eyebrow', 'title', 'summary', 'role', 'timeframe'],
      `case-studies[${studyIndex}]`
    );
    assertIncludesEscaped(hero[0], study.repository_url, `case-studies[${studyIndex}].repository_url`);

    const challengeSection = extractSection(html, 'challenge', study.slug);
    assertIncludesEscaped(challengeSection, study.challenge, `case-studies[${studyIndex}].challenge`);

    const architectureSection = extractSection(html, 'architecture', study.slug);
    assertIncludesEscaped(
      architectureSection,
      study.architecture_intro,
      `case-studies[${studyIndex}].architecture_intro`
    );
    const architectureFlow = architectureSection.match(
      /<ol\b(?=[^>]*\sclass="[^"]*\barchitecture-flow\b[^"]*")[^>]*>[\s\S]*?<\/ol>/
    );
    assert.ok(architectureFlow, `missing architecture flow: ${study.id}`);
    const architectureStages = architectureFlow[0].match(/<li>[\s\S]*?<\/li>/g) || [];
    assert.equal(
      architectureStages.length,
      study.architecture.length,
      `architecture stage count mismatch: ${study.id}`
    );
    study.architecture.forEach((stage, stageIndex) => {
      ['label', 'detail'].forEach((field) => {
        assertIncludesEscaped(
          architectureStages[stageIndex],
          stage[field],
          `case-studies[${studyIndex}].architecture[${stageIndex}].${field}`
        );
      });
    });

    const decisionSection = extractSection(html, 'decisions', study.slug);
    const decisionCards = extractClassElements(decisionSection, 'article', 'decision-card');
    assert.equal(decisionCards.length, study.decisions.length, `decision count mismatch: ${study.id}`);
    study.decisions.forEach((decision, decisionIndex) => {
      ['title', 'detail'].forEach((field) => {
        assertIncludesEscaped(
          decisionCards[decisionIndex],
          decision[field],
          `case-studies[${studyIndex}].decisions[${decisionIndex}].${field}`
        );
      });
    });

    CASE_STUDY_LIST_SECTIONS.forEach(({ id, fields }) => {
      const section = extractSection(html, id, study.slug);
      const panels = extractClassElements(section, 'div', 'case-panel');
      assert.equal(panels.length, fields.length, `${id} panel count mismatch: ${study.id}`);
      fields.forEach((field, panelIndex) => {
        assertIncludesEscapedList(panels[panelIndex], study[field], `case-studies[${studyIndex}].${field}`);
      });
    });

    const nextStudy = studies[(studyIndex + 1) % studies.length];
    const nextStudyPanels = extractClassElements(html, 'aside', 'case-next');
    assert.equal(nextStudyPanels.length, 1, `expected one next-case-study panel: ${study.id}`);
    assert.ok(nextStudyPanels[0].includes('aria-label="Next case study"'));
    assertIncludesEscaped(nextStudyPanels[0], nextStudy.title, `next case-study title after ${study.id}`);
    assertIncludesEscaped(nextStudyPanels[0], nextStudy.summary, `next case-study summary after ${study.id}`);
    assert.ok(
      nextStudyPanels[0].includes(`href="/${escapeHtml(nextStudy.slug)}"`),
      `next case-study link mismatch after ${study.id}`
    );
    assert.doesNotMatch(html, /\{\{[A-Z_]+}}/);
  });
});

function descendants(node, predicate) {
  const result = [];
  function visit(current) { if (predicate(current)) result.push(current); for (const child of current.childNodes || []) visit(child); if (current.content) visit(current.content); }
  visit(node); return result;
}
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const hasClass = (node, name) => (attr(node, 'class') || '').split(/\s+/).includes(name);
const domText = (node) => descendants(node, (item) => item.nodeName === '#text').map((item) => item.value).join('').replace(/\s+/g, ' ').trim();
function one(node, predicate) { const found = descendants(node, predicate); assert.equal(found.length, 1); return found[0]; }

test('canonical records retain their own DOM fields, links and accordion relationships', () => {
  const document = parse(readGeneratedIndex());
  const profile = readJson('data/profile.json');
  const section = (id) => one(document, (node) => node.tagName === 'section' && attr(node, 'id') === id);
  const communitySection = section('community');
  assert.equal(descendants(communitySection, (node) => hasClass(node, 'accordion-item')).length, profile.community.length);
  for (const entry of profile.community) {
    const button = one(communitySection, (node) => node.tagName === 'button' && attr(node, 'aria-controls') === `collapse${entry.id}`);
    assert.equal(attr(button, 'data-bs-target'), `#collapse${entry.id}`);
    assert.equal(domText(one(button, (node) => node.tagName === 'strong')), entry.organization);
    const image = one(button, (node) => node.tagName === 'img');
    assert.equal(attr(image, 'src'), entry.logo); assert.equal(attr(image, 'alt'), entry.logo_alt);
    const panel = one(communitySection, (node) => attr(node, 'id') === `collapse${entry.id}`);
    assert.equal(attr(panel, 'aria-labelledby'), `heading${entry.id}`);
    const lists = descendants(panel, (node) => node.tagName === 'ul'); assert.equal(lists.length, 2);
    assert.deepEqual(descendants(lists[0], (node) => node.tagName === 'li').map(domText), entry.roles.map((role) => `${role.dates} · ${role.title}`));
    assert.deepEqual(descendants(lists[1], (node) => node.tagName === 'li').map(domText), entry.responsibilities);
  }
  const credentials = section('credentials');
  const educationCard = one(credentials, (node) => hasClass(node, 'card') && descendants(node, (item) => item.tagName === 'h3' && domText(item) === 'Education').length === 1);
  assert.deepEqual(descendants(educationCard, (node) => node.tagName === 'li').map(domText), profile.education.map((entry) => `${entry.institution} — ${entry.credential}, ${entry.dates}`));
  const certifications = readJson('data/certifications.json');
  assert.equal(descendants(credentials, (node) => hasClass(node, 'cert-row')).length, certifications.length);
  for (const cert of certifications) {
    const group = one(credentials, (node) => hasClass(node, 'cert-group') && descendants(node, (item) => hasClass(item, 'cert-group__issuer') && domText(item) === cert.issuer).length === 1);
    const row = one(group, (node) => hasClass(node, 'cert-row') && descendants(node, (item) => hasClass(item, 'cert-row__name') && domText(item) === cert.title).length === 1);
    assert.equal(domText(one(row, (node) => hasClass(node, 'cert-row__date'))), String(cert.issued).replace(/^Issued\s+/i, '').replace(/\s*[-·].*$/, ''));
    const links = descendants(row, (node) => node.tagName === 'a');
    assert.equal(links.length, cert.link ? 1 : 0); if (cert.link) assert.equal(attr(links[0], 'href'), cert.link);
  }
  const groups = readJson('data/skills.json');
  const cards = descendants(section('skills'), (node) => hasClass(node, 'skill-card')); assert.equal(cards.length, groups.length);
  groups.forEach((group, index) => {
    assert.equal(domText(one(cards[index], (node) => node.tagName === 'h3')), group.category);
    assert.deepEqual(descendants(cards[index], (node) => hasClass(node, 'chip')).map(domText), group.items);
  });
  const articles = descendants(section('writing'), (node) => node.tagName === 'article' && hasClass(node, 'article-card'));
  assert.equal(articles.length, profile.articles.length);
  profile.articles.forEach((article, index) => {
    assert.equal(domText(one(articles[index], (node) => node.tagName === 'h3')), article.title);
    const links = descendants(articles[index], (node) => node.tagName === 'a');
    assert.deepEqual(links.map((node) => attr(node, 'href')), article.link ? [article.link] : []);
  });
  const work = parse(readGeneratedWork());
  const archive = one(work, (node) => node.tagName === 'section' && attr(node, 'id') === 'projects');
  const projects = readJson('data/featured-projects.json');
  const projectCards = descendants(archive, (node) => node.tagName === 'article' && hasClass(node, 'featured-card'));
  assert.equal(projectCards.length, projects.length);
  projects.forEach((project, index) => {
    assert.equal(domText(one(projectCards[index], (node) => node.tagName === 'h3')), project.title);
    for (const link of project.links || []) {
      const anchor = one(projectCards[index], (node) => node.tagName === 'a' && domText(node).startsWith(link.label));
      assert.equal(attr(anchor, 'href'), link.url);
    }
  });
});
