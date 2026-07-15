import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-ops-'));
}

function writeFile(rootDir, relativePath, content = '') {
  const absolutePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function writePerformanceFixture(rootDir, overrides = {}) {
  [
    'index.html',
    'work.html',
    'case-study-agentforge.html',
    'case-study-agentic.html',
    'case-study-apple-calendar-mcp.html',
    'reading.html',
    'offline.html',
    'css/custom.css',
    'css/case-study.css',
    'js/main.js',
    'js/site.js',
    'pwabuilder-sw.js',
    'book/.keep',
    'fonts/.keep',
    'images/.keep',
    'js/vendor/.keep'
  ].forEach((relativePath) => {
    writeFile(rootDir, relativePath, overrides[relativePath] ?? 'ok');
  });
}

test('reading metadata audit detects missing fields, duplicate records, missing covers, and duplicate cover files', async () => {
  const { auditReadingMetadata } = await import('../../scripts/audit-reading-metadata.mjs');
  const rootDir = makeTempRoot();
  writeFile(rootDir, 'book/2026/a.jpg', 'cover');
  writeFile(rootDir, 'book/2026/b.jpg', 'same-cover');
  writeFile(rootDir, 'book/2026/c.jpg', 'same-cover');

  const findings = auditReadingMetadata([
    {
      title: 'Safe Systems',
      author: 'Ada Lovelace',
      year: '2026',
      isbn: '9780000000001',
      cover: 'book/2026/a.jpg'
    },
    {
      title: 'Safe Systems',
      author: '',
      year: '2026',
      isbn: '9780000000001',
      cover: 'book/2026/missing.jpg'
    },
    {
      title: 'Different Cover Record',
      author: 'Grace Hopper',
      year: '2026',
      isbn: '9780000000002',
      cover: 'book/2026/b.jpg'
    },
    {
      title: 'Duplicate Cover Record',
      author: 'Katherine Johnson',
      year: '2026',
      isbn: '9780000000003',
      cover: 'book/2026/c.jpg'
    }
  ], { rootDir });

  assert.ok(findings.some((finding) => finding.includes('missing author')));
  assert.ok(findings.some((finding) => finding.includes('duplicate isbn')));
  assert.ok(findings.some((finding) => finding.includes('declared cover is missing')));
  assert.ok(findings.some((finding) => finding.includes('cover duplicates')));
});

test('performance budget check reports clean fixtures and oversized generated files', async () => {
  const { checkPerformanceBudget, collectRenderedAssetReferences, createAssetInventoryReport } = await import('../../scripts/check-performance-budget.mjs');
  const rootDir = makeTempRoot();

  writePerformanceFixture(rootDir);
  writeFile(rootDir, 'book/large-cover.jpg', Buffer.alloc(500, 'a'));
  writeFile(rootDir, 'book/large-cover-2x.jpg', Buffer.alloc(500, 'b'));
  writeFile(rootDir, 'reading.html', '<img src="book/large-cover.jpg" srcset="book/large-cover.jpg 1x, book/large-cover-2x.jpg 2x">');
  writeFile(rootDir, 'images/logo.png', Buffer.alloc(100, 'a'));
  assert.deepEqual(checkPerformanceBudget({ rootDir }).failures, []);
  assert.deepEqual(collectRenderedAssetReferences(fs.readFileSync(path.join(rootDir, 'reading.html'), 'utf8')), {
    references: ['book/large-cover.jpg', 'book/large-cover-2x.jpg'],
    highDpiReferences: ['book/large-cover-2x.jpg']
  });
  assert.deepEqual(createAssetInventoryReport({ rootDir, limit: 2 }).largestFiles, [
    { path: 'book/large-cover-2x.jpg', size: 500 },
    { path: 'book/large-cover.jpg', size: 500 }
  ]);

  writePerformanceFixture(rootDir, {
    'index.html': Buffer.alloc(91 * 1024, 'a')
  });
  const result = checkPerformanceBudget({ rootDir });

  assert.ok(result.failures.some((failure) => failure.includes('index.html')));
});

test('performance budget rejects unreferenced deployed assets', async () => {
  const { checkPerformanceBudget } = await import('../../scripts/check-performance-budget.mjs');
  const rootDir = makeTempRoot();

  writePerformanceFixture(rootDir);
  writeFile(rootDir, 'css/bootstrap-grid.min.css', 'unused');
  writeFile(rootDir, 'js/bootstrap.bundle.min.js', 'unused');
  writeFile(rootDir, 'fonts/SF-Pro-Display-Black.otf', 'unused');
  writeFile(rootDir, 'book/large-original.jpg', Buffer.alloc(600 * 1024, 'a'));
  writeFile(rootDir, 'reading.html', '<img src="book/large-cover.jpg">');

  const result = checkPerformanceBudget({ rootDir });

  assert.ok(result.failures.some((failure) => failure.includes('css/bootstrap-grid.min.css')));
  assert.ok(result.failures.some((failure) => failure.includes('js/bootstrap.bundle.min.js')));
  assert.ok(result.failures.some((failure) => failure.includes('fonts/SF-Pro-Display-Black.otf')));
  assert.ok(result.failures.some((failure) => failure.includes('book/large-original.jpg')));
});

test('link health validator rejects unsafe URL shapes before network access', async () => {
  const { validateExternalUrl } = await import('../../scripts/check-link-health.mjs');

  assert.equal(validateExternalUrl('https://example.com/path#fragment', 'fixture').ok, true);
  assert.equal(validateExternalUrl('http://example.com', 'fixture').ok, false);
  assert.equal(validateExternalUrl('https://user:pass@example.com', 'fixture').ok, false);
  assert.equal(validateExternalUrl('https://localhost/status', 'fixture').ok, false);
  assert.equal(validateExternalUrl('https://127.0.0.1/status', 'fixture').ok, false);
  assert.equal(validateExternalUrl('https://[::1]/status', 'fixture').ok, false);
  assert.equal(validateExternalUrl('https://[fd00::1]/status', 'fixture').ok, false);
  assert.equal(validateExternalUrl('https://192.168.0.10/status', 'fixture').ok, false);
  assert.equal(validateExternalUrl('notaurl', 'fixture').category, 'invalid-url');
});

test('network safety rejects private and reserved DNS answers before fetch', async () => {
  const {
    assertPublicHttpsUrl,
    isBlockedIpAddress
  } = await import('../../scripts/lib/network-safety.mjs');

  assert.equal(isBlockedIpAddress('10.0.0.1'), true);
  assert.equal(isBlockedIpAddress('100.64.0.1'), true);
  assert.equal(isBlockedIpAddress('169.254.169.254'), true);
  assert.equal(isBlockedIpAddress('198.51.100.10'), true);
  assert.equal(isBlockedIpAddress('8.8.8.8'), false);
  assert.equal(isBlockedIpAddress('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedIpAddress('2001:db8::1'), true);
  assert.equal(isBlockedIpAddress('2606:4700:4700::1111'), false);

  await assert.rejects(
    () => assertPublicHttpsUrl('https://private.example/status', {
      lookupImpl: async () => [{ address: '10.0.0.5', family: 4 }]
    }),
    /resolved to blocked address 10\.0\.0\.5/
  );

  await assert.rejects(
    () => assertPublicHttpsUrl('https://mixed.example/status', {
      lookupImpl: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: 'fd00::1', family: 6 }
      ]
    }),
    /resolved to blocked address fd00::1/
  );

  assert.equal(
    await assertPublicHttpsUrl('https://public.example/status', {
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }]
    }),
    'https://public.example/status'
  );
});

