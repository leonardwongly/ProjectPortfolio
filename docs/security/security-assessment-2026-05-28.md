# Security Assessment - 2026-05-28

## Executive Summary

The ProjectPortfolio codebase is a static portfolio/PWA with no server-side application logic, database layer, authentication system, session management, administrative interface, container configuration, or application API endpoints in the repository. The overall application security posture is strong for a static site: generated HTML is produced from structured JSON, untrusted display data is consistently escaped, URLs and asset paths are validated, strict CSP/security headers are generated, service-worker update messages are schema/origin checked, vendored Workbox files are hash-governed, GitHub Actions are mostly SHA-pinned with minimal permissions, and dependency audit results are clean.

No critical or high-severity exploitable vulnerability was identified in first-party application code. I did not find hardcoded secrets, backdoor accounts, hidden administrative functionality, obfuscated first-party code, unauthorized persistence, covert command-and-control behavior, suspicious telemetry, credential exfiltration logic, insecure deserialization, direct RCE vectors, CSRF-relevant state-changing endpoints, SQL/database injection surfaces, or authentication/authorization bypass paths.

The main findings were operational and supply-chain oriented:

- Network-check scripts can be abused as limited SSRF primitives when run against attacker-controlled content because they validate only URL shape and literal private hosts, not DNS-resolved private addresses.
- One pull-request integration workflow runs `npm ci` without `--ignore-scripts`, allowing dependency lifecycle scripts to execute in CI if a PR changes dependency metadata.
- The default PR build/scan workflows do not run the full dependency/vendor gates before merge.
- There is no repo-owned CSP violation collection path, so browser-side policy violations may be harder to detect.

## Remediation Status

This branch remediates the actionable repository-side findings from this assessment:

- PP-SA-001 and PP-SA-002 add URL-shape validation, public-host allowlisting for vendor upstreams, and DNS preflight rejection of private or reserved A/AAAA answers before link-health and vendor-refresh fetches. The remaining limitation is DNS rebinding/TOCTOU between preflight and the actual fetch; the scripts are maintainer-side CI/developer controls for repository content, not a complete network sandbox. A lower-risk `npm run check:links:preflight` mode validates URL shape and DNS without issuing HTTP requests.
- PP-SA-003 changes the Playwright integration workflow to install dependencies with `npm ci --ignore-scripts`.
- PP-SA-004 adds `npm run audit:high` and `npm run validate:vendor:governance` to the default PR scan workflow while keeping networked upstream vendor refresh in the explicit/scheduled validation path.
- PP-SA-005 adds `docs/security/csp-monitoring.md` and runbook references for Cloudflare/security-event review and future collector rollout. The repo still intentionally omits `report-uri` and `report-to` until a real approved HTTPS collector exists.

Validation for this remediation should include `npm run validate:full`, `git diff --check`, and post-merge GitHub required checks: `Build`, `Scan`, `CodeQL`, and `Cloudflare Pages`.

## Scope Reviewed

Reviewed source and generated surfaces:

- Static source pages and generated pages: `src/*.html`, `index.html`, `reading.html`, `offline.html`
- Client scripts: `js/main.js`, `js/site.js`, `pwabuilder-sw.js`
- Build and operational scripts: `scripts/*.js`, `scripts/*.mjs`
- Structured content inputs: `data/*.json`
- Security headers and PWA metadata: `src/_headers.template`, `_headers`, `manifest.json`, `robots.txt`, `sitemap.xml`
- Vendored dependencies: `js/vendor/**`, Bootstrap/Workbox assets, `docs/security/vendor-dependencies.json`
- CI/CD and automation: `.github/workflows/*.yml`, `.github/dependabot.yml`
- Tests and existing security controls: `tests/security/*.mjs`, `tests/integration/*.mjs`
- Dependency manifests: `package.json`, `package-lock.json`

## Findings

### PP-SA-001 - Link health checker can perform DNS-based SSRF

Severity: Medium

Location:

