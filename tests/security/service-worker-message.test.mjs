import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('service worker validates source and schema before skipWaiting', () => {
  const content = fs.readFileSync('pwabuilder-sw.js', 'utf8');

  assert.match(content, /function\s+isTrustedWindowClient/);
  assert.match(content, /source\.type\s*!==\s*'window'/);
  assert.match(content, /new URL\(source\.url\)\.origin\s*===\s*self\.location\.origin/);
  assert.match(content, /function\s+isSkipWaitingMessage/);
  assert.match(content, /SW_UPDATE_TOKEN_PATTERN/);
  assert.match(content, /!isSkipWaitingMessage\(event\.data\)/);
  assert.match(content, /!isTrustedWindowClient\(event\.source\)/);
  assert.doesNotMatch(content, /event\.data\s*&&\s*event\.data\.type\s*===\s*'SKIP_WAITING'/);
});
