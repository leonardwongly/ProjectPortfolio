import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const GOVERNANCE_FILE = 'docs/security/vendor-dependencies.json';

test('vendor dependency governance manifest is present and valid', () => {
  const content = fs.readFileSync(GOVERNANCE_FILE, 'utf8');
  const parsed = JSON.parse(content);

  assert.equal(typeof parsed.last_reviewed, 'string');
  assert.equal(typeof parsed.review_cadence, 'string');
  assert.equal(typeof parsed.max_review_age_days, 'number');
  assert.ok(Array.isArray(parsed.dependencies));
  assert.ok(parsed.dependencies.length >= 1);
  assert.ok(
    parsed.dependencies.every((dependency) =>
      typeof dependency.registry_package === 'string' && dependency.registry_package.length > 0
    )
  );
  assert.ok(
    parsed.dependencies.every((dependency) =>
      Array.isArray(dependency.files) &&
      dependency.files.every((file) => typeof file.upstream_url === 'string' && file.upstream_url.startsWith('https://'))
    )
  );
});

test('vendored dependency governance validates digests, freshness, and inventory', async () => {
  const { loadManifest, validateVendorGovernance } = await import('../../scripts/check-vendor-governance.mjs');
  const result = validateVendorGovernance(loadManifest(), { today: '2026-07-01' });

  assert.equal(result.reviewAgeDays, 0);
  assert.deepEqual(result.declaredFiles, result.actualFiles);
});

test('vendored dependency governance rejects stale reviews', async () => {
  const { loadManifest, validateVendorGovernance } = await import('../../scripts/check-vendor-governance.mjs');
  const manifest = loadManifest();

  assert.throws(
    () => validateVendorGovernance(manifest, { today: '2026-08-16' }),
    /review age is \d+ day\(s\), exceeding 45 day\(s\)/
  );
});
