# Deployment Header Requirements

Runtime security headers are managed in the repository via `/Users/leonardwongly/Developer/ProjectPortfolio/_headers` for Cloudflare Pages.

## Canonical Source

- Header policy source of truth: `/Users/leonardwongly/Developer/ProjectPortfolio/_headers`
- Fallback document-level policy source: `/Users/leonardwongly/Developer/ProjectPortfolio/src/index.html`, `/Users/leonardwongly/Developer/ProjectPortfolio/src/reading.html`, `/Users/leonardwongly/Developer/ProjectPortfolio/src/offline.html`

## Required Response Headers

1. `Strict-Transport-Security`
2. `Content-Security-Policy` (response header, not only meta CSP)
3. `Referrer-Policy`
4. `X-Content-Type-Options`
5. `Permissions-Policy`
6. `X-Frame-Options`

## CORS for HTML

- HTML routes should return `Access-Control-Allow-Origin: https://leonardwong.tech`.
- Avoid wildcard CORS (`*`) for HTML documents.

## Post-Deploy Verification

Run:

```bash
npm run check:production
npm run check:production:scripts
curl -sSI https://leonardwong.tech/ | rg -i "^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy|access-control-allow-origin):"
curl -sSI https://leonardwong.tech/reading | rg -i "^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy|access-control-allow-origin):"
curl -sSI https://leonardwong.tech/offline | rg -i "^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy|access-control-allow-origin):"
```

Expected:

1. Each endpoint returns all required security headers listed above.
2. `Content-Security-Policy` includes `style-src 'self'` and `frame-ancestors 'none'`.
3. `Access-Control-Allow-Origin` for HTML responses is `https://leonardwong.tech`.

The production script check compares script elements on all eight published HTML
pages, including the service documentation served at `/.well-known/service-doc`
from `.well-known/service-doc.html`, with the committed pages. Only
`/js/main.js`, `/js/site.js`, and the homepage's committed JSON-LD script are
approved; `/offline` and the service documentation have no approved scripts.
It fails on injected or changed scripts,
including edge-injected WebMCP or analytics scripts. A failure requires review of
the Cloudflare Pages project, zone integrations, deployment version, and audit
logs before adding any new script to the approved source. Do not approve an
unknown live script by changing the inventory to match production.

## CSP Monitoring

CSP enforcement is repo-owned through `src/_headers.template` and generated
`_headers`. CSP reporting is not enabled until a real HTTPS collector endpoint is
approved and tested. Use `docs/security/csp-monitoring.md` for the current
manual review process and the required rollout steps before adding `report-uri`
or `report-to`.
