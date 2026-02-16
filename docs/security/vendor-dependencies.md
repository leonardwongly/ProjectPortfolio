# Vendored Dependency Governance

This file tracks locally vendored browser dependencies that are committed under `js/vendor/`.

## Review policy

- Cadence: monthly
- Last reviewed: 2026-02-15
- Owner: repository maintainers

## Current inventory

1. `workbox-sw` (`5.1.2`)
   Source: `https://storage.googleapis.com/workbox-cdn/releases/5.1.2/workbox-sw.js`
   Files: `js/vendor/workbox-sw.js`, `js/vendor/workbox/`
2. `@pwabuilder/pwaupdate` (`0.2.1`)
   Source: `https://www.npmjs.com/package/@pwabuilder/pwaupdate`
   File: `js/vendor/pwa-update.js`

## Monthly checklist

1. Check upstream release notes for each dependency.
2. Update vendored files when upstream has security fixes.
3. Confirm signature markers in `docs/security/vendor-dependencies.json` still match the vendored files.
4. Run `node --test tests/security/*.mjs` before and after any vendor refresh.
5. Update `last_reviewed` in `docs/security/vendor-dependencies.json` and this file.
