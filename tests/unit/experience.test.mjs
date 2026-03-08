import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { renderExperience } = require('../../scripts/renderers/experience');

describe('renderExperience', () => {
  it('should render experience section with header', () => {
    const experience = [
      {
        org: 'Tech Corp',
        role: 'Software Engineer',
        dates: '2020 - Present',
        impact_bullets: ['Built features'],
        tech: ['Node.js']
      }
    ];

    const html = renderExperience(experience);

    assert(html.includes('<section class="section-block" id="experience">'));
    assert(html.includes('Experience'));
    assert(html.includes('Engineering roles with measurable outcomes'));
  });

  it('should render experience cards with all details', () => {
    const experience = [
      {
        org: 'Tech Corp',
        role: 'Senior Engineer',
        dates: '2020 - 2023',
        impact_bullets: ['Led team of 5', 'Improved performance by 40%'],
        tech: ['React', 'Node.js', 'AWS']
      }
    ];

    const html = renderExperience(experience);

    assert(html.includes('<h3>Tech Corp</h3>'));
    assert(html.includes('Senior Engineer'));
    assert(html.includes('2020 - 2023'));
    assert(html.includes('<li>Led team of 5</li>'));
    assert(html.includes('<li>Improved performance by 40%</li>'));
    assert(html.includes('<span class="chip">React</span>'));
    assert(html.includes('<span class="chip">Node.js</span>'));
    assert(html.includes('<span class="chip">AWS</span>'));
  });

  it('should escape HTML in experience data', () => {
    const experience = [
      {
        org: 'Corp<script>alert(1)</script>',
        role: 'Engineer & Developer',
        dates: '2020',
        impact_bullets: ['Fixed <bugs>'],
        tech: ['JavaScript & TypeScript']
      }
    ];

    const html = renderExperience(experience);

    assert(!html.includes('<script>'));
    assert(html.includes('&lt;script&gt;'));
    assert(html.includes('Engineer &amp; Developer'));
    assert(html.includes('Fixed &lt;bugs&gt;'));
    assert(html.includes('JavaScript &amp; TypeScript'));
  });

  it('should handle optional tech array', () => {
    const experience = [
      {
        org: 'Company',
        role: 'Engineer',
        dates: '2020',
        impact_bullets: ['Work done']
      }
    ];

    const html = renderExperience(experience);

    assert(html.includes('<h3>Company</h3>'));
    assert(html.includes('<div class="chip-row"></div>'));
  });
});
