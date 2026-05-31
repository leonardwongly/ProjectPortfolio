# Static Content Runbook

This portfolio is generated from source templates and JSON data. Edit the data and templates, then run the build before committing generated pages.

## Content Sources

- `data/profile.json` controls hero copy, education, publication links, writing, honors, structured data, and contact copy.
- `data/experience.json` controls role history and impact bullets.
- `data/skills.json` controls skill groups.
- `data/certifications.json` controls credentials. `link` is optional when a public credential URL is not available yet.
- `data/featured-projects.json` controls featured work.
- `data/reading.json` controls the reading page.

See `docs/content-source-inventory.md` before adding new public claims. New claims should be backed by an owner-approved source, public URL, or committed artifact before they are rendered.

## Update Flow

1. Edit the relevant file in `data/`.
2. Run `npm run build`.
3. Review `index.html`, `reading.html`, `offline.html`, and `_headers` for expected generated changes.
4. Run targeted validation for the surface changed:
   - Profile/content changes: `npm run test:content`
   - Reading changes: `npm run check:reading`
   - Media or layout-heavy changes: `npm run check:performance`
   - External URL changes: `npm run check:links`
   - Vendor changes: `npm run validate:vendor`
5. Run the full local release gate once generated files are committed or otherwise in sync with `HEAD`:
   ```bash
   npm run validate:full
   ```
6. For navigation, accordion, service-worker, or responsive changes, run `npm install` once, then `npm run test:integration`.

## Safety Checks

The build validates URLs, asset paths, and expected schema keys before rendering. External links must use `https:`. Relative links cannot contain path traversal segments.

Repository data files are treated as maintainer-controlled source inputs, not as externally trusted user submissions. Keep that boundary explicit when adding content pipelines: any future import, form, CMS, feed, or generated-data workflow that writes into `data/` must validate type, shape, length, allowed values, URL scheme, asset path, and rendered-output escaping before the content reaches `npm run build`.

The content parity tests verify that source-backed profile facts such as the current NCS and Public Service Commission Singapore context, Nanyang Polytechnic dates, articles, AI credentials, honors, and community records remain visible on the generated page.

The reading audit rejects missing authors, missing ISBNs, invalid years, duplicate ISBN/title-year records, and missing declared cover files. Reading years must be canonical four-digit years or integer years in the accepted range, and generated filter attributes must remain escaped so quote-bearing metadata cannot break out of HTML attributes.

The link-health checker performs URL-shape and DNS preflight checks before fetches and blocks non-HTTPS, credential-bearing, localhost, private literal host, and private DNS-resolved references. This is a maintainer-side hardening control for repository content, not a general-purpose network sandbox; the subsequent fetch still uses the original hostname and therefore depends on resolver stability between preflight and request. The default mode reports network failures without failing the build; use `npm run check:links -- --strict` before release if you need broken-link enforcement.

The performance budget check caps generated page sizes, key static assets, asset directories, and individual book/image/font files. Update `docs/media-asset-policy.md` before changing those budgets.

## CI

The build workflow uses Node 20, regenerates static pages, checks that generated outputs are committed, and runs the security/content test suite. Branch protection currently requires these contexts before merging to `main`:

- `Build`
- `Scan`
- `Cloudflare Pages`
- `CodeQL`

Draft pull requests intentionally skip the Playwright integration workflow. Mark a PR ready for review only when local validation has passed and generated files are committed.

The Gemini assistant workflow separates planning from execution. Planning can inspect repository context and post comments, but cannot mint the GitHub App token or use git write commands. Execution runs in a separate job only after a trusted collaborator submits an exact `plan#<uuid> approved` command that references a prior `github-actions[bot]` plan comment.

## Release Checklist

- [ ] `npm run build`
- [ ] `npm run test:security`
- [ ] `npm run check:reading`
- [ ] `npm run check:performance`
- [ ] `npm run audit:high`
- [ ] `npm run validate:vendor`
- [ ] `npm run test:integration`
- [ ] `npm run check:generated` after committing generated files
- [ ] Review `docs/security/csp-monitoring.md` for CSP console checks and Cloudflare event review when header policy changes.
- [ ] Verify production security headers after merge:
  ```bash
  curl -sSI https://leonardwong.tech/ | rg -i "^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy):"
  curl -sSI https://leonardwong.tech/reading | rg -i "^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy):"
  curl -sSI https://leonardwong.tech/offline | rg -i "^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy):"
  ```

## Rollback

This is a static site. Roll back by reverting the offending commit or redeploying the last known-good Cloudflare Pages deployment. For content-only regressions, revert the changed `data/` file and rerun `npm run build` so generated pages and `_headers` stay consistent.