test('assertPublicDnsResolution returns the resolved DNS records for reuse by callers', async () => {
  const { assertPublicDnsResolution, normalizePublicHttpsUrl } = await import('../../scripts/lib/network-safety.mjs');
  const parsed = normalizePublicHttpsUrl('https://public.example/status');

  const records = await assertPublicDnsResolution(parsed, {
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }]
  });

  assert.deepEqual(records, [{ address: '93.184.216.34', family: 4 }]);
});

test('resolvePublicHttpsUrl pins IPv4/IPv6 literal hosts without performing DNS resolution', async () => {
  const { resolvePublicHttpsUrl } = await import('../../scripts/lib/network-safety.mjs');
  const refuseDns = async () => {
    throw new Error('DNS should not be queried for IP literals');
  };

  assert.deepEqual(
    await resolvePublicHttpsUrl('https://93.184.216.34/status', { lookupImpl: refuseDns }),
    {
      url: 'https://93.184.216.34/status',
      hostname: '93.184.216.34',
      records: [{ address: '93.184.216.34', family: 4 }]
    }
  );

  assert.deepEqual(
    await resolvePublicHttpsUrl('https://[2606:4700:4700::1111]/status', { lookupImpl: refuseDns }),
    {
      url: 'https://[2606:4700:4700::1111]/status',
      hostname: '2606:4700:4700::1111',
      records: [{ address: '2606:4700:4700::1111', family: 6 }]
    }
  );
});

