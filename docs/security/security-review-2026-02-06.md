# Security Review - 2026-02-06

## Scope

- Repository: `/Users/leonardwongly/Developer/ProjectPortfolio`
- Runtime: static site + service worker + GitHub Actions workflows
- Deployed target checked: `https://leonardwong.tech`

## Methodology

1. Static code and workflow review.
2. Data-to-template trust boundary analysis in `scripts/build.js`.
3. Header and transport validation using `curl -I`.
4. Regression checks for CSP placement, link hardening, and action pinning.

## Scoring Rubric

- `High`: exploitable condition with strong impact or high abuse potential.
- `Medium`: meaningful hardening gap that can become exploitable with environmental change or future edits.
- `Low`: hygiene or defense-in-depth improvement.

## Findings

| ID | Severity | Area | Finding | Evidence |
| --- | --- | --- | --- | --- |
| SEC-001 | High | CI/CD | Privileged automation path had broad permissions and unpinned third-party action reference. | `.github/workflows/gemini-cli.yml` |
| SEC-002 | High | Dependency Hygiene | Dependabot config had no valid ecosystem, leaving workflow dependencies stale. | `.github/dependabot.yml` |
| SEC-003 | Medium | Client Policy | CSP meta was placed after script tags in source templates, weakening parser-time enforcement. | `src/index.html`, `src/reading.html`, `src/offline.html` |
| SEC-004 | Medium | Build Integrity | Templating escaped HTML but did not enforce strict URL/path allowlists for dynamic href/src values. | `scripts/build.js` |
| SEC-005 | Medium | Supply Chain | Some workflow actions were referenced via floating tags instead of immutable SHAs. | `.github/workflows/build.yml`, `.github/workflows/semgrep.yml` |
| SEC-006 | Medium | Deployment Headers | Live responses were missing stronger edge-enforced headers (HSTS/CSP response header/Permissions-Policy) and returned wildcard CORS on HTML. | `curl -I` observations on 2026-02-06 |

## Exploitability Notes

- CI workflow compromise risk is highest because it can influence repository state and automation behavior.
- URL/path validation issues are currently mitigated by trusted maintainers, but become exploitable if data ingestion broadens or manual review misses unsafe values.
- CSP ordering issues are latent but can become active with future inline script additions.

## Remediation Summary

| ID | Owner | Planned Change |
| --- | --- | --- |
| SEC-001 | Repo Maintainer | Reduce workflow default permissions, pin third-party action SHAs, guard write operations to plan execution mode. |
| SEC-002 | Repo Maintainer | Replace Dependabot config with explicit `github-actions` ecosystem and weekly schedule. |
| SEC-003 | Frontend Maintainer | Move CSP/referrer/charset/viewport before script tags and add `object-src 'none'` + `frame-src 'none'`. |
| SEC-004 | Build Maintainer | Add schema validation and URL/path allowlisting with safe fallbacks for dynamic rendering. |
| SEC-005 | Repo Maintainer | Pin all workflow `uses:` references by commit SHA and disable credential persistence where not needed. |
| SEC-006 | Platform/Edge Owner | Apply mandatory response headers at Cloudflare/hosting layer and reduce wildcard CORS scope. |

## Verification Status

| Check | Status | Evidence |
| --- | --- | --- |
| Workflow action pinning | Completed | `scripts/security-smoke.sh` + `tests/security/policy-regression.test.mjs` |
| Workflow permission hardening | Completed | `.github/workflows/gemini-cli.yml` + `scripts/security-smoke.sh` |
| Dependabot ecosystem repair | Completed | `.github/dependabot.yml` |
| CSP placement and directives | Completed | `src/*.html`, regenerated pages, and tests |
| URL/path allowlist validation | Completed | `scripts/build.js` + `tests/security/build-validation.test.mjs` |
| Live header requirements documented | Completed | `docs/security/deployment-headers.md` |
| Live header rollout at edge | Pending external deployment | Cloudflare/host configuration change required |

### Runtime Header Check (2026-02-06)

Manual `curl -I` checks were rerun for:

- `https://leonardwong.tech/`
- `https://leonardwong.tech/reading`
- `https://leonardwong.tech/offline`

Observed response headers still indicate pending deployment hardening for:

- `Strict-Transport-Security` (not present)
- Response-header `Content-Security-Policy` (not present)
- `Permissions-Policy` (not present)
- Broad `Access-Control-Allow-Origin: *` on HTML responses

## Residual Risks

1. Edge headers are deployment-managed and require Cloudflare/host changes outside this repo.
2. Vendored JS assets are not yet governed by an in-repo package manifest lifecycle.
3. AI-assisted workflow remains a sensitive capability and must stay constrained to trusted collaborators.

## Rollout Guidance

1. Phase A: merge workflow + dependabot hardening.
2. Phase B: merge CSP/template/build validation + test harness.
3. Post-merge: apply deployment header policy and verify with `curl -I`.
