import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeHtml,
  escapeJsonLd,
  hashInlineScript
} from '../../../scripts/lib/static-rendering.cjs';
import {
  AssetPathValidationError,
  MAX_RELATIVE_PATH_LENGTH,
  resolveContainedPath,
  sanitizeRelativeAssetPath
} from '../../../scripts/lib/asset-paths.cjs';
import os from "node:os";
import crypto from "node:crypto";
import path from 'node:path';

function assertValidationError(fn, expectedReason, fieldPath = 'asset') {
  let caught;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AssetPathValidationError, `expected AssetPathValidationError, got ${caught}`);
  assert.equal(caught.name, 'AssetPathValidationError');
  assert.equal(caught.fieldPath, fieldPath);
  assert.equal(caught.reason, expectedReason);
  assert.equal(caught.message, `Invalid path at ${fieldPath}: ${expectedReason}`);
}

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

test('escapeHtml escapes all five dangerous characters including both quote styles', () => {
  assert.equal(
    escapeHtml(`<img src="x" onerror='alert("pwned")'>`),
    '&lt;img src=&quot;x&quot; onerror=&#39;alert(&quot;pwned&quot;)&#39;&gt;'
  );
});

test('escapeHtml preserves harmless backslashes verbatim', () => {
  // Backslashes have no HTML meaning; escaping them would corrupt legitimate text.
  assert.equal(escapeHtml('a\\b\\\\c'), 'a\\b\\\\c');
});

test('escapeHtml passes through control characters without corruption', () => {
  // Null bytes and newlines are inert in element/text context once <>&"' are escaped.
  assert.equal(escapeHtml('a\x00b\nc\td'), 'a\x00b\nc\td');
});