test('resolvePublicHttpsUrl resolves hostnames through DNS and exposes the approved records', async () => {
  const { resolvePublicHttpsUrl } = await import('../../scripts/lib/network-safety.mjs');

  const target = await resolvePublicHttpsUrl('https://public.example/status', {
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }]
  });

  assert.deepEqual(target, {
    url: 'https://public.example/status',
    hostname: 'public.example',
    records: [{ address: '93.184.216.34', family: 4 }]
  });
});

test('resolvePublicHttpsUrl rejects hostnames that resolve to blocked addresses', async () => {
  const { resolvePublicHttpsUrl } = await import('../../scripts/lib/network-safety.mjs');

  await assert.rejects(
    () => resolvePublicHttpsUrl('https://private.example/status', {
      lookupImpl: async () => [{ address: '10.0.0.5', family: 4 }]
    }),
    /resolved to blocked address 10\.0\.0\.5/
  );
});

test('link health preflight mode validates DNS without fetching URLs', async () => {
  const { runLinkHealth } = await import('../../scripts/check-link-health.mjs');
  const results = await runLinkHealth({
    preflightOnly: true,
    strict: true,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => {
      throw new Error('fetch should not run in preflight-only mode');
    }
  });

  assert.ok(results.length > 0);
  assert.ok(results.every((result) => result.ok || result.category === 'unsafe-url'));
  assert.ok(results.some((result) => result.category === 'preflight-ok'));
});

test('link health binds the approved DNS address to the TLS request', async () => {
  const { createPinnedLookup, requestWithTimeout } = await import('../../scripts/check-link-health.mjs');
  const lookup = createPinnedLookup([{ address: '93.184.216.34', family: 4 }]);

  const selected = await new Promise((resolve, reject) => {
    lookup('public.example', { family: 4 }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(selected, { address: '93.184.216.34', family: 4 });

  const all = await new Promise((resolve, reject) => {
    lookup('public.example', { all: true }, (error, records) => {
      if (error) reject(error);
      else resolve(records);
    });
  });
  assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }]);

  let requestOptions;
  const response = await requestWithTimeout({
    url: 'https://public.example/status',
    hostname: 'public.example',
    records: [{ address: '93.184.216.34', family: 4 }]
  }, {
    method: 'HEAD',
    timeoutMs: 1000,
    requestImpl: (_url, options, onResponse) => {
      requestOptions = options;
      return {
        setTimeout() {},
        once() {},
        destroy() {},
        end() {
          onResponse({
            statusCode: 204,
            statusMessage: 'No Content',
            resume() {}
          });
        }
      };
    }
  });
  assert.deepEqual(response, { status: 204, statusText: 'No Content' });
  assert.equal(requestOptions.servername, 'public.example');
  assert.equal(typeof requestOptions.lookup, 'function');
});

