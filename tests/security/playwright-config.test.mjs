import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('local Playwright runs can reuse an existing static server', () => {
  const content = fs.readFileSync('playwright.config.mjs', 'utf8');

  assert.match(content, /reuseExistingServer:\s*!process\.env\.CI/);
});