- `scripts/check-link-health.mjs:51-92`
- `scripts/check-link-health.mjs:153-178`

Evidence:

```js
function isPrivateLiteralHost(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (lower === '0.0.0.0') return true;
  const ipVersion = net.isIP(lower);
  ...
  return false;
}
...
return await fetch(url, {
  method,
  redirect: 'manual',
  signal: controller.signal,
  headers: {
    'user-agent': 'ProjectPortfolio-link-health/1.0',
    connection: 'close'
  }
});
```

Exploitation scenario:

An attacker who can get a URL into `data/profile.json`, `data/certifications.json`, `data/featured-projects.json`, generated HTML, or a branch that a maintainer checks with `npm run check:links` can point an HTTPS URL at an attacker-controlled hostname whose DNS resolves to a private/internal address. The script blocks literal private IPs and `localhost`, but it does not resolve hostnames before issuing `fetch`.

Potential impact:

When run on a developer machine or CI runner, the script can make HEAD/GET requests from that environment to otherwise private HTTPS endpoints. Because redirects are manual and only HTTPS is allowed, impact is constrained, but it can still be used for internal reachability probing or limited interaction with internal services.

Root cause:

Host validation is string-based and only catches literal private hosts. It does not perform DNS resolution and reject private, loopback, link-local, multicast, or reserved address ranges for every A/AAAA answer.

Remediation:

1. Resolve hostnames with `dns.promises.lookup(hostname, { all: true, verbatim: true })` before `fetch`.
2. Reject all private, loopback, link-local, multicast, documentation, carrier-grade NAT, and unspecified IPv4/IPv6 ranges.
3. Consider an explicit allowlist for known public domains used by the portfolio, or disable network link checks for untrusted PR content.
4. Add regression tests covering DNS names that resolve to private IPv4/IPv6 addresses.

### PP-SA-002 - Vendor refresh can fetch attacker-controlled internal hosts

Severity: Medium

Location:

- `scripts/update-vendor.mjs:56-72`
- `scripts/update-vendor.mjs:148-160`
- `docs/security/vendor-dependencies.json:7-56`

Evidence:

```js
function ensureHttpsUrl(rawUrl, fieldPath) {
  const urlString = ensureString(rawUrl, fieldPath);
  const parsed = new URL(urlString);
  if (parsed.protocol !== 'https:') {
    fail(`Invalid manifest at ${fieldPath}: only https URLs are allowed`);
  }
  if (parsed.username || parsed.password) {
    fail(`Invalid manifest at ${fieldPath}: credentials in URL are not allowed`);
  }
  return parsed.toString();
}
...
return await fetchImpl(url, {
  method: 'GET',
  redirect: 'error',
  signal: controller.signal,
  headers: {
    'accept': 'application/javascript, text/javascript, text/plain;q=0.9, */*;q=0.1'
  }
});
```

Exploitation scenario:

If an attacker can alter `docs/security/vendor-dependencies.json` in a branch and convince a maintainer or automation to run `npm run validate:vendor`, the refresh script can make HTTPS GET requests to arbitrary hostnames. The manifest currently points only to Google Workbox CDN URLs, but the script does not enforce that host or block DNS-resolved private addresses.

Potential impact:

The signature and hash checks reduce supply-chain write risk after the response is fetched, but the outbound request itself can still be abused for limited internal network probing from the developer or runner environment.

Root cause:

The vendor updater validates protocol and credentials, but not hostname allowlist, DNS resolution, or reserved address ranges.

Remediation:

1. Restrict `upstream_url` hosts to an allowlist matching the declared dependency source, currently `storage.googleapis.com`.
2. Add DNS resolution and private-address rejection before `fetch`.
3. Keep `redirect: 'error'` and hash/signature validation as-is.
4. Add tests proving non-allowlisted hosts, private literal hosts, and private DNS answers are rejected.

### PP-SA-003 - PR integration workflow allows dependency lifecycle scripts

Severity: Medium

