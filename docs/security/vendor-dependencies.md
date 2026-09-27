# Vendored Dependency Governance

This file tracks locally vendored browser dependencies under `js/vendor/` and the pinned Bootstrap CSS asset.

## Review policy

- Cadence: monthly
- Last reviewed: 2026-09-21 (UTC)
- Maximum review age: 45 days
- Owner: repository maintainers

Review evidence: checked the [Workbox 7.4.1 release notes](https://github.com/GoogleChrome/workbox/releases/tag/v7.4.1), confirmed it remains the latest npm release, and verified all five vendored files match their declared upstream CDN bytes. No vendored code or digest changed.

## Current inventory

1. `workbox` (`7.4.1`)
   Source: `https://storage.googleapis.com/workbox-cdn/releases/7.4.1/`
   Files:
   - `js/vendor/workbox-sw.js`
   - `js/vendor/workbox/workbox-core.prod.js`
   - `js/vendor/workbox/workbox-navigation-preload.prod.js`
   - `js/vendor/workbox/workbox-routing.prod.js`
   - `js/vendor/workbox/workbox-strategies.prod.js`

2. `bootstrap` CSS (`5.3.8`)
   Source: `https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css`
   File: `css/bootstrap.min.css`
   Local SHA-256: `8f8173cb2d8f867274aeb0cb15328e60f490c7f272351e51a55f1dabb486e4ff`
   Reviewed: 2026-09-27 (UTC)

   The committed CSS is the official distribution with its final
   `/*# sourceMappingURL=bootstrap.min.css.map */` line removed. The upstream
   file's SHA-256 is `d85327d99c7a3ee1f9b5d0500d1370acea3ad2db39c163c2f51f232baedbdede`;
   removing only that line yields the committed digest. The pinned local digest
   is enforced by `scripts/check-vendor-governance.mjs`. Bootstrap is reviewed
   manually; `scripts/update-vendor.mjs` manages only Workbox files.

## Monthly checklist

1. Check upstream release notes for each dependency.
2. Run `node scripts/update-vendor.mjs` for a dry-run comparison against the declared upstream URLs. The command exits nonzero when any vendored file differs from upstream, so drift cannot be reported as a successful validation.
3. Run `node scripts/check-vendor-upstream.mjs` to detect whether the pinned registry package version is behind the latest npm release.
4. Apply the refresh with `node scripts/update-vendor.mjs --write` only after reviewing the upstream release and intended version.
5. Run `node scripts/check-vendor-governance.mjs` to verify digests, review age, and inventory completeness.
   This also verifies the pinned Bootstrap CSS bytes.
6. Run `node --test tests/security/*.mjs` before and after any vendor refresh.
7. Update `last_reviewed` in `docs/security/vendor-dependencies.json` and this file after review.
   For a Bootstrap refresh, verify its official distribution and any local
   transformation before changing the pinned digest in the governance script.

## Automated review

- `.github/workflows/vendor-review.yml` runs weekly and on manual dispatch.
- The workflow checks manifest freshness, upstream file drift, and whether the pinned Workbox version has fallen behind the latest npm release.
