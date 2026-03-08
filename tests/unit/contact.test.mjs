import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { renderContact } = require('../../scripts/renderers/contact');

describe('renderContact', () => {
  it('should render contact section with required elements', () => {
    const html = renderContact();

    assert(html.includes('<section class="section-block" id="contact">'));
    assert(html.includes('Let\'s connect'));
    assert(html.includes('Open to impactful platform and security work.'));
  });

  it('should include all contact action buttons', () => {
    const html = renderContact();

    assert(html.includes('href="https://email.leonardwong.tech"'));
    assert(html.includes('href="https://linkedin.leonardwong.tech"'));
    assert(html.includes('href="docs/resume.pdf"'));
  });

  it('should include contact metadata', () => {
    const html = renderContact();

    assert(html.includes('Based in Singapore'));
    assert(html.includes('Security + Platform Engineering'));
  });

  it('should have proper rel attributes for external links', () => {
    const html = renderContact();

    assert(html.includes('rel="noopener noreferrer"'));
    assert(html.includes('target="_blank"'));
  });
});
