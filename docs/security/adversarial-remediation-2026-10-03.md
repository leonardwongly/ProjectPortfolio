# Adversarial audit remediation — 2026-10-03

Repository remediation follows the nine findings from the 2026-10-02 manual
adversarial audit. This is local implementation and validation evidence. It
does not represent an official Deep Scan result, hosted CI, deployment, or a
change to Cloudflare settings.

| Finding | Implemented behavior | Validation |
| --- | --- | --- |
| A01: deployed script provenance | Scheduled production checks compare all eight published HTML pages with the reviewed script inventory, pin JSON-LD and CSP hashes, and compare fetched JavaScript bytes. Unknown injected scripts fail closed. | Bounded mock HTTPS/DNS fixtures, injection and parser bypass regressions. Provider drift remains open. |
| A02: shallow header monitoring | All eight published clean routes require approved CSP sources and restrictions, HSTS duration/options, and the remaining security header values. | Permissive, malformed, duplicate and override policies are rejected; compatible restrictive CSP intersections are accepted. |
| A03: dollar substitution | Authored templates are interpolated once, preserving literal replacement sequences and template-looking data. | Regressions for `$$`, `$&`, dollar-backtick and dollar-apostrophe in normal and case-study content. |
| A04: outsider CI interference | Eligible planning/execution requests from trusted human actors share groups by issue/PR; ineligible events receive unique run groups and cannot replace authorized pending work. | Actual parsed workflow expressions tested across event types, associations, missing metadata and different subjects; independent read-only patch review. |
| A05: telemetry guard gaps | Classified runtime inventory covers page scripts, the reviewed worker and governed vendor files. Page script checks reject resource beacons and require an initial, top-level rejecting event guard with a stable callee and complete argument validation. | DOM resource/sink, alias, dead/nested guard, worker tamper and unclassified inventory regressions. |
| A06: ungoverned Bootstrap CSS | Bootstrap 5.3.8 CSS has pinned bytes, source/version/license metadata and a bounded monthly review age. | Tamper, symlink, missing/empty, malformed UTF-8, version/license and date regressions; current upstream byte comparison. |
| A07: clean-route CSP gaps | Explicit non-overlapping rules cover all eight monitored clean routes plus existing HTML paths. | Template/generated route checks verify exactly one CSP and CORS rule per route. |
| A08: inert offline controls | Offline HTML is standalone, with visible navigation and no controls requiring JavaScript. | Real mobile and desktop Chromium navigation, reconnect and accessibility checks. |
| A09: uncached offline styles | Worker v3 atomically precaches offline HTML and minimal CSS; asset fallback matches only the exact same-origin GET stylesheet. | Worker error/method/URL/cache tests and real offline browsers with HTTP cache cleared, light and dark modes. |

The local browser harness now uses a bounded Node server bound to `127.0.0.1`.
It retains the staged deployment allowlist, rejects unsafe paths and symlinks,
and refuses reuse of another listener. Offline regressions run in both the
package release gate and the regular PR integration workflow. The stylesheet
has a 4 KiB performance budget.

## Work and validation ownership

| Phase | Task | Subtasks | Owner | Parallelizable | Branch/Worktree | Validation Gate | Commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Implementation | Production monitoring | A01/A02 headers, script inventory and content checks | Operations reviewer | Yes | Current checkout | Production fixtures and workflow hygiene | Included in this change |
| Implementation | Content rendering | A03 single-pass interpolation and publication ownership | Build reviewer | Yes | Current checkout | Build regressions | Included in this change |
| Implementation | CI and vendor governance | A04/A06 event isolation and pinned CSS | CI reviewer | Yes | Current checkout | Workflow/vendor fixtures and upstream comparison | Included in this change |
| Implementation | Policy coverage | A05/A07 telemetry and clean routes | Policy reviewer | Yes | Current checkout | Policy regressions | Included in this change |
| Implementation | Offline behavior | A08/A09 document, stylesheet and worker | Browser reviewer | Yes | Current checkout | Worker and real offline browser tests | Included in this change |
| Integration | Harness and release gate | Node server, generated output, package/CI integration | Primary agent | After source integration | Disposable current-tree snapshot | Full release gate and regeneration stability | Included in this change |
| Review | CI security boundary | Fresh investigator and fresh patch reviewer | Independent reviewers | Yes | Read-only current checkout | No concrete patch bypass found | No changes |

## Validation evidence

The final frozen implementation passed `npm run validate:full` on Node.js
24.21.0, matching the CI major version:

| Check | Result |
| --- | --- |
| Build and generated-output stability | Passed |
| Resume freshness, repository and workflow hygiene | Passed |
| Security coverage suite | 403 passed; 88.68% lines, 79.37% branches, 94.26% functions |
| Reading metadata, performance budgets and telemetry policy | Passed |
| Strict link preflight | Passed; 118 external references checked structurally |
| `npm audit --audit-level=high` | Passed; zero reported vulnerabilities |
| Vendor integrity, freshness and upstream comparison | Passed |
| Mobile/desktop navigation and real offline integration | 41 passed, 9 existing conditional skips |
| Mobile/desktop axe checks, light/dark | 28 passed |
| Smoke CLI hermetic and real-ripgrep forwarding regressions | 5 passed in each mode |
| Git diff whitespace check | Passed |

