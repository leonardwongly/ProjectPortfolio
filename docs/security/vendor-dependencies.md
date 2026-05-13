# Vendored Dependency Governance

This file tracks locally vendored browser dependencies that are committed under `js/vendor/`.

## Review policy

- Cadence: monthly
- Last reviewed: 2026-04-08
- Maximum review age: 45 days
- Owner: repository maintainers

## Current inventory

1. `workbox` (`7.4.0`)
   Source: `https://storage.googleapis.com/workbox-cdn/releases/7.4.0/`
   Files:
   - `js/vendor/workbox-sw.js`
   - `js/vendor/workbox/workbox-core.prod.js`
   - `js/vendor/workbox/workbox-navigation-preload.prod.js`
   - `js/vendor/workbox/workbox-routing.prod.js`
   - `js/vendor/workbox/workbox-strategies.prod.js`

## Monthly checklist

1. Check upstream release notes for each dependency.
2. Run `node scripts/update-vendor.mjs` for a dry-run comparison against the declared upstream URLs.
3. Run `node scripts/check-vendor-upstream.mjs` to detect whether the pinned registry package version is behind the latest npm release.
4. Apply the refresh with `node scripts/update-vendor.mjs --write` only after reviewing the upstream release and intended version.
5. Run `node scripts/check-vendor-governance.mjs` to verify digests, review age, and inventory completeness.
6. Run `node --test tests/security/*.mjs` before and after any vendor refresh.
7. Update `last_reviewed` in `docs/security/vendor-dependencies.json` and this file after review.

## Automated review

- `.github/workflows/vendor-review.yml` runs weekly and on manual dispatch.
- The workflow checks manifest freshness, upstream file drift, and whether the pinned Workbox version has fallen behind the latest npm release.
