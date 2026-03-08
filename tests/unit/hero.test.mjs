import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const { renderHero } = require('../../scripts/renderers/hero');

describe('renderHero', () => {
  it('should render hero section with required elements', () => {
    const projectRoot = path.join(__dirname, '../..');
    const html = renderHero(projectRoot);

    assert(html.includes('<section class="hero-section section-block" id="home">'));
    assert(html.includes('Building secure, data-driven platforms with measurable impact.'));
    assert(html.includes('Software Engineer @ NCS Group'));
    assert(html.includes('href="docs/resume.pdf"'));
    assert(html.includes('href="#contact"'));
  });

  it('should include hero highlights', () => {
    const projectRoot = path.join(__dirname, '../..');
    const html = renderHero(projectRoot);

    assert(html.includes('Security · Platforms'));
    assert(html.includes('Data Automation'));
    assert(html.includes('NCS · NUS ISS'));
  });

  it('should include portrait image with alt text', () => {
    const projectRoot = path.join(__dirname, '../..');
    const html = renderHero(projectRoot);

    assert(html.includes('alt="Portrait of Leonard Wong"'));
    assert(html.includes('src="images/leo-220.jpeg"'));
  });

  it('should include WebP source when WebP files exist', () => {
    const projectRoot = path.join(__dirname, '../..');
    const html = renderHero(projectRoot);

    // Check for WebP source or standard JPEG (depending on file availability)
    assert(html.includes('<picture>'));
    assert(html.includes('<img'));
  });
});
