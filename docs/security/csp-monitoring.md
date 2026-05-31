# CSP Monitoring Runbook

This repository enforces Content Security Policy through `src/_headers.template`,
generated `_headers`, and the source-page meta CSP tags. There is no committed
CSP report collector endpoint today. Until a collector is provisioned, CSP
monitoring is handled through the release checks below so the absence of an
endpoint is explicit and reviewable.

## Current Operating Mode

- CSP enforcement remains active in response headers and source-page meta tags.
- No `report-uri` or `report-to` directive should be added without a real,
  approved HTTPS collector endpoint.
- Do not point CSP reports at a placeholder route on this static site. Browsers
  send violation reports with `POST`, and Cloudflare Pages static assets are not
  a report ingestion service.

## Release Review

For every production release or header-policy change:

1. Run the local release gate:
   ```bash
   npm run validate:full
   ```
2. Verify deployed headers:
   ```bash
   curl -sSI https://leonardwong.tech/ | rg -i "^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy|access-control-allow-origin):"
   curl -sSI https://leonardwong.tech/reading | rg -i "^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy|access-control-allow-origin):"
   curl -sSI https://leonardwong.tech/offline | rg -i "^(content-security-policy|strict-transport-security|permissions-policy|x-frame-options|x-content-type-options|referrer-policy|access-control-allow-origin):"
   ```
3. Open the deployed pages in a browser with developer tools and confirm there
   are no CSP violations in the console.
4. Review Cloudflare Pages deployment output and Cloudflare security events for
   unexpected blocked resources, injected script attempts, or repeated requests
   for undeployed assets.

## Collector Rollout Requirements

If a CSP collector is later provisioned, complete all of these steps in the same
change:

1. Confirm the endpoint is HTTPS, production-owned, and able to accept browser
   CSP report `POST` requests.
2. Confirm report retention, access control, and alert ownership. Reports can
   include document URLs and blocked URLs, so avoid broad access and long
   retention by default.
3. Add `report-uri` and/or `report-to` to `src/_headers.template` without
   relaxing the existing CSP directives.
4. Run `npm run build` so `_headers` is regenerated from the template.
5. Update security tests to assert the reporting directive and endpoint.
6. Trigger a controlled CSP violation in a non-production or preview deployment
   and verify the collector receives it before enabling alerts for production.

## Escalation

Treat any unexpected CSP violation, repeated blocked script/style load, or
unknown external resource reference as a security investigation. The first
checks are:

1. Compare the deployed `_headers` against the committed `_headers`.
2. Inspect the page source for unexpected inline scripts or external resources.
3. Check recent dependency, vendor, template, and generated-file changes.
4. Re-run `npm run test:security` and `npm run validate:vendor`.
5. Revert the release or redeploy the last known-good Cloudflare Pages build if
   the violation points to an unauthorized source.