test('escapeHtml intentionally double-escapes already-escaped input', () => {
  // Re-escaping is the correct fail-safe behavior: &amp; must become &amp;amp;,
  // never collapse back to & which would resurrect an attacker-controlled entity.
  assert.equal(escapeHtml('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
  assert.equal(escapeHtml('&#39;&quot;'), '&amp;#39;&amp;quot;');
});

test('escapeHtml neutralizes template-literal-style payloads', () => {
  const payload = '${constructor.constructor("return process")().exit()}';
  const out = escapeHtml(payload);
  assert.equal(out, '${constructor.constructor(&quot;return process&quot;)().exit()}');
  assert.ok(!out.includes('<') && !out.includes('>'));
});

test('escapeHtml coerces non-string values through String()', () => {
  assert.equal(escapeHtml(123), '123');
  assert.equal(escapeHtml(null), 'null');
});

test('escapeHtml handles very long hostile strings completely', () => {
  const payload = '<script>'.repeat(20000);
  const out = escapeHtml(payload);
  assert.equal((out.match(/&lt;script&gt;/g) || []).length, 20000);
  assert.ok(!/[<>]/.test(out));
});

// ---------------------------------------------------------------------------
// escapeJsonLd
// ---------------------------------------------------------------------------

test('escapeJsonLd prevents </script> breakout inside string values', () => {
  const out = escapeJsonLd({ description: '</script><script>alert(1)</script>' });
  assert.ok(!/<\/script/i.test(out.replace(/^"|"$/g, '')));
  assert.ok(out.includes('\\u003c/script\\u003e'));
});

test('escapeJsonLd output remains valid JSON that round-trips quotes and backslashes', () => {
  const value = { s: 'quote " backslash \\ newline \n tab \t nul \u0000', arr: [1, true, null] };
  const out = escapeJsonLd(value);
  assert.deepEqual(JSON.parse(out), value);
});

test('escapeJsonLd escapes ampersands so HTML entities cannot survive into markup', () => {
  const out = escapeJsonLd({ name: 'Tom & Jerry &amp; friends' });
  assert.equal(out.includes('\\u0026'), true);
  assert.deepEqual(JSON.parse(out), { name: 'Tom & Jerry &amp; friends' });
});

test('escapeJsonLd uses 8-space indentation matching build output expectations', () => {
  const lines = escapeJsonLd({ a: { b: 1 } }).split('\n');
  assert.equal(lines[1], '        "a": {');
  assert.equal(lines[2], '                "b": 1');
});

test('escapeJsonLd preserves unicode line separators in inert JSON-LD without script breakout', () => {
  const value = { title: 'a\u2028b\u2029c</script><script>alert(1)</script>' };
  const out = escapeJsonLd(value);
  // U+2028/U+2029 are legal JSON string characters. JSON-LD is a data block,
  // not executable JavaScript; the HTML closing-script delimiter must be escaped.
  assert.deepEqual(JSON.parse(out), value);
  assert.doesNotMatch(out, /<\/script/i);
  assert.ok(out.includes('\\u003c/script\\u003e'));
});

test('escapeJsonLd is deterministic for identical input', () => {
  const value = { x: ['</script>', '&', '"quoted"'] };
  assert.equal(escapeJsonLd(value), escapeJsonLd(value));
});

test('escapeJsonLd handles very long payloads fully', () => {
  const value = { blob: '</script>'.repeat(5000) };
  const out = escapeJsonLd(value);
  assert.ok(out.includes('\\u003c'));
  assert.equal((out.match(/\\u003c/g) || []).length, 5000);
  assert.deepEqual(JSON.parse(out), value);
});

// ---------------------------------------------------------------------------
// hashInlineScript
// ---------------------------------------------------------------------------

test('hashInlineScript produces the canonical sha256 CSP prefix format', () => {
  assert.match(hashInlineScript('console.log(1)'), /^sha256-[A-Za-z0-9+/]{43}=$/);
});

test('hashInlineScript matches an independently computed SHA-256 digest', () => {
  const content = 'alert("adversarial")';
  const expected = `sha256-${crypto.createHash('sha256').update(content, 'utf8').digest('base64')}`;
  assert.equal(hashInlineScript(content), expected);
});

test('hashInlineScript is deterministic across repeated calls and encodes utf8', () => {
  const content = 'const emoji = "\u{1F600}";';
  assert.equal(hashInlineScript(content), hashInlineScript(content));
  assert.notEqual(hashInlineScript(content + ' '), hashInlineScript(content));
});

test('hashInlineScript distinguishes near-collision inputs (no digest reuse)', () => {
  const a = hashInlineScript('<script>x</script>');
  const b = hashInlineScript('<script>y</script>');
  assert.notEqual(a, b);
  assert.notEqual(hashInlineScript(''), hashInlineScript('\n'));
});

// ---------------------------------------------------------------------------
// sanitizeRelativeAssetPath — accepted paths
// ---------------------------------------------------------------------------

test('sanitizeRelativeAssetPath accepts and normalizes plain relative paths', () => {
  assert.equal(sanitizeRelativeAssetPath('assets/img/book.jpg'), 'assets/img/book.jpg');
  assert.equal(sanitizeRelativeAssetPath('  assets/img/book.jpg  '), 'assets/img/book.jpg');
});

test('sanitizeRelativeAssetPath trims surrounding whitespace before validating', () => {
  assert.equal(sanitizeRelativeAssetPath('\t\n css/main.css \n'), 'css/main.css');
});

test('sanitizeRelativeAssetPath accepts deep-but-safe nested paths at max length', () => {
  const exact = 'a/'.concat('b'.repeat(MAX_RELATIVE_PATH_LENGTH - 2));
  assert.equal(exact.length, MAX_RELATIVE_PATH_LENGTH);
  assert.equal(sanitizeRelativeAssetPath(exact), exact);
});

test('sanitizeRelativeAssetPath enforces allowedExtensions against the normalized path', () => {
  const pattern = /\.(jpe?g)$/i;
  assert.equal(sanitizeRelativeAssetPath('covers/x.JPG', 'cover', { allowedExtensions: pattern }), 'covers/x.JPG');
  assertValidationError(
    () => sanitizeRelativeAssetPath('covers/x.png', 'cover', { allowedExtensions: pattern }),
    `path must match ${pattern}`,
    'cover'
  );
});

// ---------------------------------------------------------------------------
// sanitizeRelativeAssetPath — traversal attacks
// ---------------------------------------------------------------------------

test('sanitizeRelativeAssetPath rejects bare and chained parent-directory traversal', () => {
  // Bare '..' is caught first by the dot-segment gate; the remaining chains are
  // caught either there or by the posix.normalize containment check below it.
  for (const input of ['..', '../secret.txt', 'a/../../etc/passwd', 'a/../b/c']) {
    let error;
    try {
      sanitizeRelativeAssetPath(input);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof AssetPathValidationError, `expected rejection for ${input}`);
    assert.match(error.reason, /dot segments|traversal/, `unexpected reason for ${input}: ${error.reason}`);
  }
});

test('sanitizeRelativeAssetPath rejects URL-encoded traversal (%2e%2e variants)', () => {
  // Single-encoded dot segments decode into real dot segments and must be refused.
  assertValidationError(
    () => sanitizeRelativeAssetPath('%2e%2e/secret'),
    'dot segments and empty segments are not allowed'
  );
  assertValidationError(
    () => sanitizeRelativeAssetPath('%2E%2E%2Fsecret'),
    'dot segments and empty segments are not allowed'
  );
});

test('sanitizeRelativeAssetPath keeps double-encoded text literal and contained during filesystem resolution', () => {
  // Validation decodes once, but returns the original encoding. The filesystem
  // resolver must preserve that literal segment rather than decode it again.
  const sanitized = sanitizeRelativeAssetPath('safe/%252e%252e/x');
  assert.equal(sanitized, 'safe/%252e%252e/x');
  assert.equal(resolveContainedPath(os.tmpdir(), sanitized), path.join(os.tmpdir(), 'safe', '%252e%252e', 'x'));
});

test('sanitizeRelativeAssetPath rejects single-dot and current-dir segments', () => {
  // ./ normalization is deliberately refused rather than silently applied.
  assertValidationError(
    () => sanitizeRelativeAssetPath('./config.json'),
    'dot segments and empty segments are not allowed'
  );
  assertValidationError(
    () => sanitizeRelativeAssetPath('assets/./x.jpg'),
    'dot segments and empty segments are not allowed'
  );
});

test('sanitizeRelativeAssetPath rejects absolute paths including protocol-relative forms', () => {
  assertValidationError(() => sanitizeRelativeAssetPath('/etc/passwd'), 'path must be relative');
  assertValidationError(() => sanitizeRelativeAssetPath('//evil.com/share/x'), 'path must be relative');
});

test('sanitizeRelativeAssetPath rejects backslashes on posix semantics', () => {
  // Windows separators must not smuggle traversal past posix.split('/').
  assertValidationError(
    () => sanitizeRelativeAssetPath('..\\..\\windows\\system32'),
    'path contains disallowed characters'
  );
  assertValidationError(
    () => sanitizeRelativeAssetPath('assets\\img.jpg'),
    'path contains disallowed characters'
  );
});

test('sanitizeRelativeAssetPath rejects URI schemes including windows drive letters', () => {
  assertValidationError(() => sanitizeRelativeAssetPath('file:///etc/passwd'), 'URI schemes are not allowed');
  assertValidationError(() => sanitizeRelativeAssetPath('javascript:alert(1)'), 'URI schemes are not allowed');
  assertValidationError(() => sanitizeRelativeAssetPath('data:text/html,x'), 'URI schemes are not allowed');
  assertValidationError(() => sanitizeRelativeAssetPath('C:/Windows/system32'), 'URI schemes are not allowed');
});

test('sanitizeRelativeAssetPath rejects queries, fragments, null bytes, and malformed encoding', () => {
  assertValidationError(() => sanitizeRelativeAssetPath('a.jpg?v=2'), 'query strings and fragments are not allowed');
  assertValidationError(() => sanitizeRelativeAssetPath('a.jpg#frag'), 'query strings and fragments are not allowed');
  assertValidationError(() => sanitizeRelativeAssetPath('a\x00.jpg'), 'path contains disallowed characters');
  assertValidationError(() => sanitizeRelativeAssetPath('bad%zz.jpg'), 'path contains invalid URL encoding');
  assertValidationError(() => sanitizeRelativeAssetPath('trailing%.jpg'), 'path contains invalid URL encoding');
});

test('sanitizeRelativeAssetPath rejects empty, whitespace-only, and over-length inputs', () => {
  assertValidationError(() => sanitizeRelativeAssetPath(''), 'path cannot be empty');
  assertValidationError(() => sanitizeRelativeAssetPath('   '), 'path cannot be empty');
  assertValidationError(
    () => sanitizeRelativeAssetPath('a'.repeat(MAX_RELATIVE_PATH_LENGTH + 1)),
    `path exceeds max length ${MAX_RELATIVE_PATH_LENGTH}`
  );
});

test('sanitizeRelativeAssetPath rejects non-string and nullish inputs', () => {
  assertValidationError(() => sanitizeRelativeAssetPath(undefined), 'expected a string path');
  assertValidationError(() => sanitizeRelativeAssetPath(null), 'expected a string path');
  assertValidationError(() => sanitizeRelativeAssetPath(42), 'expected a string path');
  assertValidationError(() => sanitizeRelativeAssetPath({ toString: () => '../x' }), 'expected a string path');
});

// ---------------------------------------------------------------------------
// AssetPathValidationError shape
// ---------------------------------------------------------------------------

test('AssetPathValidationError carries structured fields and default fieldPath', () => {
  try {
    sanitizeRelativeAssetPath('./x');
    assert.fail('expected throw');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(error instanceof AssetPathValidationError);
    assert.equal(error.name, 'AssetPathValidationError');
    assert.equal(error.fieldPath, 'asset');
    assert.equal(error.reason, 'dot segments and empty segments are not allowed');
    assert.equal(String(error), 'AssetPathValidationError: Invalid path at asset: dot segments and empty segments are not allowed');
  }
});

test('AssetPathValidationError propagates caller-supplied fieldPath', () => {
  assertValidationError(() => sanitizeRelativeAssetPath('./x', 'reading.cover'), 'dot segments and empty segments are not allowed', 'reading.cover');
});

// ---------------------------------------------------------------------------
// resolveContainedPath (same module; containment defense-in-depth)
// ---------------------------------------------------------------------------

test('resolveContainedPath resolves safe relatives inside root', () => {
  const root = os.tmpdir();
  const resolved = resolveContainedPath(root, 'assets/img/a.jpg');
  assert.equal(resolved, path.resolve(root, 'assets/img/a.jpg'));
});

test('resolveContainedPath rejects resolution outside root even for pre-sanitized-looking input', () => {
  assertValidationError(
    () => resolveContainedPath(os.tmpdir(), '../../outside.txt', 'cover'),
    'resolved path escapes project root',
    'cover'
  );
});
