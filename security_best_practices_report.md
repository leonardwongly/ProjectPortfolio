# Security Best Practices Report

Date: 2026-04-08
Repository: `/Users/leonardwongly/Developer/ProjectPortfolio`

## Executive Summary

I did not find a confirmed exploitable first-party vulnerability in the current repository state. The main trust boundaries are reasonably well defended: generated content is validated before render, runtime pages ship with a restrictive CSP and related headers, service-worker activation validates message origin and schema, vendored assets are now hash-verified with freshness enforcement, a reproducible refresh path, and scheduled upstream-version review, and the security regression suite currently passes.

The original lower-severity risks have been reduced. The manually maintained CSP hash and duplicate service-worker update path are now remediated in-repo. The remaining risk is narrower: vendored browser code still requires periodic human review of upstream releases, but drift is now guarded by explicit digests, declared upstream URLs, inventory enforcement, review-age checks, a deterministic refresh workflow, and a scheduled upstream-version check.

## Scope

- Static frontend runtime (`index.html`, `js/main.js`, `js/site.js`)
- Service worker (`pwabuilder-sw.js`)
- Build pipeline validation (`scripts/build.js`)
- Vendored browser assets (`js/vendor/*`)
- Runtime edge policy (`_headers`)
- Security regression tests (`tests/security/*.mjs`)
- Current live deployment headers for `https://leonardwong.tech/`

## Methodology

1. Reviewed the JavaScript frontend and service-worker trust boundaries.
2. Reviewed the build pipeline for input validation, path handling, and output encoding.
3. Checked security-sensitive vendored assets and governance metadata.
4. Verified the current header policy in-repo and on the live deployment.
5. Ran the repository security test suite.

## Trust Boundaries Reviewed

- Untrusted inputs:
  - JSON/content data consumed by the build pipeline
  - Query-string state read by the frontend
  - Browser `message` events sent to the service worker
  - Third-party vendored JavaScript checked into the repository
- Trusted outputs:
  - Generated HTML files
  - Runtime headers from `_headers`
  - Service-worker lifecycle actions
  - CI security regression results

## Findings

## No Critical Or High Findings

No currently reviewed path showed a confirmed direct exploit such as first-party XSS, open redirect, path traversal to arbitrary file read/write, or unsafe service-worker message handling.

## Medium Severity

### SBP-101: Vendored browser dependencies still rely on manual upstream review, but governance is now materially stronger and reproducible

Impact: if an upstream client-side security issue is disclosed, production still depends on maintainers deciding to review and refresh vendored code because the assets remain outside a package-manager advisory flow. The exposure window is now smaller because stale review dates, undeclared files, content drift, upstream mismatch, and newer npm releases now fail locally or in scheduled CI review.

Evidence:
- `docs/security/vendor-dependencies.json:2`
- `docs/security/vendor-dependencies.json:7`
- `js/vendor/workbox-sw.js:1`
- `scripts/check-vendor-governance.mjs:1`
- `.github/workflows/vendor-review.yml:1`
- `scripts/check-vendor-upstream.mjs:1`
- `scripts/update-vendor.mjs:1`
- `tests/security/vendor-governance.test.mjs:5`
- `tests/security/vendor-refresh.test.mjs:1`

Why this matters:
- The vendored inventory is now narrowed to Workbox assets that are actively used by the site.
- Each tracked file is pinned by SHA-256 digest and signature markers, the manifest records exact upstream HTTPS URLs, the refresh script can deterministically refetch those assets, the manifest enforces a maximum review age, and unexpected additions under `js/vendor/` now fail validation.
- A dedicated upstream-version check now compares the pinned Workbox package against the latest npm release on a weekly schedule and manual dispatch.
- The currently vendored Workbox payload has been refreshed to `7.4.0`, matching the latest npm release observed during this review on 2026-04-08.
- Because the assets are still vendored outside a package manager, they do not naturally participate in lockfile review, advisory scanning, or routine dependency update workflows.

Recommended fixes:
1. Keep `node scripts/check-vendor-upstream.mjs`, `node scripts/update-vendor.mjs`, and `node scripts/check-vendor-governance.mjs` in the maintainer workflow and CI so newer upstream releases, stale reviews, and upstream drift fail closed.
2. During each review, confirm whether newer upstream Workbox releases contain security fixes and update the manifest review date only after that check is complete.
3. If deeper advisory automation becomes necessary later, move the remaining vendored browser code to a package-managed flow with a committed lockfile.

## Low Severity

### SBP-102: Resolved in-repo: CSP hash is now generated instead of manually maintained

