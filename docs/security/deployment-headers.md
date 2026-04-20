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
curl -sSI https://leonardwong.tech/ | rg -i "^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy|access-control-allow-origin):"
curl -sSI https://leonardwong.tech/reading | rg -i "^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy|access-control-allow-origin):"
curl -sSI https://leonardwong.tech/offline | rg -i "^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy|access-control-allow-origin):"
```

Expected:

1. Each endpoint returns all required security headers listed above.
2. `Content-Security-Policy` includes `style-src 'self'` and `frame-ancestors 'none'`.
3. `Access-Control-Allow-Origin` for HTML responses is `https://leonardwong.tech`.