Location:

- `.github/workflows/playwright-integration.yml:28-35`

Evidence:

```yaml
- name: Install Node dependencies
  run: npm ci

- name: Install Chromium for Playwright
  run: ./node_modules/.bin/playwright install --with-deps chromium

- name: Run nav and accordion integration spec
  run: ./node_modules/.bin/playwright test tests/integration/mobile-nav-and-accordion.spec.mjs --config=playwright.config.mjs
```

Exploitation scenario:

The workflow runs on pull requests. A malicious dependency change in a PR can cause npm lifecycle scripts to execute during `npm ci`. The workflow has read-only repository permissions and no explicit repository secrets, which limits blast radius, but lifecycle execution still provides arbitrary code execution in the CI runner during installation.

Potential impact:

CI runner reconnaissance, network egress, artifact poisoning, dependency-cache pollution, or exfiltration of low-sensitivity runtime context such as read-only `GITHUB_TOKEN` metadata. This is less severe than a write-token workflow compromise, but it is avoidable.

Root cause:

The build and scan workflows use `npm ci --ignore-scripts`, but the Playwright integration workflow does not.

Remediation:

1. Change `.github/workflows/playwright-integration.yml` to `npm ci --ignore-scripts`.
2. Keep browser installation explicit with `./node_modules/.bin/playwright install --with-deps chromium`.
3. Consider mirroring this in all local validation docs so dependency scripts remain disabled by default.

### PP-SA-004 - Default PR gates omit dependency and vendor governance checks

Severity: Low

Location:

- `.github/workflows/build.yml:21-28`
- `.github/workflows/scan.yml:30-40`
- `.github/workflows/vendor-review.yml:27-34`
- `package.json:15-22`

Evidence:

Build/scan run only build, generated-file drift, and security tests:

```yaml
- name: Install Node dependencies
  run: npm ci --ignore-scripts
- name: Build generated pages
  run: npm run build
- name: Ensure generated files are committed
  run: git diff --exit-code -- index.html reading.html offline.html _headers
- name: Run security and content tests
  run: npm run test:security
```

The fuller local gate includes additional checks:

```json
"validate:full": "npm run build && npm run check:generated && npm run test:security && npm run check:reading && npm run check:performance && npm run audit:high && npm run validate:vendor && npm run test:integration"
```

Exploitation scenario:

A dependency or vendor governance regression could pass the default PR build/scan and be detected only later by scheduled/manual vendor review or by a maintainer running `validate:full`.

Potential impact:

Delayed detection of stale vendored assets, dependency advisories, or performance/reading metadata regressions. Current impact is low because dependency count is small and scheduled vendor review exists.

Root cause:

The CI fast path and local full validation path have drifted.

Remediation:

1. Add `npm run audit:high` to the default PR scan.
2. Add `npm run validate:vendor` after hardening PP-SA-002, or run a non-network governance-only subset on PRs and keep upstream checks scheduled.
3. Keep Playwright integration enabled for ready-for-review PRs after fixing PP-SA-003.

### PP-SA-005 - CSP violation monitoring is not repo-owned

Severity: Low

Location:

- `src/_headers.template:8-21`
- `_headers:8-21`

Evidence:

The deployed CSP is strict, but it has no `report-uri` or `report-to` directive:

```http
Content-Security-Policy: default-src 'self'; script-src 'self'{{CSP_SCRIPT_HASHES}}; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests; block-all-mixed-content
```

Exploitation scenario:

If an injection, extension interaction, compromised dependency, or hosting misconfiguration causes CSP violations in browsers, the repository has no configured reporting endpoint to collect that signal.

Potential impact:

Lower detection and triage capability for attempted or accidental client-side policy violations. This does not weaken preventive CSP enforcement.

Root cause:

The repo defines enforcement headers but not reporting or incident-monitoring plumbing.

Remediation:

