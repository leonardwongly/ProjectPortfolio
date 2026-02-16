# Security Best Practices Report

## Executive Summary
This implementation pass hardened the repository to be secure-by-default for Cloudflare Pages deployment and local tooling. Key upgrades include repository-managed response headers (`_headers`), strict style CSP (`style-src 'self'`), removal of runtime inline style mutations in first-party JS, service-worker message validation before `skipWaiting`, and strict path sanitization in `scripts/generate-book-webp.js` to prevent traversal and scheme abuse. Security regression coverage was expanded and currently passes end-to-end.

## Scope
- Frontend runtime policies and scripts
- Service worker trust boundary
- Local image conversion tooling (`generate-book-webp.js`)
- Vendored dependency governance
- Security regression tests and smoke checks

## Findings Status

### Resolved

#### SBP-001 (Resolved): Header-level CSP and frame protections now repo-managed
- **Severity (before)**: Medium
- **Evidence of fix**:
  - `/Users/leonardwongly/Developer/ProjectPortfolio/_headers:9`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/_headers:5`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/_headers:6`
- **What changed**:
  - Added Cloudflare Pages header config with `Content-Security-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Referrer-Policy`, and `X-Content-Type-Options`.

#### SBP-002 (Resolved): `style-src 'unsafe-inline'` removed from source templates
- **Severity (before)**: Medium
- **Evidence of fix**:
  - `/Users/leonardwongly/Developer/ProjectPortfolio/src/index.html:6`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/src/reading.html:6`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/src/offline.html:6`
- **What changed**:
  - Source CSP policies now use `style-src 'self'`.

#### SBP-003 (Resolved): First-party runtime no longer writes inline style attributes
- **Severity (before)**: Medium
- **Evidence of fix**:
  - `/Users/leonardwongly/Developer/ProjectPortfolio/js/main.js:14`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/js/main.js:251`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/js/site.js:40`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/css/custom.css:911`
- **What changed**:
  - Replaced dynamic CSS variable style writes with class-driven reveal delay and pointer effects.
  - Disabled Bootstrap JS and PWA update widget script inclusion from source templates to avoid third-party runtime style injection.

#### SBP-004 (Resolved): Service-worker `SKIP_WAITING` handling now validates source and payload
- **Severity (before)**: Low
- **Evidence of fix**:
  - `/Users/leonardwongly/Developer/ProjectPortfolio/pwabuilder-sw.js:13`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/pwabuilder-sw.js:15`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/pwabuilder-sw.js:27`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/pwabuilder-sw.js:44`
- **What changed**:
  - Added schema validation (`type` + token regex) and source validation (same-origin window client) before calling `skipWaiting`.

#### SBP-005 (Resolved): Path traversal and scheme abuse hardened in local WebP generator
- **Severity (before)**: Medium
- **Evidence of fix**:
  - `/Users/leonardwongly/Developer/ProjectPortfolio/scripts/generate-book-webp.js:16`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/scripts/generate-book-webp.js:71`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/scripts/generate-book-webp.js:180`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/scripts/generate-book-webp.js:214`
- **What changed**:
  - Added strict relative path sanitizer, root containment checks, and exported helpers for deterministic security tests.
  - Invalid paths are skipped with warnings instead of unsafe processing.

#### SBP-006 (Resolved): Vendored dependency governance added
- **Severity (before)**: Low
- **Evidence of fix**:
  - `/Users/leonardwongly/Developer/ProjectPortfolio/docs/security/vendor-dependencies.json:1`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/docs/security/vendor-dependencies.md:1`
  - `/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/vendor-governance.test.mjs:1`
- **What changed**:
  - Added formal inventory, cadence, and signature-based checks to detect drift.

### Residual / Operational

#### SBP-007 (Operational): Header hardening requires deployment verification
- **Severity**: Medium (until verified in production)
- **Evidence**:
  - Policy now exists in repo: `/Users/leonardwongly/Developer/ProjectPortfolio/_headers:1`
  - Verification procedure: `/Users/leonardwongly/Developer/ProjectPortfolio/docs/security/deployment-headers.md:1`
- **Impact**:
  - Protections are only effective after Cloudflare Pages deploys the committed `_headers` policy.
- **Required follow-up**:
  - Run live `curl -I` verification after deployment.

## Test Coverage Added/Updated
- `_headers` required header assertions:
  - `/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/policy-regression.test.mjs:69`
- CSP strict style assertions:
  - `/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/policy-regression.test.mjs:56`
- No inline style attributes in generated HTML:
  - `/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/policy-regression.test.mjs:111`
- Tooling abuse cases (`../`, encoded traversal, absolute/scheme, non-JPEG):
  - `/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/generate-book-webp-security.test.mjs:1`
- Service-worker message hardening assertions:
  - `/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/service-worker-message.test.mjs:1`
- Vendored dependency governance checks:
  - `/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/vendor-governance.test.mjs:1`

## Verification Results
- `node --test tests/security/*.mjs`
  - Result: **24 passed, 0 failed**
- `bash scripts/security-smoke.sh`
  - Result: **passed**

## Final Notes
- Build output still reports two missing optional book-cover assets, which is unrelated to the new security controls.
- Deployment verification remains mandatory to confirm runtime headers are present on `https://leonardwong.tech`.