Impact before fix: a content-only edit to structured data required coordinated CSP hash updates in multiple places, which increased the chance of policy drift or a later decision to weaken `script-src` for convenience.

Evidence:
- `src/index.html:6`
- `src/_headers.template:9`
- `scripts/build.js:30`
- `scripts/build.js:49`
- `tests/security/policy-regression.test.mjs:69`

Resolution:
- The inline JSON-LD hash is now computed during the build and injected into both generated `index.html` and `_headers`.
- `_headers` is generated from `src/_headers.template`, removing the duplicated hardcoded hash from the repo-maintained source files.
- Regression coverage now recomputes the expected hash and asserts it appears in both runtime policy locations.

Residual risk:
- The site still depends on a build step to refresh generated files after source edits. That is operationally normal for this repo, and the regression tests now make drift visible.

### SBP-103: Resolved in-repo: duplicate service-worker update path removed

Impact before fix: overlapping update mechanisms increased the odds that a future edit would weaken or break service-worker activation behavior, especially if one path kept the stronger validation and the other quietly bypassed it.

Evidence:
- `js/main.js:336`
- `js/main.js:353`
- `pwabuilder-sw.js:12`
- `pwabuilder-sw.js:43`
- `tests/security/policy-regression.test.mjs:128`

Resolution:
- The dead `pwa-update` client path and its vendored dependency were removed from the repo.
- The active service-worker registration and activation logic now lives only in `js/main.js`, using the hardened tokened flow expected by `pwabuilder-sw.js`.
- Regression coverage now asserts that the legacy `pwa-update` files are absent and the single first-party registration path remains present.

Residual risk:
- Future service-worker changes still need review because update flows are security-sensitive, but the trust model is now materially simpler.

## Positive Controls Already In Place

These were reviewed and look materially sound:

- Build-time URL and path validation reject traversal, unsafe schemes, credentials in URLs, and malformed relative paths:
  - `scripts/build.js:90`
  - `scripts/build.js:141`
  - `scripts/build.js:163`
  - `scripts/build.js:193`
- Service-worker activation checks both payload shape and same-origin source before `skipWaiting()`:
  - `pwabuilder-sw.js:15`
  - `pwabuilder-sw.js:27`
  - `pwabuilder-sw.js:43`
- Vendored dependency governance now verifies declared inventory, digests, signature markers, review age, and reproducible upstream refresh:
  - `scripts/check-vendor-governance.mjs:1`
  - `scripts/check-vendor-upstream.mjs:1`
  - `scripts/update-vendor.mjs:1`
  - `docs/security/vendor-dependencies.json:1`
- Runtime headers are present in repo and currently live:
  - `_headers:1`
  - `_headers:9`
- Regression tests cover workflow pinning, CSP presence, header presence, dangerous schemes, and service-worker message validation:
  - `tests/security/policy-regression.test.mjs:26`
  - `tests/security/policy-regression.test.mjs:70`
  - `tests/security/policy-regression.test.mjs:98`
  - `tests/security/service-worker-message.test.mjs:5`

## Live Verification

Manual header verification was rerun on 2026-04-08 for:

- `https://leonardwong.tech/`
- `https://leonardwong.tech/reading`
- `https://leonardwong.tech/offline`

Observed headers now include:

- `Strict-Transport-Security`
- `Content-Security-Policy`
- `Permissions-Policy`
- `Referrer-Policy`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Access-Control-Allow-Origin: https://leonardwong.tech`

This means the deployment-side header gap documented in `docs/security/security-review-2026-02-06.md` is no longer current as of 2026-04-08.

## Verification Results

Command run:

```bash
node scripts/check-vendor-governance.mjs
node scripts/update-vendor.mjs
node scripts/check-vendor-upstream.mjs
node --test tests/security/*.mjs
bash scripts/security-smoke.sh
```

Result:

- `node scripts/check-vendor-governance.mjs`: passed
- `node scripts/update-vendor.mjs`: passed in dry-run mode; vendored files already match declared upstream payloads
- `node scripts/check-vendor-upstream.mjs`: passed; as of 2026-04-08, `workbox-sw` is pinned at `7.4.0`, matching npm `latest`
- `node --test tests/security/*.mjs`: `43` passed, `0` failed
- `bash scripts/security-smoke.sh`: passed

## Recommended Next Steps

1. Keep the vendor review cadence active so the reproducible refresh path remains operational rather than becoming stale process documentation.
2. Keep the new CSP generation path build-owned; do not reintroduce hand-maintained hashes in source files.
3. Keep service-worker update logic consolidated in `js/main.js` unless a second path is intentionally designed and tested against the same trust contract.