1. Add a CSP reporting endpoint if Cloudflare, a static-compatible collector, or another monitoring target is available.
2. Use `report-to` and/or `report-uri` where supported.
3. Add periodic review of Cloudflare security events and Pages deploy headers.

## Suspicious or Malicious Code Review

No intentionally malicious or suspicious first-party behavior was identified.

Not observed:

- Hardcoded private keys, passwords, API keys, OAuth refresh tokens, or backdoor credentials.
- Hidden administrative routes or undocumented privileged UI.
- Obfuscated first-party JavaScript.
- Dynamic code execution in first-party source (`eval`, `new Function`, string `setTimeout`/`setInterval`).
- Remote command execution paths in runtime browser code.
- Covert network beacons, WebSockets, arbitrary exfiltration endpoints, or unauthorized telemetry. The only telemetry adapter in `js/main.js` pushes sanitized event names/properties to already-present analytics globals and dispatches a local `CustomEvent`; CSP currently restricts `connect-src` to `self`.
- Persistence mechanisms beyond standard service-worker caching and `localStorage` for theme preference.

## Positive Security Controls

- Generated content is escaped with `escapeHtml` and JSON-LD is protected with `escapeJsonLd` in `scripts/build.js`.
- Data schemas enforce allowed keys, length limits, URL protocol restrictions, credential stripping, and asset path traversal prevention.
- Generated pages use a strict CSP without `unsafe-inline` or `unsafe-eval`; inline script hashes are computed and injected.
- Runtime `_headers` include HSTS, `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`, and CSP.
- Production header spot checks on 2026-05-28 confirmed Cloudflare serves the expected CSP, HSTS, referrer, permissions, no-sniff, and frame-denial headers for `/`, `/reading`, and `/offline`.
- `target="_blank"` links include `rel="noopener noreferrer"`.
- Service-worker `skipWaiting` messages require same-origin window clients and message shape validation.
- Vendored Workbox files have a manifest with declared upstream URLs, sha256 hashes, signature checks, inventory checks, and review-age enforcement.
- GitHub Actions are SHA-pinned and generally use least-privilege permissions with `persist-credentials: false`.
- Gemini automation separates planning from write-capable execution, requires trusted collaborator approval, validates exact `plan#<uuid> approved` syntax, requires a GitHub App token for write operations, and prevents direct commits to `main`.

## Validation Performed

Commands run:

- `npm run validate:full` - failed only at `test:integration` because local `node_modules` was absent and `npx --no-install playwright` resolved to a global Playwright CLI without the `test` command.
- `npm ci --ignore-scripts` - passed; installed locked dev dependencies locally.
- `npm run test:integration` - passed after installing locked dependencies; 9 passed, 3 skipped.
- `npm audit --json` - passed; 0 vulnerabilities.
- Production header checks with `curl -sSI https://leonardwong.tech/`, `/reading`, and `/offline` - expected security headers present.
- Static searches for secrets, dangerous browser sinks, message handlers, fetch/network calls, dynamic execution, suspicious tokens, backdoor-like strings, workflow permissions, and vendored dependency controls.

Representative validation results:

- Security tests: 58 passed.
- High-severity npm audit: 0 vulnerabilities.
- Vendor governance: 5 vendored files validated; review age 12 days.
- Vendor upstream review: tracked Workbox dependency is on the latest declared npm release.
- Performance budgets: all checked assets below configured budgets.

## Prioritized Action Plan

1. Harden network-fetching scripts against DNS-based SSRF: fix `scripts/check-link-health.mjs` and `scripts/update-vendor.mjs` with DNS resolution, reserved-range rejection, and upstream host allowlists.
2. Change the Playwright PR workflow install step to `npm ci --ignore-scripts`.
3. Add `npm run audit:high` to PR scan/build gates; add a vendor-governance PR gate after SSRF hardening or split it into non-network and network phases.
4. Add CSP violation reporting if an endpoint is available.
5. Keep scheduled CodeQL, Dependabot, and vendor review active, and periodically verify production headers after Cloudflare/Pages configuration changes.
