import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { renderSkills } = require('../../scripts/renderers/skills');

describe('renderSkills', () => {
  it('should render skills section with header', () => {
    const skills = [
      { category: 'Languages', items: ['JavaScript', 'Python', 'Go'] }
    ];

    const html = renderSkills(skills);

    assert(html.includes('<section class="section-block" id="skills">'));
    assert(html.includes('Skills'));
    assert(html.includes('Technical breadth with delivery depth'));
  });

  it('should render skill categories with chips', () => {
    const skills = [
      { category: 'Languages', items: ['JavaScript', 'Python'] },
      { category: 'Frameworks', items: ['React', 'Node.js'] }
    ];

    const html = renderSkills(skills);

    assert(html.includes('<h3>Languages</h3>'));
    assert(html.includes('<h3>Frameworks</h3>'));
    assert(html.includes('<span class="chip">JavaScript</span>'));
    assert(html.includes('<span class="chip">Python</span>'));
    assert(html.includes('<span class="chip">React</span>'));
    assert(html.includes('<span class="chip">Node.js</span>'));
  });

  it('should escape HTML in skill names', () => {
    const skills = [
      { category: 'Test<script>', items: ['Skill&Value'] }
    ];

    const html = renderSkills(skills);

    assert(!html.includes('<script>'));
    assert(html.includes('&lt;script&gt;'));
    assert(!html.includes('Skill&Value'));
    assert(html.includes('Skill&amp;Value'));
  });

  it('should handle empty items array gracefully', () => {
    const skills = [
      { category: 'Empty', items: [] }
    ];

    const html = renderSkills(skills);

    assert(html.includes('<h3>Empty</h3>'));
    assert(html.includes('<div class="chip-row"></div>'));
  });
});