test('createPinnedLookup selects the approved record for numeric and object family requests', async () => {
  const { createPinnedLookup } = await import('../../scripts/check-link-health.mjs');
  const lookup = createPinnedLookup([
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 }
  ]);

  const numericFamily = await new Promise((resolve, reject) => {
    lookup('public.example', 6, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(numericFamily, { address: '2606:4700:4700::1111', family: 6 });

  const noFamilyRequested = await new Promise((resolve, reject) => {
    lookup('public.example', {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(noFamilyRequested, { address: '93.184.216.34', family: 4 });
});

test('createPinnedLookup rejects when no approved address matches the requested family', async () => {
  const { createPinnedLookup } = await import('../../scripts/check-link-health.mjs');
  const lookup = createPinnedLookup([{ address: '93.184.216.34', family: 4 }]);

  await assert.rejects(
    () => new Promise((resolve, reject) => {
      lookup('public.example', { family: 6 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
    /No approved DNS address matches family 6/
  );
});

test('requestWithTimeout rejects with an AbortError when the socket exceeds the deadline', async () => {
  const { requestWithTimeout } = await import('../../scripts/check-link-health.mjs');
  let timeoutCallback;
  let errorHandler;
  const mockRequest = {
    setTimeout(_ms, cb) { timeoutCallback = cb; },
    once(event, cb) { if (event === 'error') errorHandler = cb; },
    destroy(error) { errorHandler(error); },
    end() { timeoutCallback(); }
  };

  await assert.rejects(
    () => requestWithTimeout({
      url: 'https://public.example/status',
      hostname: 'public.example',
      records: [{ address: '93.184.216.34', family: 4 }]
    }, {
      method: 'HEAD',
      timeoutMs: 5,
      requestImpl: () => mockRequest
    }),
    (error) => error.name === 'AbortError' && /timed out after 5ms/.test(error.message)
  );
});

test('requestWithTimeout propagates transport errors from the underlying request', async () => {
  const { requestWithTimeout } = await import('../../scripts/check-link-health.mjs');
  let errorHandler;
  const mockRequest = {
    setTimeout() {},
    once(event, cb) { if (event === 'error') errorHandler = cb; },
    destroy() {},
    end() { errorHandler(new Error('socket hang up')); }
  };

  await assert.rejects(
    () => requestWithTimeout({
      url: 'https://public.example/status',
      hostname: 'public.example',
      records: [{ address: '93.184.216.34', family: 4 }]
    }, {
      method: 'GET',
      timeoutMs: 1000,
      requestImpl: () => mockRequest
    }),
    /socket hang up/
  );
});

test('repository hygiene detects junk files in git-visible paths', async () => {
  const { isJunkPath } = await import('../../scripts/check-repository-hygiene.mjs');

  assert.equal(isJunkPath('.github/workflows/.DS_Store'), true);
  assert.equal(isJunkPath('notes/debug.log'), true);
  assert.equal(isJunkPath('src/index.html'), false);
});

test('repository hygiene detects ignored junk files in authored directories', async () => {
  const { collectRepositoryHygieneFindings } = await import('../../scripts/check-repository-hygiene.mjs');
  const rootDir = makeTempRoot();

  writeFile(rootDir, '.gitignore', '.DS_Store\nnode_modules/\n');
  writeFile(rootDir, '.github/workflows/.DS_Store');
  writeFile(rootDir, 'docs/.DS_Store');
  writeFile(rootDir, 'node_modules/.DS_Store');
  writeFile(rootDir, 'src/index.html', '<main></main>');
  execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });

  const findings = collectRepositoryHygieneFindings({ cwd: rootDir });

  assert.deepEqual(findings, [
    '.github/workflows/.DS_Store',
    'docs/.DS_Store'
  ]);
});

test('workflow hygiene enforces pinned actions and safe npm installs', async () => {
  const { collectWorkflowHygieneFindings } = await import('../../scripts/check-workflow-hygiene.mjs');

  assert.deepEqual(collectWorkflowHygieneFindings(), []);
});

test('production smoke validator reports missing headers and markers', async () => {
  const { validatePage } = await import('../../scripts/check-production-smoke.mjs');
  const headers = new Headers({
    'content-security-policy': "default-src 'self'",
    'x-content-type-options': 'nosniff'
  });

  assert.deepEqual(
    validatePage({
      url: 'https://example.test/reading',
      response: { status: 200, headers },
      body: '<h1>Reading</h1>',
      check: {
        marker: /Reading/i,
        headers: ['content-security-policy', 'x-content-type-options']
      }
    }),
    []
  );

  assert.ok(
    validatePage({
      url: 'https://example.test/offline',
      response: { status: 200, headers: new Headers() },
      body: '<h1>Unexpected</h1>',
      check: {
        marker: /Offline/i,
        headers: ['content-security-policy', 'x-content-type-options']
      }
    }).length > 0
  );
});

test('telemetry policy check rejects external runtime analytics adapters', async () => {
  const { collectTelemetryPolicyFindings } = await import('../../scripts/check-telemetry-policy.mjs');

  assert.deepEqual(collectTelemetryPolicyFindings(), []);
});
