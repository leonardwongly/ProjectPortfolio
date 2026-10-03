# Deployment Header Requirements

Runtime security headers are generated from `src/_headers.template` into
`_headers` for Cloudflare Pages.

## Canonical Source

- Header policy source of truth: `src/_headers.template`; build output: `_headers`
- Fallback document-level policies: the page templates under `src/`.

## Canonical HTML Routes

The seven canonical clean routes are `/`, `/work`, `/reading`, `/offline`,
`/case-study-agentforge`, `/case-study-agentic`, and
`/case-study-apple-calendar-mcp`. Each has an exact CSP/CORS rule. `/*.html`
provides the same policy for their HTML file paths, including `/index.html`,
without overlapping any of the clean-route rules. Global security headers
remain in `/*`.

The public service documentation also has an exact CSP/CORS rule at
`/.well-known/service-doc`; its `.html` path matches the HTML policy.

The route regression checks assert exactly one CSP and one canonical CORS
value per clean or HTML file route in both the template and generated headers.
This validates the repository policy; verify the deployed provider's routing
and headers separately after release.

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
```

The production smoke checks all canonical clean routes. To inspect the header
values directly for both route forms:

```bash
for route in / /index.html /work /work.html /reading /reading.html /offline /offline.html /case-study-agentforge /case-study-agentforge.html /case-study-agentic /case-study-agentic.html /case-study-apple-calendar-mcp /case-study-apple-calendar-mcp.html /.well-known/service-doc /.well-known/service-doc.html; do
  curl -sSI "https://leonardwong.tech${route}" | rg -i "^(HTTP/|location:|content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy|access-control-allow-origin):"
done
```

Expected:

1. Each endpoint returns all required security headers listed above.
2. `Content-Security-Policy` includes `style-src 'self'` and `frame-ancestors 'none'`.
3. `Access-Control-Allow-Origin` for HTML responses is `https://leonardwong.tech`.

The production script check compares all eight published HTML pages with the
reviewed inventory and compares fetched page JavaScript bytes with local assets.
Only `/js/main.js`, `/js/site.js`, and the homepage's reviewed JSON-LD are
approved; offline and service documentation pages have no scripts. Browser HTML
parsing is shared with runtime inventory checks. Unknown injected execution,
including WebMCP and analytics adapters, fails closed. Review provider settings,
deployment version and audit logs before approving any additional source.

## CSP Monitoring

CSP enforcement is repo-owned through `src/_headers.template` and generated
`_headers`. CSP reporting is not enabled until a real HTTPS collector endpoint is
approved and tested. Use `docs/security/csp-monitoring.md` for the current
manual review process and the required rollout steps before adding `report-uri`
or `report-to`.