A redacted Gitleaks scan of the frozen source snapshot returned three flags,
all for the synthetic `0123456789abcdef` worker-message test token. Manual
review confirmed test fixtures, not credentials; no suppression was added.

Five independent in-session reviewers audited and remediated the source,
monitoring, policy, build, CI and offline surfaces. The installed Autoreview
helper's dry-run prepared the bundle, but automatic approval review rejected
its actual invocation because exporting the uncommitted patch to that external
reviewer was not explicitly authorized. The helper was not run or bypassed;
closeout evidence consists of the in-session review and local validation above.
This is not a clean structured Autoreview result.

The gate ran from a disposable snapshot staged as its baseline, so
`check:generated` verifies regeneration without treating the intended patch
as stale generated output. No source checkout commit is needed for this check.

Bootstrap provenance was checked on 2026-10-03 against the pinned upstream
distribution. Removing only its terminal 45-byte source-map comment yields
byte-for-byte equality with the local stylesheet and SHA-256
`8f8173cb2d8f867274aeb0cb15328e60f490c7f272351e51a55f1dabb486e4ff`.

The host sandbox blocks local listeners; approved test execution enabled
loopback browser/server checks. An incompatible host npm `allow-scripts`
setting required separate empty temporary user/global configuration files
for the advisory check. These workarounds do not change global configuration
or repository dependency policy.

Seven ignored `.DS_Store` files were moved to a recoverable local temporary
backup with their original paths recorded. They are not part of this change.

## Remaining deployment evidence

On 2026-10-03, the final eight-route monitors were run with one attempt and
a 10-second per-request timeout:

- `SMOKE_ATTEMPTS=1 SMOKE_TIMEOUT_MS=10000 node scripts/check-production-smoke.mjs`
  failed only for the missing response CSP at `/.well-known/service-doc`.
- `SMOKE_ATTEMPTS=1 SMOKE_TIMEOUT_MS=10000 node scripts/check-production-scripts.mjs`
  failed on all eight routes: WebMCP bridge references on the homepage, Apple
  Calendar case study and service documentation, and Cloudflare analytics
  references on the other five routes. These references are absent from the
  reviewed repository inventory.

The prior audit also observed Rocket Loader references. Script ownership,
enabled provider settings and actual execution have not been established by
these GET checks. The new monitor deliberately rejects unreviewed references;
no provider allowlist was added and no provider setting changed.
Close A01's external portion by reviewing the live configuration, explicitly
approving or removing injection, deploying the repository changes, and running
`npm run check:production` and `npm run check:production:scripts` against the
resulting deployment. Those actions require separate deployment/provider
authorization.

Local fixtures do not establish GitHub's hosted scheduler behavior or hosted
workflow success. The final local validation uses Node.js 24. The static
telemetry guard remains bounded defense in depth, not an exhaustive proof of
JavaScript behavior.

## Independent review follow-through

The branch was advanced to current `main` (`21c9ede6`) before integrating the
patch. Existing merged hardening checks, permission tests and browser
initialization waits were retained. The original local patch remains in a
recovery stash until the new commit/PR handoff is verified.

The subsequent adversarial review accepted and remediated these findings:

- Browser/monitor parsing differences, including raw text, `noscript`, unknown
  tags/declarations and non-ASCII attribute separators: use shared bounded
  parse5 parsing for production and runtime inventory, with regression payloads.
- Optional DOM calls, ASI aliases, composed event names and reassigned telemetry
  callees: enforce the documented supported source contract.
- Structural vendor tests expiring with the wall clock: derive fixture dates
  from exported policy metadata while retaining live CLI freshness checks.
- Trusted discussion cancelling Gemini work without a request: use actual
  plan/execute eligibility in concurrency. The complete release gate now runs
  for every ready PR revision.
- Sequential interpolation turning literal content into markup: interpolate
  authored templates once; preserve data tokens and valid JSON-LD/CSP hashes.
- Publication/rollback overwriting concurrent edits: forward destination
  snapshots and verify temporary-file ownership before rollback.
- Localhost Workbox imports of absent development modules: explicitly select
  the vendored production modules and test real localhost offline behavior.
- Public service documentation lacking CSP on its clean route: add exact
  response coverage, an inert document policy and eighth-page monitoring.
- Negative shell checks treating search-tool failures as no matches: require
  an actual no-match exit status and reject tool failures.

The service-documentation omission was confirmed with a public GET returning
HTTP 200 HTML and no response CSP on 2026-10-03. Provider/deployment remediation
of that live response remains separate from the repository fix.
