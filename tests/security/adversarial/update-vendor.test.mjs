import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureHttpsUrl,
  ensureVendorPath,
  fetchVendorFiles,
  parseArgs
} from '../../../scripts/update-vendor.mjs';

function publicLookup() {
  return [{ address: '142.250.190.27', family: 4 }];
}

function makeManifest(overrides = {}) {
  return {
    dependencies: [
      {
        name: 'workbox',
        version: '9.9.9',
        source: 'https://storage.googleapis.com/workbox-cdn/releases/9.9.9/',
        files: [
          {
            path: 'js/vendor/workbox/test-file.js',
            upstream_url: 'https://storage.googleapis.com/workbox-cdn/releases/9.9.9/test-file.js',
            signatures: ['workbox:test:9.9.9']
          }
        ],
        ...overrides
      }
    ]
  };
}

// parseArgs adversarial cases

test('parseArgs rejects unknown flags and unknown flag values', () => {
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
  assert.throws(() => parseArgs(['--write=1']), /Unknown argument/);
  assert.throws(() => parseArgs(['--timeout-ms=0']), /Unknown argument/);
  assert.throws(() => parseArgs(['--Write']), /Unknown argument/);
  assert.throws(() => parseArgs(['--timeout-ms', '1000', '--today', '--write']), /Expected YYYY-MM-DD value after --today/);
});

test('parseArgs treats duplicate flags by overwriting without error', () => {
  const options = parseArgs(['--timeout-ms', '5000', '--timeout-ms', '7000']);
  assert.equal(options.timeoutMs, 7000);
});

test('parseArgs rejects missing values for flags at end of argv', () => {
  assert.throws(() => parseArgs(['--timeout-ms']), /Expected integer value after --timeout-ms/);
  assert.throws(() => parseArgs(['--today']), /Expected YYYY-MM-DD value after --today/);
});

test('parseArgs rejects zero, negative, and non-numeric timeout values', () => {
  assert.throws(() => parseArgs(['--timeout-ms', '0']), /Timeout must be a positive integer|Expected integer value after --timeout-ms/);
  assert.throws(() => parseArgs(['--timeout-ms', '-5']), /Expected integer value after --timeout-ms/);
  assert.throws(() => parseArgs(['--timeout-ms', 'abc']), /Expected integer value after --timeout-ms/);
  assert.throws(() => parseArgs(['--timeout-ms', '12.5']), /Expected integer value after --timeout-ms/);
  assert.throws(() => parseArgs(['--timeout-ms', '1e3']), /Expected integer value after --timeout-ms/);
});

// ensureHttpsUrl edge forms

test('ensureHttpsUrl rejects IPv6 literal hosts outside the allowlist', () => {
  assert.throws(
    () => ensureHttpsUrl('https://[2001:4860:4860::8888]/file.js', 'file.upstream_url'),
    /host 2001:4860:4860::8888 is not in the allowed upstream host list/
  );
});

test('ensureHttpsUrl rejects userinfo in URLs', () => {
  assert.throws(
    () => ensureHttpsUrl('https://user:pass@storage.googleapis.com/file.js', 'file.upstream_url'),
    /credentials in URL are not allowed/
  );
});

test('ensureHttpsUrl normalizes the default https port on allowed hosts', () => {
  const url = ensureHttpsUrl('https://storage.googleapis.com:443/file.js', 'file.upstream_url');
  const parsed = new URL(url);
  assert.equal(parsed.hostname, 'storage.googleapis.com');
  assert.equal(parsed.port, '');
  assert.equal(parsed.pathname, '/file.js');
});

test('ensureHttpsUrl accepts trailing-dot hostnames via canonical host matching', () => {
  const url = ensureHttpsUrl('https://storage.googleapis.com./file.js', 'file.upstream_url');
  assert.equal(url, 'https://storage.googleapis.com./file.js');
});

test('ensureHttpsUrl rejects non-https schemes and disallowed hosts', () => {
  assert.throws(() => ensureHttpsUrl('http://storage.googleapis.com/file.js', 'file.upstream_url'), /only https URLs are allowed/);
  assert.throws(() => ensureHttpsUrl('https://evil.example.com/file.js', 'file.upstream_url'), /not in the allowed upstream host list/);
});

// ensureVendorPath deep traversal

test('ensureVendorPath rejects deep traversal inside js/vendor prefix', () => {
  assert.throws(
    () => ensureVendorPath('js/vendor/a/b/../../../etc/passwd', 'file.path'),
    /must already be normalized/
  );
  assert.throws(
    () => ensureVendorPath('js/vendor/../../etc/passwd', 'file.path'),
    /must already be normalized/
  );
});

test('ensureVendorPath rejects absolute and backslash paths', () => {
  assert.throws(() => ensureVendorPath('/etc/passwd', 'file.path'), /expected relative path/);
  assert.throws(() => ensureVendorPath('js/vendor\\..\\..\\etc\\passwd', 'file.path'), {
    message: 'Invalid manifest at file.path: path must not contain backslashes'
  });
});

test('ensureVendorPath rejects empty and dot-only segments', () => {
  assert.throws(() => ensureVendorPath('', 'file.path'), /expected non-empty string/);
  assert.throws(() => ensureVendorPath('.', 'file.path'), /path must stay under js\/vendor\//);
});

test('ensureVendorPath accepts a normal nested vendor path unchanged', () => {
  assert.equal(
    ensureVendorPath('js/vendor/workbox/deep/nested/file.js', 'file.path'),
    'js/vendor/workbox/deep/nested/file.js'
  );
});

// fetchVendorFiles mocked-fetch edge cases

test.todo('BUG: fetchVendorFiles accepts truncated bodies that violate declared content-length', async () => {
  // The injected transport bounds streamed bytes but does not compare the final
  // byte count with Content-Length. A signature-bearing prefix is still accepted.
  // Keep this existing TODO visible until transport-independent integrity holds.
  const body = Buffer.from('/* workbox:test:9.9.9 */');
  const options = { lookupImpl: publicLookup, timeoutMs: 5000 };
  const complete = await fetchVendorFiles(makeManifest(), {
    ...options,
    fetchImpl: async () => new Response(body, {
      status: 200,
      headers: { 'content-length': String(body.length) }
    })
  });
  assert.equal(complete.length, 1, 'valid manifest and complete body must reach the download path');
  assert.deepEqual(complete[0].bytes, body);

  let fetchCalls = 0;
  try {
    await assert.rejects(
      () => fetchVendorFiles(makeManifest(), {
        ...options,
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response(body, {
            status: 200,
            headers: { 'content-length': String(body.length + 4096) }
          });
        }
      }),
      /Content-Length/i
    );
  } finally {
    assert.equal(fetchCalls, 1, 'truncation probe must reach the injected transport');
  }
});
