# Test-quality audit — 2026-10-04

## Authorized remediation — verified 2026-10-04

The user authorized remediation and extended verification to 30 minutes/up to 20 check invocations. The original audit below is historical baseline evidence, including its original audit-only authority and incomplete first browser attempt. No existing test file or unique regression protection was removed.

The final frozen patch passed **496 Node cases** and **101 browser project instances**, with **nine intentional browser skips**, zero failures and zero flakes. All 15 recorded local/release/dependency/vendor/browser commands passed. Native collection took 87.497s using Node v24.21.0; source/test/config/dependency hashes were unchanged during this run. Generated deployment artifacts were unchanged.

Applied remediation:

- Resume freshness negatives now require failure and diagnostics. Resume publication reuses the snapshot-bound publisher to preserve foreign edits during publication and rollback. The new regression failed before the fix and passed afterward.
- Build tests inspect actual telemetry anchors, per-record DOM content/links, parser/output boundaries and independent SHA256. CSP hashes now normalize CRLF/lone CR as parsed script text does; the independent crypto/parse5 regression exposed the original mismatch.
- Failed Playwright staging now cleans its owned directory before exit-hook registration. Child protocols prove the absolute stage existed before exit. Local fixture requests/listeners/subprocesses are bounded; directory/FIFO/hardlink and exact-size cases exercise their advertised paths. The inline static-server containment guard remains intact.
- Filesystem tests cover partial real EIO, final-check race timing, readers during publication, WebP inode replacement and exact conversion outcomes, hostile exporter outputs and schema/archive boundaries.
- Network tests enforce mixed-DNS rejection with zero transport, cumulative byte limits and resource cleanup. Timed-out injected DNS/response continuations cannot start useful work. Production monitor injection now preserves raw bytes alongside decoded text and cancels late bodies before reader entry; equal/unequal malformed UTF8 and multibyte boundaries are verified.
- Markdown negotiation has hermetic consumer tests for Accept/status/body/MIME/Vary/bounds. Exact MIME matching rejects counterfeit prefixes; useful CLI output remains.
- Policy/signing/vendor/workflow tests use parsed operative HTML/CSP/YAML, independent signatures/digests/hash maps, real rg forwarding, final-reread vendor races, dry-run tree equality and retry/date/gate boundaries. Independent review caught and corrected a duplicate-CSP oracle regression. Fake-gh publishing tests use a verified isolated stub.
- Browser/worker tests now assert known reading identities/counts/AND/privacy/view behavior, native sharing/cancellation without clipboard, project identities/status/proof links, keyboard group isolation, visible focus, theme/storage/pointer/live-motion/reveal behavior and axe for opened widgets. Native failed installation preserves the active worker/cache; a later waiting worker reloads once. Erased cache produces bounded plaintext 503 document/CSS responses.
- Stronger browser assertions exposed two production bugs: expanded-accordion contrast and immediate fallback focus loss. Expanded headers use the existing theme text color; main focus keeps its temporary tabindex until blur. Strict regressions pass on both configured projects.

### Coverage comparison

Original unchanged-settings Node baseline: lines 11262/12699 (88.68%), branches 3016/3800 (79.37%), functions 755/801 (94.26%), 27 targets and 405 cases. Final counts:

| Metric | Covered / total |
|---|---|
| Lines | 11469/12809 (89.54%) |
| Branches | 3196/3920 (81.53%) |
| Functions | 762/809 (94.19%) |

There are **no measured Node targets strictly below 25%**. The final collection has 28 targets because Markdown negotiation is now loaded. Removing duplicated resume publication code changes production denominators; this compares identical collection settings, not identical source bytes. All 28 native line/branch pairs match LCOV. The five includes and 75/75/85 global thresholds were preserved. No per-test coverage attribution, arbitrary quality score or mutation score is claimed.

Optional `BROWSER_COVERAGE_DIR` now captures first-party Chromium native V8 function/range records with source hashes and engine version. Passing fixture-page captures, deduplicated by source hash and function name/start/end offsets, record main.js **101/111 (90.99%)** and site.js **6/6 (100%)** called function entries. This includes V8 script entries/callbacks. Browser line/statement/branch dimensions remain unsupported; additional context.newPage pages in the existing readyState loop are outside this fixture. Empty records and excluded vendor assets are unknown, not 0%. Browser counts are kept separate from Node aggregates.

### Verification and provenance

- `security`: exit 0, 18.669s.
- `build`: exit 0, 0.242s.
- `generated`: exit 0, 0.043s.
- `resume`: exit 0, 0.184s.
- `hygiene`: exit 0, 0.185s.
- `workflows`: exit 0, 0.29s.
- `reading`: exit 0, 0.236s.
- `performance`: exit 0, 0.296s.
- `telemetry`: exit 0, 0.455s.
- `links-preflight`: exit 0, 2.066s.
- `vendor-governance`: exit 0, 0.131s.
- `audit-high`: exit 0, 1.154s.
- `vendor-drift`: exit 0, 0.95s.
- `vendor-upstream`: exit 0, 0.503s.
- `browser`: exit 0, 62.007s.

The runner covers the validate:full gate contents with native Node event/LCOV reporters and one all-spec Playwright JSON invocation; installed Chromium was reused rather than installed again. Exact command arrays/environment/timestamps/timeouts are in ignored remediation/final-execution.json. npm audit reports zero vulnerabilities; vendor drift and upstream checks pass. No public production scan or deployment was performed in this phase.

Independent reviewers audit_repo_source and audit_policy reviewed the other author's groups. Root reviewed the later byte/deadline and focus changes. No external patch exporter was used; the previous autoreview approval block remains separate evidence. No deletions were recommended or applied.

The original untracked report is saved as remediation/audit-report-before-remediation.md. The recoverable tracked/untracked patch, before/after manifests, native events/LCOV, case ledger, browser JSON/function records and evidence SHA256 manifest are retained under ignored artifacts/test-quality-audit-2026-10-04/remediation/. Worker-only pre-fix probes without standalone logs are transcript-derived; the root late-DNS failure has network-before.log and execution metadata. Focused browser failure/repair/completion JSON is retained separately. final-attempt-1 records an invalid 90-character telemetry fixture; final-attempt-2 records the focus fix landing during collection, so its mixed source identity/browser failures are not passing evidence. The final run has frozen inputs and no failures.

Verification used 16 bounded check batches/probes, including three final-gate attempts; each gate's individual commands are recorded. New failures justified the two final-gate repair cycles; assertions and thresholds were not weakened.

### Remaining evidence and contract limits

Activation cache keys/delete/claim rejection recovery has no agreed contract and remains blocked. Filtered palette edge cases, reveal delay/dedup boundaries, native loading/DCL schedules and native multi-tab upgrade remain further test expansion. Reflow, forced-colors, human screen-reader, other engines/device and production/provider behavior are not established by tagged Chromium axe checks. The final filesystem-syscall race window and mocked exporters versus real tools remain distinct limits. Original production CSP/provider-script findings require provider/deployment work; local tests do not close them. Managed Deep Scan never completed; this remains a clearly labeled manual fallback.

Reproduce using the exact final-execution.json command arrays, or Node 24 with npm run test:security:coverage and npx --no-install playwright test on an unused PLAYWRIGHT_PORT. Set BROWSER_COVERAGE_DIR=artifacts/browser-coverage to retain native first-party function/range records.

### Signed commit handoff

The user explicitly authorized commit and push on2026-10-04. The initial 45-second signing timeout was resolved: the 1Password retry signed the first commit, and macOS Keychain loaded the existing configured RSA key into the SSH agent for subsequent commits. Every source/test commit below was verified against the corresponding public key. Command-local public-key/program overrides preserved global Git configuration; signing was not disabled.

| Commit | Purpose | Files |
|---|---|---|
| 405f2d0cefd2 | fix(build): preserve foreign edits during resume publication | scripts/build-resume.mjs, tests/security/resume-build.test.mjs |
| 0a29937a0b29 | fix(build): hash browser-normalized inline script text | scripts/build.js, tests/security/build-validation.test.mjs |
| 711b44b2315c | fix(network): preserve monitor byte and deadline contracts | scripts/lib/network-safety.mjs, scripts/check-production-smoke.mjs, tests/security/network-safety.test.mjs, tests/security/production-scripts.test.mjs, tests/security/production-smoke.test.mjs |
| 6c6b4e011984 | fix(ops): validate negotiated MIME types and monitor boundaries | scripts/check-markdown-negotiation.mjs, tests/security/markdown-negotiation.test.mjs, tests/security/ops-scripts.test.mjs |
| eea51499ae2c | fix(test): clean failed staging and bound fixture resources | playwright.config.mjs, tests/security/playwright-config.test.mjs, tests/security/static-server.test.mjs, tests/security/html-document.test.mjs |
| 6341cb5b4177 | test(security): strengthen policy and ownership oracles | tests/security/policy-regression.test.mjs, tests/security/security-smoke.test.mjs, tests/security/vendor-governance.test.mjs, tests/security/vendor-refresh.test.mjs, tests/security/vendor-upstream.test.mjs, tests/security/web-bot-auth.test.mjs, tests/security/workflow-hygiene.test.mjs, tests/security/safe-output.test.mjs, tests/security/generate-book-webp-security.test.mjs, tests/security/content-parity.test.mjs |
| 650dbb4311cc | fix(ui): preserve fallback focus and accessible expanded content | js/main.js, css/custom.css, tests/integration/browser-fixture.mjs, tests/integration/browser-contracts.spec.mjs, tests/integration/accessibility-smoke.spec.mjs, tests/integration/mobile-nav-and-accordion.spec.mjs, tests/integration/offline-fallback.spec.mjs, tests/security/service-worker-message.test.mjs |

The documentation commit records this audit and handoff. Current PR182 status and hosted checks must be inspected on its exact pushed head; local results above do not establish hosted CI, merge, deployment or provider changes. All 134 recorded source/test/config/dependency inputs still match the passing final collection after commit creation. Ignored raw evidence remains local.

### Hosted CI prerequisite repair

The first pushed follow-up head, d43eab58570163324bd378cbceb596b1ec790bb4, failed Build, Scan and Release Candidate because their Ubuntu runners lacked ripgrep. The new real-pattern smoke test correctly failed its executable prerequisite; it was not skipped or weakened. Playwright Integration and both CodeQL checks passed on that head.

Build, Scan and Release Candidate now explicitly install ripgrep before running the security suite. Focused Node 24 smoke/policy/workflow validation passed all 159 cases with no failures or skips; `npm run check:workflows` and `git diff --check` passed. These are local repair checks; the repaired commit's hosted result must be inspected separately. The frozen 496-case/101-browser evidence above precedes this workflow-only repair. Failed hosted logs and the focused repair log remain in the ignored remediation evidence directory.

### Pre-merge review remediation

The merge-readiness check found new review comments on 818c49a4 despite green CI. The confirmed gaps are corrected before merging:

- The build generates exact clean case-study CSP/CORS blocks from validated data and the shared authored HTML policy. A renamed-slug regression proves new clean/HTML coverage and removal of the stale route rule; current canonical output remains byte-identical. Missing, duplicate, misspelled, embedded and unknown authored tokens fail before publication.
- Runtime inventory recursively classifies HTML, including nested `.well-known`, docs and other page directories. Only exact known authored fragments and local metadata/dependency/report roots are excluded. Nested unknown pages and symlinked directories fail closed.
- The fixture server permits only the exact staged service-document clean/HTML paths. GET/HEAD regressions preserve hidden-file, traversal and no-follow/containment protection; unrelated discovery paths remain blocked.
- Both `test:integration` and the hosted Playwright workflow include `browser-contracts.spec.mjs`. The accessibility gate remains intact.
- The CodeQL fixture construction finding is addressed by constant child JavaScript and config URLs passed as argv. Fixtures copy unchanged configuration and link dependencies rather than rewriting import source.

The reported HTML-byte decoding defect is not present: `readStableFileNoFollow` returns a decoded string when `fatalUtf8: true` is supplied (`scripts/lib/safe-input.cjs`), as the existing runtime HTML caller does. The passing telemetry gate and clean inventory fixture confirm that path; no redundant conversion or weakened parser was added.

Fresh local Node 24 coverage validation passes **503 cases**, no failures/skips, **89.52% lines / 81.58% branches / 94.24% functions**, with the original includes and 75/75/85 thresholds. Build, generated-file, telemetry, repository/workflow hygiene and diff checks pass. Raw build/security logs are under ignored `artifacts/test-quality-audit-2026-10-04/merge-readiness/`. The focused independent review found no actionable regression in the recursive inventory or narrow fixture-server exception. These local results precede the new hosted checks and do not claim a merge or production deployment.

## Original audit baseline

## Result and interpretation

All **23 repository test files** were statically inspected, with a complete per-case decision ledger in the appendices. Fresh Node.js 24 coverage collection passed **405 test cases**. **No measured production file is strictly below 25% in line, branch or function coverage.** The minimum file values are 82.59% lines, 66.34% branches and 80.00% functions. This finding applies to the 27 measured targets, not the entire executable repository.

A coverage percentage measures executed production code; it does not grade an individual test's assertions. The runner does not supply per-test coverage attribution. It would be misleading to classify a named test as “less than 25% covered” from these file-level totals. Forty-six instrumented function entries have zero recorded calls and eight JavaScript files are omitted/unloaded; neither fact makes existing security/regression cases disposable.

Several named cases have demonstrably incomplete oracles, including checks that could pass with the advertised behavior broken. These are **retain and improve** decisions. There are **no removal recommendations** and no arbitrary test-quality scores. This extension was treated as audit/identification only: no production/test edits, mutations, deletion, commit or push. The new report and ignored evidence artifacts are the only repository writes.

## Scope, threshold and identity

- Root: /Users/leonardwongly/Developer/ProjectPortfolio
- HEAD: 11362edcabc93025dafeea66a2f60c90d82a2b48
- Baseline working tree: clean; source/test/config/dependency identity unchanged before/after collection.
- Threshold: strictly below25% for each available line, branch and function metric separately; exactly25% is not below threshold. The user was offered line-only selection; no answer was received, so all three dimensions were evaluated.
- Collected: 2026-10-03T16:34:06.464121+00:00 to 2026-10-03T16:34:21.003923+00:00 (UTC); user-facing date2026-10-04, Asia/Singapore.
- Toolchain: Nodev24.21.0, darwin/arm64, OS27.0.0; installed dependency identity and package lock captured in before.json.
- Inputs: 131 hashed text/config/lock/dependency inputs; 35 JavaScript executable/tooling files independently inventoried; twenty Node test files and three Playwright files. Binary asset content was not included in this text-input manifest; fixtures/resource behavior are separately audited.
- Budget: default15-minute audit/check budget, three-minute ceiling per check. Two suite invocations: one Node baseline and one full browser run. No retries, mutation probes or dependency installation. Runtime verification stopped after the browser ceiling; report collation continued.

## Fresh execution and evidence

| Check | Result | Limit |
|---|---|---|
| Existing Node security coverage settings, with native event and LCOV reporters | Passed405/405, no skips, exit0; 14.129s | Aggregate/file metrics; no per-test production coverage attribution |
| Original all-Playwright run, existing projects/config, list+JSON reporters | Incomplete: terminated at180-second ceiling; exit-15, 182.455s including termination | Console contains69 pass markers, 9 skip markers, 0 fail markers; no final JSON report. This is not an overall passing result |
| Skill follow-up: one existing desktop privacy case | Passed1/1, exit0; 2.209s | Valid native JSON report; source/test/config unchanged |
| Skill follow-up: all Playwright suites, native JSON reporter | Passed69, nine intentional skips, zero failures/flaky cases, exit0; 30.661s | All78 project instances in a structured ledger; browser production-code coverage still unmeasured |
| Input identity verification | No changed input hashes and unchanged HEAD | Does not turn historical browser/CI results into fresh evidence |
| Native/LCOV adapter cross-check | All27 file line and branch numerator/denominator pairs match; native function counts retained separately | Skill LCOV helper does not expose functions or per-test coverage |

The browser log reached case78; all case markers were emitted, but the command did not finish/report before termination. Whether finalization, server cleanup or host load caused the stall remains unverified. No assertion failure was identified in the captured markers. Do not replace the command's incomplete status with historical green checks. Nine skips are intentional project selections (mobile navigation, desktop navigation and desktop-only worker update cases), rather than low-quality tests.

Raw evidence is in [artifacts/test-quality-audit-2026-10-04](/Users/leonardwongly/Developer/ProjectPortfolio/artifacts/test-quality-audit-2026-10-04/coverage-normalized.json). before.json and after.json certify collection identity; execution JSON files preserve exact argv, versions, selected non-secret environment keys, timeout, exit and timestamps. The original browser record omitted PLAYWRIGHT_JSON_OUTPUT_NAME; its absolute output path is established by the hashed run-check.py:13, rather than claimed as a launch-recorded field. Other inherited reporter selectors were not captured in that original record. Follow-up provenance identifies the controlled reporter environment separately. events.jsonl contains native test names/locations and coverage counts; node-case-ledger.csv contains405 runtime cases, with per-test coverage explicitly unavailable. The20 runner file-wrapper events were excluded after matching the native405-case summary.

Reproduce the Node collection from the repository root by using the exact baseline-execution.json argv, or the existing npm run test:security:coverage command for the same includes/thresholds. The former adds only reporting destinations, preserving all five includes and75/75/85 enforcement. Node's documented [test:coverage event](https://nodejs.org/docs/latest-v24.x/api/test.html#event-testcoverage) supplies explicit covered/total counts; they were checked against native LCOV, rather than inferred from rounded console percentages.

## Coverage counts

| Metric | Covered / total | Strictly below25% file candidates |
|---|---|---|
| Lines | 11262/12699 (88.68%) | None |
| Branches | 3016/3800 (79.37%) | None |
| Functions | 755/801 (94.26%) | None |

The below-threshold candidate ledger is empty. This is a file-level filter. Lines are the Node producer's line counts, not statement coverage; no separate statement metric is available. Zero denominators would be not applicable; omitted files are unknown. Compatible counts were summed, never percentages averaged.

| Measured target | Lines | Branches | Functions |
|---|---|---|---|
| playwright.config.mjs | 130/139 (93.53%) | 16/22 (72.73%) | 7/7 (100.00%) |
| pwabuilder-sw.js | 165/165 (100.00%) | 58/58 (100.00%) | 15/15 (100.00%) |
| scripts/audit-reading-metadata.mjs | 223/254 (87.80%) | 63/79 (79.75%) | 11/13 (84.62%) |
| scripts/build-resume.mjs | 1006/1127 (89.26%) | 179/242 (73.97%) | 75/80 (93.75%) |
| scripts/build.js | 2208/2387 (92.50%) | 440/578 (76.12%) | 181/182 (99.45%) |
| scripts/check-link-health.mjs | 445/528 (84.28%) | 96/134 (71.64%) | 37/41 (90.24%) |
| scripts/check-performance-budget.mjs | 321/368 (87.23%) | 69/89 (77.53%) | 31/34 (91.18%) |
| scripts/check-production-scripts.mjs | 166/182 (91.21%) | 99/104 (95.19%) | 12/14 (85.71%) |
| scripts/check-production-smoke.mjs | 492/547 (89.95%) | 152/188 (80.85%) | 26/30 (86.67%) |
| scripts/check-repository-hygiene.mjs | 122/144 (84.72%) | 20/23 (86.96%) | 7/8 (87.50%) |
| scripts/check-resume-freshness.mjs | 344/405 (84.94%) | 93/122 (76.23%) | 17/18 (94.44%) |
| scripts/check-telemetry-policy.mjs | 744/855 (87.02%) | 376/434 (86.64%) | 35/36 (97.22%) |
| scripts/check-vendor-governance.mjs | 338/404 (83.66%) | 71/98 (72.45%) | 26/30 (86.67%) |
| scripts/check-vendor-upstream.mjs | 263/312 (84.29%) | 52/76 (68.42%) | 14/17 (82.35%) |
| scripts/check-workflow-hygiene.mjs | 1227/1413 (86.84%) | 388/479 (81.00%) | 55/58 (94.83%) |
| scripts/generate-book-webp.js | 408/483 (84.47%) | 67/101 (66.34%) | 20/20 (100.00%) |
| scripts/lib/asset-paths.cjs | 84/92 (91.30%) | 35/39 (89.74%) | 5/5 (100.00%) |
| scripts/lib/html-attributes.mjs | 177/211 (83.89%) | 66/89 (74.16%) | 5/6 (83.33%) |
| scripts/lib/html-document.mjs | 118/121 (97.52%) | 48/49 (97.96%) | 9/11 (81.82%) |
| scripts/lib/network-safety.mjs | 565/601 (94.01%) | 167/212 (78.77%) | 53/58 (91.38%) |
| scripts/lib/safe-input.cjs | 223/270 (82.59%) | 74/95 (77.89%) | 11/11 (100.00%) |
| scripts/lib/safe-output.cjs | 247/271 (91.14%) | 74/87 (85.06%) | 13/13 (100.00%) |
| scripts/lib/static-rendering.cjs | 32/32 (100.00%) | 5/5 (100.00%) | 4/4 (100.00%) |
| scripts/lib/vendor-policy.mjs | 164/183 (89.62%) | 58/73 (79.45%) | 11/12 (91.67%) |
| scripts/serve-static.mjs | 78/84 (92.86%) | 32/34 (94.12%) | 4/5 (80.00%) |
| scripts/update-vendor.mjs | 802/927 (86.52%) | 165/222 (74.32%) | 54/56 (96.43%) |
| scripts/web-bot-auth.mjs | 170/194 (87.63%) | 53/68 (77.94%) | 17/17 (100.00%) |

## Omitted targets and independent decisions

| Target | Evidence status | Decision / unique protection / next action |
|---|---|---|
| js/main.js | outside current coverage include; percentage unknown | Improve: add browser coverage and targeted theme/storage, native-share/clipboard and real waiting-worker upgrade oracles; retain current UI/worker regressions. |
| js/site.js | outside current coverage include; percentage unknown | Improve: add pointer/reduced-motion/card-state behavior cases and browser instrumentation; retain governed runtime inventory. |
| js/vendor/workbox-sw.js | vendor excluded; percentage unknown | Retain vendor governance and real-worker regressions; numerical adequacy blocked by intentional exclusion. Do not rewrite/remove vendored files to inflate coverage. |
| js/vendor/workbox/workbox-core.prod.js | vendor excluded; percentage unknown | Retain vendor governance and real-worker regressions; numerical adequacy blocked by intentional exclusion. Do not rewrite/remove vendored files to inflate coverage. |
| js/vendor/workbox/workbox-navigation-preload.prod.js | vendor excluded; percentage unknown | Retain vendor governance and real-worker regressions; numerical adequacy blocked by intentional exclusion. Do not rewrite/remove vendored files to inflate coverage. |
| js/vendor/workbox/workbox-routing.prod.js | vendor excluded; percentage unknown | Retain vendor governance and real-worker regressions; numerical adequacy blocked by intentional exclusion. Do not rewrite/remove vendored files to inflate coverage. |
| js/vendor/workbox/workbox-strategies.prod.js | vendor excluded; percentage unknown | Retain vendor governance and real-worker regressions; numerical adequacy blocked by intentional exclusion. Do not rewrite/remove vendored files to inflate coverage. |
| scripts/check-markdown-negotiation.mjs | matching include but not loaded; percentage unknown | Improve: add hermetic Accept/Vary/content-type/status and origin/timeout cases; retain shared network safety tests, which do not prove this consumer wiring. |

The shell script scripts/security-smoke.sh and YAML workflows also have no V8 coverage metric; they have behavioral/textual tests audited below. Browser-executed inline page scripts are not numerically measured. Default Node excludes node_modules and test files; the five unchanged includes are scripts/**/*.js, scripts/**/*.mjs, scripts/**/*.cjs, playwright.config.mjs and pwabuilder-sw.js. No coverage-disable/ignore directives were found in the inventoried first-party code. “Included but never loaded” for check-markdown-negotiation is a report omission, not measured0%.

## Priority cases that need stronger oracles

P1 means a security, release-gate or data-preservation contract can be missed; P2 means meaningful behavior/boundary coverage is incomplete. These are priorities, not quality percentages. All cases remain useful and are retained. Static defect-sensitivity explanations below are not executed mutation results.

| Priority / case | Observed weakness and risk | Proposed oracle / acceptance | Independent decision |
|---|---|---|---|
| P1: negative resume freshness cases<br>[tests/security/resume-build.test.mjs:88](/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/resume-build.test.mjs:88) | assertIssue checks an issue code but not ok:false; a release gate returning true with preserved diagnostics can pass. | Require ok:false, consistent failures and a bounded negative CLI nonzero exit. | Build reviewer: improve; independent reviewer retained the negative/resource contracts. |
| P1: nth publication failure restores the exact prior bundle<br>[tests/security/resume-build.test.mjs:932](/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/resume-build.test.mjs:932) | Only fourth-write ordinary rollback is checked; external destination edits and rollback ownership are untested. Source-derived concurrent-overwrite concern, not reproduced. | Controlled first/middle/final failures and foreign destination edits must preserve external bytes/inode, owned rollback, primary+rollback errors and cleanup. | Independent retain/improve; concurrent-source concern requires a disposable failing regression before a source fix. |
| P1: pinned HTTPS request enforces declared and streamed byte limits<br>[tests/security/network-safety.test.mjs:156](/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/network-safety.test.mjs:156) | Streamed overflow is one65-byte chunk; a per-chunk-only implementation still passes. | At max64:32+32 succeeds with exact bytes;32+33 rejects with request/response destruction; retain declared-size failure. | Independent improve. |
| P1: pinned HTTPS wall timeout covers DNS, headers, body<br>[tests/security/network-safety.test.mjs:182](/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/network-safety.test.mjs:182) | No-op destroy fixtures cannot detect resource leakage after rejection. | Destroy spies, late DNS/header guards, no requests after timeout and bounded controlled settlement. | Independent improve. |
| P1: DNS validation rejects malformed/unsafe answers<br>[tests/security/network-safety.test.mjs:40](/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/network-safety.test.mjs:40) | Negative fixtures are single-answer; validating only the first record can miss mixed public/private answers. | Both answer orders and malformed second record reject with zero transport; all-public control passes. | Operations reviewer improve; independent retained DNS boundary. |
| P2: hashes the exact byte range for ArrayBuffer views<br>[tests/security/web-bot-auth.test.mjs:130](/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/web-bot-auth.test.mjs:130) | Fixture has offset0 and full underlying buffer; ignoring offset/length still passes. | Use subarray and DataView with nonzero offset plus distinct prefix/suffix; independent payload-only digest. | Independent improve. |
| P2: typing a search does not persist free-form text into URL<br>[tests/integration/mobile-nav-and-accordion.spec.mjs:674](/Users/leonardwongly/Developer/ProjectPortfolio/tests/integration/mobile-nav-and-accordion.spec.mjs:674) | Only absence of q after250ms; a disconnected search listener passes. | Await observable filtering/empty state; inspect URL/history without query text; retain explicit-share query behavior separately. | Independent improve; original completion blocked, successful follow-up recorded below. |
| P2: filter buttons expose selected state<br>[tests/integration/mobile-nav-and-accordion.spec.mjs:652](/Users/leonardwongly/Developer/ProjectPortfolio/tests/integration/mobile-nav-and-accordion.spec.mjs:652) | ARIA-only state does not prove selected books, count or combined filters. | Assert independently computed identities/counts and year/tag/view constraints alongside ARIA. | Independent improve. |
| P2: rendered action links include telemetry annotations<br>[tests/security/build-validation.test.mjs:1047](/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/build-validation.test.mjs:1047) | Case invokes profile schema and reading grid rather than actual action anchors. | Build/render real hero/contact anchors; require exact governed telemetry fields and absence of raw labels/URLs/PII. | Build reviewer improve. |
| P2: Playwright cleans staging on exit<br>[tests/security/playwright-config.test.mjs:31](/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/playwright-config.test.mjs:31) | Empty/nonexistent stdout path satisfies cleanup; failed partial staging lacks lifecycle oracle. | Require structured absolute owned stage path, existence before exit, bounded subprocess and removal afterward; hostile isolated stage fixtures. | Independent retain/improve; possible failure leak unreproduced. |
| P2: target=_blank and dangerous-scheme policy cases<br>[tests/security/policy-regression.test.mjs:300](/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/policy-regression.test.mjs:300) | Source regexes miss browser-equivalent quote/case/entity syntax and may inspect inert text. | Use parsed operative attributes and valid-baseline, single-change variants; preserve independent policy guards. | Independent improve. |
| P2: outbound signature / inline CSP hash checks<br>[tests/security/web-bot-auth.test.mjs:34](/Users/leonardwongly/Developer/ProjectPortfolio/tests/security/web-bot-auth.test.mjs:34) | Expected canonicalization/digests reuse production helpers, allowing correlated faults. | Independent complete signature base/known digest, covered-field tampering and exact CSP set membership. | Independent improve. |
| P2: real worker activation / mocked update cases<br>[tests/integration/offline-fallback.spec.mjs:68](/Users/leonardwongly/Developer/ProjectPortfolio/tests/integration/offline-fallback.spec.mjs:68) | Fresh install plus mocks does not prove a native active-old→waiting-new→message→reload upgrade. | Versioned native worker with observed waiting/message/activation and exactly-one reload; preserve cache-clear offline cases. | Browser reviewer retain/improve; separate platform integration. |
| P2: all-page axe sweep<br>[tests/integration/accessibility-smoke.spec.mjs:19](/Users/leonardwongly/Developer/ProjectPortfolio/tests/integration/accessibility-smoke.spec.mjs:19) | Default closed states omit opened nav/palette, expanded accordion and worker prompt. | Scan actual opened states and verify focus/name/keyboard contracts with fixtures. | Retain fourteen page/theme cases; add state coverage. |

Additional per-case improvements in the complete appendices cover canonical record/field placement, independent reading digests, single-failure header/HSTS fixtures, exact performance/parser/publication budgets, raw-byte integrity, retry recovery, correct race-injection timing, partial-I/O cleanup, concurrent readers, hostile exporter outputs, archive/schema boundaries, real nonregular server fixtures, bounded fixture teardown, ordinal search mocks, vendor after-read races, header/component/key validation, focus restoration, theme/storage/reduced-motion and share cancellation/fallback. No assertion is relaxed and no unique rare security protection is proposed for removal.

## Independent evaluation and plan

Four domain reviewers inspected every case across all23 files. Several authored earlier security regressions; their self-authorship is disclosed in their appendices and does not constitute independent deletion approval. Fresh reviewer /root/test_quality_independent received only raw source/tests/config, before.json, coverage artifacts, contracts, candidate scope and the audit procedure. It did not read the authors’ proposed conclusions before its initial decision. It independently inspected six candidate suites and all omitted/low-file targets. Verdict: no measured below25 targets; retain all candidates; improve the byte-range, privacy, cleanup, policy, signature and rollback oracles; remove none. Browser execution adequacy remained blocked. The build reviewer also delegated60 artifact/output cases to an independent read-only child.

Conservative reconciliation: preserve all current tests. Prioritize P1 gate/ownership/resource oracles, then independent crypto/digest and behavior assertions, then syntax/state/budget/format and instrumentation gaps. Do not weaken leading-slash or dot rejection to hit a redundant static-server prefix branch; if that defensive helper needs unit coverage, isolate its pure containment contract. Avoid expanding the site/link monitor inventory merely because the separate production-smoke manifest has eight pages; first establish each tool’s intended contract.

| Phase | Task | Owner | Dependency / cost | Acceptance |
|---|---|---|---|---|
| 1 | Fail-closed freshness, mixed DNS, cumulative bounds and cleanup | Test maintainer | Current fixtures; small/moderate | Strengthened negative cases fail for the specific broken contract and pass correct positives |
| 2 | Resume ownership regression and stage-failure lifecycle | Test + source owner | Disposable controlled seams; moderate | Foreign bytes survive; typed primary/cleanup errors retained; source remediation separately scoped |
| 3 | Independent byte-range/signature/hash, content placement and header fixtures | Domain maintainers | Known-answer bytes/parsed attributes; small/moderate | Shared implementation faults cannot satisfy both expected and actual |
| 4 | Reading/filter/share/native worker upgrade/open-state accessibility | Browser maintainer | Existing Chromium harness, explicit synchronization; moderate | Observe actual user behavior and exactly required privacy/focus/reload/cache outcomes |
| 5 | Browser/Markdown instrumentation and unexecuted CLI/exporter contracts | Tooling maintainer | Measure without narrowing includes; moderate | Unknown targets become honestly measured or retain a documented evidence boundary |

## All-file inspection and runtime ledger

| Test file | Fresh Node cases / browser inventory | Inspection |
|---|---|---|
| tests/integration/accessibility-smoke.spec.mjs | 28 passed (14 names ×2 projects) | All cases inspected; retain/improve ledger below |
| tests/integration/mobile-nav-and-accordion.spec.mjs | 33 passed, nine intentional project skips (21 names ×2 projects) | All cases inspected; retain/improve ledger below |
| tests/integration/offline-fallback.spec.mjs | 4 names ×2 projects | All cases inspected; retain/improve ledger below |
| tests/security/build-validation.test.mjs | 42 passed | All cases inspected; retain/improve ledger below |
| tests/security/content-parity.test.mjs | 4 passed | All cases inspected; retain/improve ledger below |
| tests/security/generate-book-webp-security.test.mjs | 24 passed | All cases inspected; retain/improve ledger below |
| tests/security/html-document.test.mjs | 7 passed | All cases inspected; retain/improve ledger below |
| tests/security/network-safety.test.mjs | 19 passed | All cases inspected; retain/improve ledger below |
| tests/security/ops-scripts.test.mjs | 30 passed | All cases inspected; retain/improve ledger below |
| tests/security/playwright-config.test.mjs | 4 passed | All cases inspected; retain/improve ledger below |
| tests/security/policy-regression.test.mjs | 27 passed | All cases inspected; retain/improve ledger below |
| tests/security/production-scripts.test.mjs | 16 passed | All cases inspected; retain/improve ledger below |
| tests/security/production-smoke.test.mjs | 7 passed | All cases inspected; retain/improve ledger below |
| tests/security/resume-build.test.mjs | 22 passed | All cases inspected; retain/improve ledger below |
| tests/security/safe-output.test.mjs | 14 passed | All cases inspected; retain/improve ledger below |
| tests/security/security-smoke.test.mjs | 5 passed | All cases inspected; retain/improve ledger below |
| tests/security/service-worker-message.test.mjs | 10 passed | All cases inspected; retain/improve ledger below |
| tests/security/static-server.test.mjs | 5 passed | All cases inspected; retain/improve ledger below |
| tests/security/vendor-governance.test.mjs | 14 passed | All cases inspected; retain/improve ledger below |
| tests/security/vendor-refresh.test.mjs | 36 passed | All cases inspected; retain/improve ledger below |
| tests/security/vendor-upstream.test.mjs | 13 passed | All cases inspected; retain/improve ledger below |
| tests/security/web-bot-auth.test.mjs | 9 passed | All cases inspected; retain/improve ledger below |
| tests/security/workflow-hygiene.test.mjs | 97 passed | All cases inspected; retain/improve ledger below |

## Zero-call function entries

The native producer records46 function entries with count0 (including anonymous callbacks and CLI entrypoints). This is execution evidence for this selected suite, not a body-line percentage, quality score or proof no other/manual/hosted test calls them. Named gaps include real Playwright loader/exporter integration, operational CLI/error handlers and network callback branches.

| Target:line | Function name | Recorded calls |
|---|---|---|
| scripts/audit-reading-metadata.mjs:29 | fail | 0 |
| scripts/audit-reading-metadata.mjs:235 | (anonymous) | 0 |
| scripts/build-resume.mjs:564 | get expired | 0 |
| scripts/build-resume.mjs:576 | (anonymous) | 0 |
| scripts/build-resume.mjs:590 | loadPlaywrightChromium | 0 |
| scripts/build-resume.mjs:1090 | main | 0 |
| scripts/build-resume.mjs:1095 | (anonymous) | 0 |
| scripts/build.js:1654 | (anonymous) | 0 |
| scripts/check-link-health.mjs:214 | (anonymous) | 0 |
| scripts/check-link-health.mjs:345 | (anonymous) | 0 |
| scripts/check-link-health.mjs:499 | (anonymous) | 0 |
| scripts/check-link-health.mjs:501 | (anonymous) | 0 |
| scripts/check-performance-budget.mjs:350 | (anonymous) | 0 |
| scripts/check-performance-budget.mjs:352 | (anonymous) | 0 |
| scripts/check-performance-budget.mjs:357 | (anonymous) | 0 |
| scripts/check-production-scripts.mjs:112 | (anonymous) | 0 |
| scripts/check-production-scripts.mjs:171 | (anonymous) | 0 |
| scripts/check-production-smoke.mjs:135 | sleep | 0 |
| scripts/check-production-smoke.mjs:175 | (anonymous) | 0 |
| scripts/check-production-smoke.mjs:515 | (anonymous) | 0 |
| scripts/check-production-smoke.mjs:158 | (anonymous) | 0 |
| scripts/check-repository-hygiene.mjs:117 | formatFindings | 0 |
| scripts/check-resume-freshness.mjs:387 | (anonymous) | 0 |
| scripts/check-telemetry-policy.mjs:842 | (anonymous) | 0 |
| scripts/check-vendor-governance.mjs:131 | getTodayIsoDate | 0 |
| scripts/check-vendor-governance.mjs:145 | sha256File | 0 |
| scripts/check-vendor-governance.mjs:377 | main | 0 |
| scripts/check-vendor-governance.mjs:386 | (anonymous) | 0 |
| scripts/check-vendor-upstream.mjs:126 | sleep | 0 |
| scripts/check-vendor-upstream.mjs:281 | main | 0 |
| scripts/check-vendor-upstream.mjs:297 | (anonymous) | 0 |
| scripts/check-workflow-hygiene.mjs:231 | (anonymous) | 0 |
| scripts/check-workflow-hygiene.mjs:892 | consumeTimePrefix | 0 |
| scripts/check-workflow-hygiene.mjs:1387 | formatFindings | 0 |
| scripts/lib/html-attributes.mjs:78 | (anonymous) | 0 |
| scripts/lib/html-document.mjs:35 | adapter.insertTextBefore | 0 |
| scripts/lib/html-document.mjs:41 | (anonymous) | 0 |
| scripts/lib/network-safety.mjs:302 | (anonymous) | 0 |
| scripts/lib/network-safety.mjs:309 | (anonymous) | 0 |
| scripts/lib/network-safety.mjs:560 | (anonymous) | 0 |
| scripts/lib/network-safety.mjs:581 | (anonymous) | 0 |
| scripts/lib/network-safety.mjs:357 | (anonymous) | 0 |
| scripts/lib/vendor-policy.mjs:166 | assertPublicVendorUrl | 0 |
| scripts/serve-static.mjs:80 | (anonymous) | 0 |
| scripts/update-vendor.mjs:886 | main | 0 |
| scripts/update-vendor.mjs:908 | (anonymous) | 0 |

## Skill invocation follow-through — browser completion and report review

The user explicitly invoked audit-test-quality after the original audit. Follow-up began at2026-10-04T07:11:29.699Z (15:11 Singapore). All131 recorded source/test/config/lock/dependency inputs and HEAD still match. The untracked audit report was preserved; no source or test changed. Two bounded browser invocations were used within the fresh15-minute/ten-invocation ceiling: one focused case and one final full suite; no mutation probes, dependency installation or further whole-suite repetition.

The focused case passed and the complete browser run finished with69 passed, nine expected skips, zero unexpected/flaky cases and exit0. Both used the existing configuration and unused loopback ports, with native JSON sent to a captured stdout file and non-secret worker/server lifecycle diagnostics. The full report independently reconciles all78 case/project instances; browser-case-ledger.json retains actual per-case results. This changes reporting and the task port, not test selection or assertions in the final run.

The final diagnostics show test-task and webserver teardown completion. Installed Playwright source inspection places worker/task cleanup before reporter completion and normally force-kills the webserver process group when gracefulShutdown is unset. A worker/browser or staged-directory cleanup stall is a plausible explanation for the old run, but its cause was not reproduced or established. The original timeout and raw log remain unchanged; the successful follow-up is separate evidence rather than a rewrite of that history.

The independent report-consistency reviewer confirmed coverage counts, per-file metrics, minimums, eight omissions,46 zero-call function entries,405 Node case IDs, source/report identities, conservative decisions and improvement acceptance plans. Its two corrections are now applied: distinguish per-case execution from per-test production coverage attribution, and qualify wrapper-derived original reporter environment. Prior independent per-case review remains preserved in the appendices.

Follow-up evidence: artifacts/test-quality-audit-2026-10-04/skill-follow-up-2026-10-04/{before.json,after.json,focused-execution.json,focused-results.json,full-execution.json,full-results.json,browser-case-ledger.json,full-diagnostics.log,run-browser.py,reporter-environment-provenance.json}. Old and new execution environments are described only by recorded/controlled keys; no full environment or credential values were exported.

## Applied changes, verification limits and next action

No source/test changes or removals; before/after behavioral protection and collection settings are identical. No deletion patch is required. Coverage baseline is fresh and verified; no “after remediation” improvement is claimed. No mutation tooling was installed or probes executed, so there is no mutation score. No real Pandoc/cwebp export, device/Firefox/WebKit, hosted CI, deployment or production validation is claimed by this extension.

The original browser run remains an incomplete historical attempt. The skill follow-up closes current browser completion verification with a fresh successful structured result. Next implementation action: strengthen the prioritized gate, ownership, resource and user-behavior oracles under explicit remediation scope; capture before/after protection under identical collection settings. Do not rerun suites without a change, failure or unresolved concern. Applying source/test fixes, deletions, commits or pushes is not implied by this audit-only skill invocation.

## Raw domain and independent-review appendices

The following full reports preserve every inspected test ID, detailed finding, oracle, protected behavior, dependency/cost/priority and reviewer-authorship limitation. Their relative paths resolve against the root stated above. Static reviewers’ “no execution” statements describe their own activity; root’s fresh execution results above supersede only runtime status, not their findings.

---

# Appendix: Build and artifacts

# Static test-quality audit: build, artifact, parser and local-server contracts

Audit target: `/Users/leonardwongly/Developer/ProjectPortfolio`, HEAD `11362edc`. Scope is exactly the eight requested `tests/security/*.test.mjs` files. All 114 declared cases, expanding to 122 cases through the four build parameterized groups, were reviewed. Direct inspection covered build-validation, content-parity, html-document, static-server and playwright-config. An independent child inspected all 24 WebP, 22 resume and 14 safe-output cases and their production contracts.

This is an audit-only report: no tests, coverage collection, mutation probes, source/test edits, signing, commits, deletion or external calls were performed. Root owns fresh execution/coverage evidence. Findings below are static oracle analysis; hypothetical defects are not reported as experimentally killed/survived mutations. No test-removal recommendation is made. File-level coverage percentages and arbitrary quality scores were not used.

Method: read `audit-test-quality/SKILL.md`, `references/evaluation.md`, `references/evidence.md`, and `references/report.md`; inspect test setup, stimulus, oracle, cleanup and corresponding production boundaries. Local provenance hashes and complete declaration inventory are in `/private/tmp/portfolio-test-audit-build-evidence.json`; hashes are SHA-256, not coverage evidence. The independent reviewer received raw files/contracts and the audit procedure without proposed verdicts.

## Concrete improvements

### A1 — Freshness failures do not assert the release gate rejects them (high priority, high confidence)

`tests/security/resume-build.test.mjs:88` helper `assertIssue` checks only that an issue code exists. Negative freshness cases at lines 364, 390, 406, 476, 519 and 538 use it without asserting `result.ok === false`. `scripts/check-resume-freshness.mjs:376` returns the gate bit; the CLI at 384–391 selects pass/fail from that bit. A defect returning `ok: true` with preserved issues can satisfy these negative oracles while the CLI succeeds. The success case at test line 359 is valuable and does not cover this negative contract.

Smallest oracle improvement: have `assertIssue` also require `ok === false`, a nonempty failures array, and `failures` consistent with issue messages. Add one bounded child-process negative CLI case requiring nonzero status. Retain every distinct malformed/race fixture; this is not a duplication/removal finding. No mutation was executed.

### A2 — Resume bundle rollback lacks concurrent ownership preservation coverage (high priority, high confidence)

`tests/security/resume-build.test.mjs:932`, “nth publication failure restores the exact prior bundle and leaves no temporary files,” injects one fourth-write failure and verifies ordinary rollback. `scripts/build-resume.mjs:838` restores an existing destination with `writeFileNoFollow` without proving it still belongs to the publisher or passing `expectedDestination`. The resume publisher at 822 also passes no preflight destination snapshot into publication. A replacement/edit by another actor before a later publication failure is not exercised; the rollback test would overwrite that edit and still satisfy its expected-original-bytes oracle. This is a statically identified production concern, not a reproduced disclosure or race.

Add disposable-fixture cases for an existing destination modified during a later write, and for an existing destination edited during rollback preparation. Oracle: the external bytes/inode survive, owned sibling outputs restore, both publication and rollback failures are reported, and no owned temporary files remain. Parameterize representative first/middle/final publication failures and an initially absent output; count only actually distinct branches. Compare the already valuable site-publisher ownership cases at build-validation lines 580, 781, 825 and 853 when designing the contract, rather than declaring the two publishers interchangeable.

### A3 — Telemetry test never exercises action links (medium priority, high confidence)

`tests/security/build-validation.test.mjs:1047`, “rendered action links include privacy-safe telemetry annotations,” calls `renderProfileSchema` and `renderReadingGrid`, then asserts absence of `data-telemetry` in JSON-LD and presence of `data-reading-count`. The action-link implementation is `scripts/build.js:1026` and emits four `data-telemetry-*` fields at 1033–1038. Removing those attributes would not affect this case's assertions.

Use `buildSite` with distinctive hero/contact action labels and internal/fragment/external/PDF destinations, then inspect the actual anchor attributes. Require the governed event name, normalized bounded action/surface, correct destination class, and no raw href/label/PII in telemetry fields. Keep the schema and reading-count assertions under names that describe their actual protection.

### A4 — Playwright staging-cleanup oracle accepts an empty or wrong reported path (medium priority, high confidence)

`tests/security/playwright-config.test.mjs:31`, “Playwright rejects an explicitly empty configured port and cleans staging on exit,” checks the successful child's status and `existsSync(stdout.trim()) === false` at 46–47. An empty output or arbitrary nonexistent path passes the cleanup assertion. Both subprocesses lack an explicit timeout. Production staging at `playwright.config.mjs:59–69` occurs before its exit cleanup is registered at 86; a midway missing/symlinked/unsupported artifact failure also has no test.

Improve the child protocol to report a structured absolute staging path plus an explicit pre-exit `exists === true` observation, validate the unique temporary prefix, require no child error/signal and a bounded timeout, then require the same path is absent after exit. Add disposable copied-source cases for a missing allowed artifact, a symlink under an allowed directory, and an unsupported file type. Require fail-closed exit and cleanup of any created private stage. The latter would expose a source lifecycle gap visible statically; do not claim it was reproduced.

### A5 — Canonical parity checks miss record placement and link semantics (medium priority, high confidence)

`tests/security/content-parity.test.mjs:84` checks community fields against the entire section at 116–134, education/certifications against the whole credentials section at 137–151, and skills against the whole skills section at 155–158. Swapping responsibilities between community organizations, moving a skill into another category, or moving a credential link/date into another row can preserve all expected strings. Article/project link checks at 99–100 and 244–248 similarly accept URLs as incidental text rather than the correct anchor destination. `scripts/build.js:1403`, 1463 and 1608 render these associations explicitly.

Parse generated DOM into per-record cards/rows (using identifiers and role-specific selectors), compare exact field text/list sequence and cardinalities, and compare `href`, image `src`/`alt`, and accordion relationships as attributes. Keep the independent canonical JSON-to-committed-HTML boundary, existing exact card counts, flagship ordering, case-study coverage and next-study links. These tests protect committed content and are not wholesale redundant with builder-unit tests.

### A6 — Static server prefix-sibling fixture does not reach the post-resolution containment guard (medium priority, high confidence)

`tests/security/static-server.test.mjs:61`, “static server rejects absolute URL paths and prefix siblings before entering the file reader,” is a valuable request-level guard test with a reader-entry spy and outside canary. However its absolute sibling targets begin with decoded `//`, and its relative sibling targets contain `..`; every negative fixture is rejected at `scripts/serve-static.mjs:48–50` before `path.resolve` at 55 and the new separator-aware prefix check at 57. It therefore does not independently distinguish removal of that latter check. The filesystem-root positive at line 93 is a useful narrow unit test and should remain labeled as such; its mocked reader cannot establish real HTTP/no-follow behavior.

Retain all request cases. If the containment branch itself is intended as an independently enforced contract, expose the pure normalized containment/path-resolution boundary and table-test root '/', nested child, exact root, and a root-prefix sibling; require rejection before invoking the reader. Do not weaken upstream rejection merely to make a branch reachable. No file disclosure has been reproduced: the shared reader also checks containment before filesystem access.

### A7 — “non-regular files” server case only reaches a missing clean-route path (medium priority, high confidence)

`tests/security/static-server.test.mjs:110` includes `/css/` as its apparent directory fixture. The extensionless clean-route mapping in `scripts/serve-static.mjs:54` turns it into `css/.html`, which is absent; it does not ask the reader to open the existing `css` directory. Add a directory whose pathname already has an extension (e.g. `directory.html`) and request it directly. Add a hard-linked regular file case; on supported platforms, add a FIFO/special-file fixture with a strict request/test timeout so regression cannot hang. Require 404, empty response, unchanged outside canary, and normal-file positives. Keep traversal, hidden path and symlink cases.

### A8 — Local-server test setup has unbounded failure paths (medium priority, high confidence)

`tests/security/static-server.test.mjs:17` awaits `server.listen` with no error listener/rejection and registers cleanup only after successful listening. Listener failures can leave the promise pending and the temporary root unregistered. Requests at 24–32 have no timeout. This is a test-lifecycle weakness, not an HTTP product vulnerability.

Register cleanup immediately after creating resources, reject listen errors, set bounded request/test deadlines, and close/destroy outstanding request/socket resources on failure. Preserve the real HTTP positives and 100-request complete-response stress oracle at 56–57; that case checks successful concurrent reads, not publication atomicity.

### A9 — Hash expectations share the helper under test (low priority, high confidence)

The script-hash cases at `tests/security/build-validation.test.mjs:1124–1203` compare scanner output to `hashInlineScript`, while injection at 1212 compares output to `renderCspScriptHashesDirective`. These are strong scanner/plumbing fixtures, including 6,000 distinct bodies and browser-sensitive attributes, but a shared hash-helper defect (wrong digest algorithm/prefix/encoding) can leave expected and actual values agreeing. At 466–469 the literal-template regression's hash checks also loop over collector output without requiring a nonempty exact expected set.

Retain the scanner fixtures. Add a fixed independently known UTF-8 SHA-256/base64 oracle (including non-ASCII script bytes), and independently parse the final generated JSON-LD body and require its exact hash appears in both CSP representations. Add a raw CRLF/CR script fixture to distinguish literal source bytes from the browser-normalized script body contract; specify the intended browser CSP semantics rather than deriving expected values from the same custom parser.

### A10 — Some security budgets have only reject-side checks (low priority, high confidence)

`tests/security/html-document.test.mjs:70` rejects multibyte input over the byte budget, oversized node trees and invalid options, but does not pair the UTF-8 byte edge with exact-budget acceptance or verify the exact node acceptance edge. `static-server.test.mjs:123` rejects 32 MiB + 1 but has no zero-byte acceptance (the reader intentionally uses `minBytes: 0`) or exact-budget response/HEAD positive. Port cases at static-server 129 and playwright-config 24 omit accepted endpoints 1 and 65535. Build-validation imports `MAX_SITE_OUTPUT_BYTES` but has no explicit site-publisher exact output cap/max-plus-one/empty entry boundary case for `scripts/build.js:1960–2001`.

Add focused accept/reject pairs where an off-by-one defect changes the public contract; avoid dozens of mirrored implementation-value assertions. For site publication require invalid late entries cause zero writes and existing outputs unchanged. For node budgets use documented parser node accounting and distinct creation/traversal scenarios; do not present the existing common error message as proof both internal phases were reached.

## Valuable cases to retain

- Build import deferral uses an empty cwd and a bounded real child process; input reader checks exact input cap, no-follow/nonblocking flags, descriptor-bound stats, hard links, parent symlinks, fatal UTF-8 and unlink-after-open races.
- Dollar/token interpolation cases drive the actual `buildSite`, parse JSON-LD, verify metadata/body/navigation, and separate authored tokens from literal data.
- Site publisher tests cover preflight before any write, exact binary restoration, all rendered outputs, lock exclusion/replacement ownership, destination drift, post-write failures, identical-byte/different-inode replacement, and rollback-preparation edits. These are distinct failure/ownership contracts.
- Generated content parity's exact flagship/card counts, ordering, governed case-study coverage, architecture/decision associations and next-study links bind canonical data to committed deliverables.
- HTML tests use the real parse5 adapter rather than a fake DOM. Browser attribute namespaces, single entity decoding, scripting-sensitive noscript, templates, fail-closed parse recovery and nested foreign-script output limits are valuable security fixtures.
- Static server normal clean/nested routes, real HTTP HEAD/MIME/cache behavior, outside canary, reader-entry spy, traversal/hidden/symlink denial and the '/'-root unit regression serve different contracts.
- Artifact/output retention decisions for the independently inspected three files are in the per-case ledger and supplemental independent notes below.

## Prioritized plan

1. Strengthen the resume negative gate oracle (A1) and add realistic concurrent resume publication/rollback ownership cases (A2). Treat any resulting source fix as separately authorized implementation and revalidate both site/resume transaction contracts.
2. Exercise actual action anchors (A3), make stage lifecycle evidence non-vacuous and bounded (A4), and associate parity fields with their intended record/attribute (A5).
3. Close server fixture/lifecycle gaps (A6–A8), preserving the layered containment reader and request-level tests.
4. Add independent fixed cryptographic/JSON round-trip expectations and meaningful exact-budget acceptance/rejection pairs (A9–A10); use the independent artifact/output notes to select any remaining boundary cases.
5. Root should combine this static analysis with fresh attributable execution/coverage evidence and independent review before proposing changes. Coverage may locate unexecuted production paths; it must not grade these cases. No deletion is justified by this audit.

## Per-file inspection ledger

Every declaration listed below was read in full together with its fixture/helper and current production contract. “Retain; improve” means keep the protection and strengthen the specific oracle/fixture; unflagged cases are retained within their stated scope, without claiming exhaustive contract coverage. The build parameterized declarations at lines 410, 485, 782 and 826 respectively expand to 4, 4, 2 and 2 reviewed variants: `$$`, `$&`, dollar-backtick, dollar-apostrophe; index/case template/nav/footer; existing/new target; failed/successful writer. The count is 42 build cases, not 34.

### tests/security/build-validation.test.mjs

| Line | Reviewed case | Decision / scope |
|---:|---|---|
| 285 | build module import defers all project input reads | Retain: oracle protects its stated stimulus/contract |
| 311 | build input readers enforce the byte boundary and reject linked or malformed sources | Retain: oracle protects its stated stimulus/contract |
| 410 | buildSite preserves literal ${sequence} in validated page and case-study content | Retain: oracle protects its stated stimulus/contract |
| 441 | buildSite preserves literal template-looking content without changing markup or JSON-LD | Retain; improve: A9 exact final hash |
| 485 | buildSite rejects unknown authored tokens in ${sourcePath} before publication | Retain: oracle protects its stated stimulus/contract |
| 498 | buildSite lock-scopes every rendered page and restores the bundle after an nth-write failure | Retain: oracle protects its stated stimulus/contract |
| 580 | site rollback preserves a published path that changed ownership and still restores owned pages | Retain: oracle protects its stated stimulus/contract |
| 632 | site lock cleanup preserves a replacement lock and reports both operation and ownership failures | Retain: oracle protects its stated stimulus/contract |
| 662 | site publication preflights every target and rejects destination or writer drift | Retain: oracle protects its stated stimulus/contract |
| 782 | site publication preserves an external edit during temp writing (${destinationExists ? 'existing' : 'new'} target) | Retain: oracle protects its stated stimulus/contract |
| 826 | site publication preserves a post-write replacement with identical generated bytes (${throwAfterWrite ? 'failed' : 'successful'} writer) | Retain: oracle protects its stated stimulus/contract |
| 853 | site rollback preserves an external edit made while preparing restoration | Retain: oracle protects its stated stimulus/contract |
| 900 | sanitizeHref allows https and safe relative links | Retain: oracle protects its stated stimulus/contract |
| 907 | sanitizeHref blocks dangerous schemes | Retain: oracle protects its stated stimulus/contract |
| 920 | sanitizeAssetPath blocks traversal and absolute paths | Retain: oracle protects its stated stimulus/contract |
| 927 | validateDataCollections accepts valid payload | Retain: oracle protects its stated stimulus/contract |
| 932 | validateDataCollections accepts certifications without public links | Retain: oracle protects its stated stimulus/contract |
| 939 | validateDataCollections accepts articles without public links | Retain: oracle protects its stated stimulus/contract |
| 946 | validateDataCollections rejects unknown top-level collections | Retain: oracle protects its stated stimulus/contract |
| 953 | validateDataCollections rejects malformed payloads | Retain: oracle protects its stated stimulus/contract |
| 1001 | validateDataCollections rejects incomplete or mismatched case studies | Retain: oracle protects its stated stimulus/contract |
| 1031 | renderReadingGrid escapes data attribute filter values | Retain: oracle protects its stated stimulus/contract |
| 1047 | rendered action links include privacy-safe telemetry annotations | Retain; improve: A3 real action anchors |
| 1064 | validateReadingAssetInventory requires declared cover files to exist | Retain: oracle protects its stated stimulus/contract |
| 1084 | validateReadingAssetInventory rejects symlinked and non-regular covers without following outside links | Retain: oracle protects its stated stimulus/contract |
| 1124 | collectInlineScriptHashes only hashes inline scripts | Retain; improve: A9 independent fixed hash |
| 1139 | collectInlineScriptHashes treats quoted greater-than signs as attributes and finds src in either position | Retain; improve: A9 retain scanner fixture |
| 1154 | collectInlineScriptHashes skips commented markup and handles script self-closing syntax like a browser | Retain; improve: A9 retain browser scanner fixture |
| 1168 | collectInlineScriptHashes handles tolerant script end tags | Retain; improve: A9 retain end-tag scanner fixture |
| 1183 | collectInlineScriptHashes distinguishes data-src from a valueless src attribute | Retain; improve: A9 retain attribute scanner fixture |
| 1192 | collectInlineScriptHashes returns every exact hash for a large document | Retain; improve: A9 retain large-document completeness |
| 1206 | stripTrailingWhitespace preserves mixed line endings while trimming each line | Retain: oracle protects its stated stimulus/contract |
| 1212 | injectCspScriptHashes replaces the template token with computed hashes | Retain; improve: A9 independent hash/directive |
| 1222 | renderProfileSchema escapes script-breaking JSON-LD content | Retain; improve: add JSON.parse round-trip for script-breaking title |

### tests/security/content-parity.test.mjs

| Line | Reviewed case | Decision / scope |
|---:|---|---|
| 84 | generated index preserves canonical profile, skill, and experience content | Retain; improve: A5 per-record field/attribute association |
| 171 | generated index resolves profile tokens and exposes schema.org metadata | Retain: oracle protects its stated stimulus/contract |
| 211 | home prioritizes exactly three flagship projects and archive retains every project | Retain; improve: A5 actual link attributes |
| 253 | generated flagship case studies preserve governed evidence and cross-links | Retain; improve: A5 preserve per-panel association; inspect actual attributes |

### tests/security/generate-book-webp-security.test.mjs

| Line | Reviewed case | Decision / scope |
|---:|---|---|
| 41 | sanitizeCoverRelativePath accepts safe relative JPEG paths | Retain: oracle protects its stated stimulus/contract |
| 52 | sanitizeCoverRelativePath rejects traversal and encoded traversal | Retain: oracle protects its stated stimulus/contract |
| 63 | sanitizeCoverRelativePath rejects absolute and scheme paths | Retain: oracle protects its stated stimulus/contract |
| 78 | sanitizeCoverRelativePath rejects non-jpeg and query paths | Retain: oracle protects its stated stimulus/contract |
| 89 | resolveProjectPath enforces root containment | Retain: oracle protects its stated stimulus/contract |
| 100 | run opens bounded reading data no-follow and nonblocking and rejects non-regular files | Retain: oracle protects its stated stimulus/contract |
| 180 | assertSafeSourceFile rejects a source symlink that resolves outside the project | Retain: oracle protects its stated stimulus/contract |
| 196 | run rejects a hard-linked source before conversion and preserves the outside file | Retain: oracle protects its stated stimulus/contract |
| 229 | run rejects a non-regular source before conversion | Retain: oracle protects its stated stimulus/contract |
| 256 | run converts an exact-budget private snapshot and skips empty or max-plus-one sources | Retain: oracle protects its stated stimulus/contract |
| 323 | run isolates conversion from source-path replacement races | Retain: oracle protects its stated stimulus/contract |
| 358 | toWebpPath preserves location and swaps extension | Retain: oracle protects its stated stimulus/contract |
| 363 | writeGeneratedFileNoFollow rejects dangling output symlinks | Retain: oracle protects its stated stimulus/contract |
| 386 | writeGeneratedFileNoFollow allows targets located directly in the project root | Retain: oracle protects its stated stimulus/contract |
| 400 | writeGeneratedFileNoFollow refuses to overwrite an existing regular file | Retain: oracle protects its stated stimulus/contract |
| 420 | writeGeneratedFileNoFollow rejects target directories that resolve outside the project root | Retain: oracle protects its stated stimulus/contract |
| 442 | writeGeneratedFileNoFollow revalidates a parent swap injected before final validation | Retain: oracle protects its stated stimulus/contract |
| 473 | writeGeneratedFileNoFollow never unlinks a replacement inode after a write failure | Retain: oracle protects its stated stimulus/contract |
| 506 | writeGeneratedFileNoFollow preserves binary content exactly | Retain: oracle protects its stated stimulus/contract |
| 524 | writeGeneratedFileNoFollow accepts the byte limit and rejects empty or max-plus-one output before publishing | Retain: oracle protects its stated stimulus/contract |
| 557 | run removes private snapshots and leaves no target when cwebp fails | Retain: oracle protects its stated stimulus/contract |
| 593 | run removes its partial target and temp files after an injected publication failure | Retain: oracle protects its stated stimulus/contract |
| 635 | run cleans converter output that exceeds the generated byte budget | Retain: oracle protects its stated stimulus/contract |
| 668 | run revalidates a target parent changed during conversion before publishing | Retain: oracle protects its stated stimulus/contract |

### tests/security/resume-build.test.mjs

| Line | Reviewed case | Decision / scope |
|---:|---|---|
| 178 | validateResumeData accepts its contract and rejects distinct malformed boundaries | Retain: oracle protects its stated stimulus/contract |
| 226 | validateResumeSources applies every shared website-data validator | Retain: oracle protects its stated stimulus/contract |
| 243 | loadResumeData rejects malformed, linked, non-regular, and oversized source files | Retain: oracle protects its stated stimulus/contract |
| 290 | resume CLI parser accepts only one valueless --html-only flag | Retain: oracle protects its stated stimulus/contract |
| 304 | standalone build and freshness fail closed on malformed shared sources | Retain: oracle protects its stated stimulus/contract |
| 327 | rendered resume escapes fields and the default AI heading exactly once | Retain: oracle protects its stated stimulus/contract |
| 347 | computeResumeHtmlHash is deterministic and content-sensitive | Retain: oracle protects its stated stimulus/contract |
| 359 | current committed resume bundle passes the end-to-end freshness boundary | Retain: oracle protects its stated stimulus/contract |
| 364 | freshness returns structured failures for malformed and non-strict manifests | Retain; improve: A1 fail-closed gate bit |
| 390 | freshness detects a source edit without artifact regeneration | Retain; improve: A1 fail-closed gate bit |
| 406 | freshness rejects missing, symlinked, non-regular, and oversized artifact paths | Retain; improve: A1 fail-closed gate bit |
| 476 | freshness rejects malformed PDF and DOCX structures before trusting their hashes | Retain; improve: A1 fail-closed gate bit |
| 491 | artifact validators enforce PDF boundary markers and DOCX central/core resource bounds | Retain: oracle protects its stated stimulus/contract |
| 519 | freshness hashes the exact structurally validated PDF and DOCX bytes | Retain; improve: A1 fail-closed gate bit |
| 538 | stable artifact reads detect deletion and replacement races after bytes are read | Retain; improve: A1 fail-closed gate bit |
| 563 | PDF exporter bounds each Playwright stage and forces cleanup | Retain: oracle protects its stated stimulus/contract |
| 675 | DOCX hard timeout uses SIGKILL and aborts build without publication | Retain: oracle protects its stated stimulus/contract |
| 758 | timed-out PDF export releases the build lock and cannot partially publish | Retain: oracle protects its stated stimulus/contract |
| 849 | build lock excludes concurrent publication and keeps one coherent artifact bundle | Retain: oracle protects its stated stimulus/contract |
| 902 | build failure cleans its lock and all per-run files without partial publication | Retain: oracle protects its stated stimulus/contract |
| 932 | nth publication failure restores the exact prior bundle and leaves no temporary files | Retain; improve: A2 concurrent ownership + publication positions |
| 983 | build lock preserves stale and replacement ownership | Retain: oracle protects its stated stimulus/contract |

### tests/security/safe-output.test.mjs

| Line | Reviewed case | Decision / scope |
|---:|---|---|
| 74 | writeFileNoFollow rejects a symlinked generated output without touching its target | Retain: oracle protects its stated stimulus/contract |
| 90 | writeFileNoFollow rejects a symlinked parent directory | Retain: oracle protects its stated stimulus/contract |
| 107 | writeFileNoFollow revalidates the parent realpath after exclusive temp creation | Retain: oracle protects its stated stimulus/contract |
| 148 | writeFileNoFollow revalidates the parent inode after same-path replacement | Retain: oracle protects its stated stimulus/contract |
| 187 | writeFileNoFollow rejects a parent swapped outside during the temp write | Retain: oracle protects its stated stimulus/contract |
| 226 | writeFileNoFollow revalidates the parent immediately before rename | Retain; improve: independent timing oracle review pending |
| 274 | writeFileNoFollow revalidates a destination replaced with a symlink before publish | Retain: oracle protects its stated stimulus/contract |
| 310 | writeFileNoFollow enforces expected destination identity immediately before publish | Retain: oracle protects its stated stimulus/contract |
| 335 | writeFileNoFollow never unlinks a replacement at its owned temporary path | Retain: oracle protects its stated stimulus/contract |
| 369 | writeFileNoFollow replaces a hard-linked destination without changing the outside inode | Retain: oracle protects its stated stimulus/contract |
| 390 | writeFileNoFollow rejects escaped, non-regular, and unresolvable destinations | Retain: oracle protects its stated stimulus/contract |
| 422 | writeFileNoFollow removes its exclusive temporary file when a write fails | Retain: oracle protects its stated stimulus/contract |
| 436 | writeFileNoFollow never removes a colliding temporary file it does not own | Retain: oracle protects its stated stimulus/contract |
| 458 | concurrent writeFileNoFollow calls publish exactly one complete payload | Retain; improve: retain final payload oracle; publication reader observation review pending |

### tests/security/html-document.test.mjs

| Line | Reviewed case | Decision / scope |
|---:|---|---|
| 10 | HTML parsing uses browser attribute names, namespace prefixes and single entity decoding | Retain: oracle protects its stated stimulus/contract |
| 24 | script content follows browser raw-text and newline normalization | Retain: oracle protects its stated stimulus/contract |
| 31 | scripting-enabled noscript and real raw-text delimiters expose actual browser scripts | Retain: oracle protects its stated stimulus/contract |
| 47 | valid templates retain all nested content for conservative policy checks | Retain: oracle protects its stated stimulus/contract |
| 54 | parse recovery fails closed except for explicitly permitted missing doctypes | Retain: oracle protects its stated stimulus/contract |
| 70 | byte, creation, traversal and option limits bound HTML parsing | Retain; improve: A10 paired budget boundary; distinguish phase |
| 80 | foreign script bodies include descendant text without unbounded duplicate output | Retain: oracle protects its stated stimulus/contract |

### tests/security/static-server.test.mjs

| Line | Reviewed case | Decision / scope |
|---:|---|---|
| 38 | static server serves deployment bytes, clean URLs, MIME types and HEAD reliably | Retain; improve: A8 bounded fixture/request lifecycle |
| 61 | static server rejects absolute URL paths and prefix siblings before entering the file reader | Retain; improve: A6 containment branch distinction; A8 lifecycle |
| 93 | static server supports the filesystem root without constructing a double-separator prefix | Retain; improve: retain narrow mocked path-prefix unit scope |
| 110 | static server rejects traversal, hidden paths, symlink escapes and non-regular files | Retain; improve: A7 actual non-regular fixture; A8 lifecycle |
| 123 | static server bounds reads and validates configured roots and listener ports | Retain; improve: A10 exact/zero byte and port endpoints; A8 lifecycle |

### tests/security/playwright-config.test.mjs

| Line | Reviewed case | Decision / scope |
|---:|---|---|
| 8 | Playwright owns the loopback listener instead of reusing an unexpected server | Retain: oracle protects its stated stimulus/contract |
| 13 | Playwright serves a staged deployment allowlist rather than the repository root | Retain; improve: A4 full allowlist/unsafe-stage fixtures |
| 24 | Playwright rejects invalid listener ports before constructing the server command | Retain; improve: A10 port endpoints |
| 31 | Playwright rejects an explicitly empty configured port and cleans staging on exit | Retain; improve: A4 non-vacuous cleanup + timeout |

## Production contracts inspected

`scripts/build.js` input readers, validators, HTML/JSON-LD/CSP renderers, template expansion, output preflight/ownership/rollback, and build locks; `scripts/lib/static-rendering.cjs`; `scripts/lib/asset-paths.cjs`; `scripts/lib/safe-input.cjs`; `scripts/lib/html-document.mjs`; `scripts/serve-static.mjs`; `playwright.config.mjs`; independently, `scripts/generate-book-webp.js`, `scripts/build-resume.mjs`, `scripts/check-resume-freshness.mjs`, `scripts/lib/safe-output.cjs` and referenced artifact readers/validators.

## Independent artifact/output findings

Independent reviewer: `/root/audit_repo_source/audit_asset_resume_contracts`. Reviewed all 60 declarations in the three assigned files, without execution or mutation. This review inspected actual filesystem fixtures and the current helpers; mocking verdicts below distinguish an intentionally isolated exporter from an untested exporter contract.

### A11 — Final-parent-check title exceeds the exercised race boundary (medium priority, high confidence)

`safe-output.test.mjs:226–272`, “writeFileNoFollow revalidates the parent immediately before rename,” swaps the parent after the second temporary-path lstat at 248–253. This targets production `safe-output.cjs:242`, followed by the earlier parent check at 243. The later temporary and parent checks at 249–250 are not challenged. Keep this earlier race case and add a final-boundary fixture: use `beforeFinalDestinationCheck` to arm a narrow interception, swap the parent immediately after the following real temp inspection, and require parent-change rejection, prior destination retained in the displaced directory, outside sentinel unchanged and no outside output. Do not count incidental earlier syscalls as the seam's contract.

### A12 — Invalid-byte cleanup is weaker than partial-write cleanup (medium priority, high confidence)

`safe-output.test.mjs:422–434` passes `Symbol('invalid bytes')` to unrestricted `assert.throws` at 428. This protects invalid-input rejection and absence of temp residue, but would also pass if rejection moved before temp reservation. It does not establish cleanup after partial descriptor I/O in `safe-output.cjs:223–238,258–267`. Add a scoped interception that actually writes a prefix to the owned descriptor and then throws a specific EIO; record that it ran and the reserved path existed. Require exact error, prior bytes retained, owned partial temp removed, and a foreign replacement/collision preserved. Keep the existing invalid-input fixture within its narrower scope.

### A13 — Concurrent writer oracle does not observe publication readers (medium priority, high confidence)

`safe-output.test.mjs:458–502` uses six real worker threads, a ready barrier, successful exits, exact final payload membership and no temp leaks; these are substantive protections. Its only destination read occurs after all writers at 495–497. It cannot establish what readers see during staging/publication at `safe-output.cjs:231,254`. Add a rendezvous through the existing final-check hook: while staging is complete and rename blocked, readers see the old complete file; after release every observed read equals old or one complete new payload, never a prefix or transient absence. Retain the final-output case.

### A14 — Resume escaping lacks positive preservation and attribute oracles (medium priority, high confidence)

`resume-build.test.mjs:327–345` proves escaped name text and exact single ampersand escaping in the default heading, but only checks absence of the malicious summary's raw image markup at 338. Removing the summary entirely satisfies that assertion. Contact attribute boundaries and other renderer sections (`build-resume.mjs:217–236,255–293,296–399,427,514–518`) are omitted. Add exact positive escaped-summary assertions and distinctive contact link-label/HTTPS query-ampersand payloads; require safe labels/URLs preserved and unsafe/credentialed direct-render URLs dropped. Keep schema URL validation separate.

### A15 — WebP path-replacement title and run outcome branches need distinct cases (medium priority, high confidence)

`generate-book-webp-security.test.mjs:323–356` overwrites the same source inode at 342 after a private snapshot was created; it meaningfully proves isolation from later in-place content edits, but not rename/recreate source-path replacement or the inspection/read interval at `generate-book-webp.js:324–328`. Add a rename/recreate conversion-time fixture with an exact private snapshot/output oracle; retain the in-place-edit case. No named case directly asserts ordinary existing-target `skipped`, missing-source `missing`, derived `-300.jpg` full-size conversion, or duplicate covers (`generate-book-webp.js:48–96,405–420,456–459`). Add one controlled scenario with exact result arrays, invocation count/paths and preserved existing target; use different sentinels so assertions distinguish branches.

### A16 — Exporter-output hostility and schema/format security boundaries are missing (medium priority, high confidence)

Resume lock/rollback exporter stubs copy trusted files at `resume-build.test.mjs:867,872,949–959`, appropriately isolating publication behavior. They do not prove rejection of empty, oversized, linked, hard-linked or nonregular temporary exporter output consumed at `build-resume.mjs:1015–1024`. Add hostile temporary output fixtures requiring rejection before publication, prior bundle unchanged, lock released and per-run directory removed. This is a coverage-of-contract gap, not a blanket overmocking finding.

The resume validation case at 178 omits nested unexpected keys, credentialed HTTPS, and maximum length/count pairs for source `build-resume.mjs:112–177`. The artifact format case at 491 omits PDF trailing junk/startxref, DOCX unsafe names, duplicate entries/local offsets, unsupported compression, encrypted/multidisk/ZIP64 records and local/central disagreement (`check-resume-freshness.mjs:62–69,118–130,154–207`). Prioritize credentialed links, path-traversing archive names and local/central disagreement. Each fixture needs a specific rejection reason and unchanged artifact state; preserve the existing structural-before-hash and decompression-bound tests.

### A17 — An outside canary is disconnected from the injected write (low priority, high confidence)

`generate-book-webp-security.test.mjs:593–633` creates `outsideSentinel` at 603 and asserts its bytes at 627, but never connects it to a source, target, parent or injected write. Its unchanged state cannot prove protection of a reachable outside file. Keep real partial-target/temp cleanup assertions at 625–626. If keeping the outside sentinel, connect it to an ownership replacement seam; the distinct case at 473–504 already demonstrates a reachable sentinel through a replacement hard link.

## Independent per-case decision amendments

These amendments refine the complete inventory above; all other independently inspected cases retain their precise stated oracle. None supports removal.

| File/case line | Additional inspected oracle/decision |
|---|---|
| resume-build 178 | Seven distinct malformed mutations and valid baseline retained; A16 nested/credential/budget additions |
| resume-build 226 | Every shared website validator is exercised with a distinct failing source; retain cross-module wiring |
| resume-build 243 | Linked, directory, oversized and invalid UTF-8 actual files retained |
| resume-build 290 | Accepted HTML-only/default modes plus flag duplicate/value/unknown/positional cases retained |
| resume-build 304 | Build rejection, no HTML and lock release retained; A1 also require negative freshness gate |
| resume-build 327 | Positive escaped name/default heading retained; A14 preservation/attributes |
| resume-build 347 | Repeatability/content sensitivity retained; a fixed independently known digest would strengthen algorithm identity |
| resume-build 359 | Actual committed sources/manifest/PDF/DOCX freshness retained; no exporter execution claim |
| resume-build 364 | Parse/null/array/missing/extra/reordered/uppercase manifest variants retained; A1 includes loop 380–383 that bypasses assertIssue |
| resume-build 390 | Healthy baseline then source mismatch retained; A1 failed result |
| resume-build 406 | Seven artifact/path/size variants retained; A1 failed result |
| resume-build 476 | Both invalid formats and absence of hash mismatch retained; A1 failed result |
| resume-build 491 | PDF magic/EOF and DOCX EOCD/core/decompression budget retained; A16 format additions |
| resume-build 519 | Structurally accepted altered binaries yield mismatches without structure errors retained; A1 failed result |
| resume-build 538 | Real deletion/replacement after-read mutations retained; A1 failed result |
| resume-build 563 | Seven stalls across loader/launch/page/content/PDF/page.close/browser.close; typed deadline, timer/downstream/cleanup matrix retained |
| resume-build 675 | Exact Pandoc args, configured timeout/SIGKILL, typed error/cause, no publication/staging/lock leak retained; does not prove a real Pandoc child was killed |
| resume-build 758 | Timed-out exporter integrates with build lock release/reacquisition and no later work/publication; retain distinct integration |
| resume-build 849 | Held first build excludes second publisher, produced hashes/manifest/freshness coherent; retain isolated exporters; A16 hostile staged bytes |
| resume-build 902 | Non-timeout PDF failure prevents DOCX/publication and cleans resources; retain |
| resume-build 932 | Fourth-write failure removes initially absent HTML, restores existing PDF/DOCX, preserves unreached manifest; A2 positions/ownership/error aggregation |
| resume-build 983 | Stale and replaced lock retained plus ordered AggregateError; retain rare ownership composition |
| safe-output 74 | Real outside symlink target bytes protected; retain |
| safe-output 90 | Outside-resolving symlinked parent rejected; title broader than source, which allows parent symlinks resolving inside the root |
| safe-output 107 | Exclusive-temp-open parent swap rejection and outside bytes/entries retained |
| safe-output 148 | Same lexical parent/new inode rejected; prior displaced bytes retained |
| safe-output 187 | Real descriptor write before outside parent relocation; old/outside bytes retained |
| safe-output 226 | Earlier second-temp-check race retained; A11 final check separately |
| safe-output 274 | Destination replaced with outside symlink during real staging write; outside/symlink retained, owned temp cleaned |
| safe-output 310 | Expected snapshot then late new inode replacement preserved; retain |
| safe-output 335 | Owned temp displaced/foreign replacement installed; both owned and replacement bytes retained, destination unchanged |
| safe-output 369 | Destination hard link replaced atomically with new inode while outside bytes unchanged |
| safe-output 390 | Escape/directory/missing parent/missing root distinct rejects; retain |
| safe-output 422 | Invalid input retention/cleanup retained; A12 partial I/O |
| safe-output 436 | Deterministic collision exhausts temp reservation without deleting collision; retain; collision-then-success is a distinct optional retry contract |
| safe-output 458 | Six real workers/final payload/no leak retained; A13 concurrent-reader observations |
| generate-book-webp-security 41 | Exact safe JPG/JPEG path acceptance |
| generate-book-webp-security 52 | Plain/encoded dot-segment rejection |
| generate-book-webp-security 63 | Absolute/file/HTTPS path rejection |
| generate-book-webp-security 78 | Wrong extension/query rejection |
| generate-book-webp-security 89 | Exact contained path and lexical escape rejection |
| generate-book-webp-security 100 | Exact reading-input budget, max+1/symlink/directory, actual no-follow/nonblocking flags and empty temp root |
| generate-book-webp-security 180 | Real outside source symlink rejected |
| generate-book-webp-security 196 | Hard link rejected before conversion, outside bytes retained |
| generate-book-webp-security 229 | Directory source rejected without converter/temp work |
| generate-book-webp-security 256 | Exact private snapshot/output budget; empty/max+1 rejects, real snapshot isolation and timeout/SIGKILL options |
| generate-book-webp-security 323 | Actual in-place source mutation isolation retained; A15 path replacement |
| generate-book-webp-security 358 | Exact extension/location mapping |
| generate-book-webp-security 363 | Dangling output symlink no-follow/exclusive failure, outside absent |
| generate-book-webp-security 386 | Root-level output success exact bytes |
| generate-book-webp-security 400 | Existing output EEXIST and prior bytes retained |
| generate-book-webp-security 420 | Specific validation type/reason and no outside output |
| generate-book-webp-security 442 | Final-validation hook demonstrably swaps parent; no outside/displaced output |
| generate-book-webp-security 473 | Prefix write then owned-inode displacement/replacement hard link; meaningful outside canary and ownership cleanup |
| generate-book-webp-security 506 | Non-UTF8/NUL binary byte preservation |
| generate-book-webp-security 524 | Exact output limit success, empty/max+1 rejection before destination creation |
| generate-book-webp-security 557 | Snapshot existence before converter failure, captured private dir gone, no target |
| generate-book-webp-security 593 | Real prefix publication failure removes owned target/temp; A17 disconnected canary |
| generate-book-webp-security 635 | Generated converter output exceeds byte budget, no target/temp leak |
| generate-book-webp-security 668 | Actual parent moved/outside symlink during conversion; reachable canary preserved, no displaced publication/temp leak |

Independent retained evidence emphasizes that deadline/resource matrices, exact binary bytes, ownership replacements and actual worker threads protect distinct behaviors. Mocked Chromium/Pandoc/cwebp execution remains local contract evidence and does not establish successful real exporter or hosted deployment behavior.

## Snapshot freshness at handoff

Final HEAD: `11362edcabc93025dafeea66a2f60c90d82a2b48`. Inspected test/source/config/package/lockfile hash drift: none. This is a static snapshot check, not a test run or coverage result.


---

# Appendix: Policies, workflows and signatures

# Seven-file security test quality audit

Baseline: ProjectPortfolio HEAD `11362edc`; static review on 2026-10-04. Scope is exactly the seven files listed in the ledger below, including their nested fixture matrices. Read current implementation and workflow contracts as context. No tests, coverage, mutations, deletes, commits, source edits, or network requests were performed. This report is the only artifact written. Root owns fresh execution and coverage provenance.

Skill applied: `/Users/leonardwongly/.codex/skills/audit-test-quality/SKILL.md` and its evaluation/evidence/report references. Coverage is unknown here; no quality score or per-test coverage attribution is inferred. No deletion candidates are approved. Several policy/governance cases were authored by this reviewer in the immediately preceding remediation task: this review is not an independent evaluator's endorsement of those cases or evidence for their deletion. Proposed changes require independent evaluation and later authorized execution.

## Outcome

Retain the safety matrices. Their assertions exercise actual parser/checker functions, cryptographic verification, real filesystem snapshots, or real shell exit behavior and encode distinct security boundaries. Improve several weak oracles rather than treating text scans, mocks, coverage, or apparent overlap as deletion evidence. Highest-value changes are an independent signature protocol oracle, a nonzero-offset byte-view fixture, real smoke pattern fixtures, semantic HTML/workflow checks, and an isolated final-reread vendor race regression.

All observations below are static design evidence, not reproduced mutation results or hosted CI/provider validation. A hypothetical mutation is an explicit proposed future discriminator.

## Concrete improvement candidates

1. **Signature verification shares the canonicalizer under test.** `web-bot-auth.test.mjs:34` (base assembled at :53) and :105 (base assembled at :117) verify real Ed25519 signatures, but use production `signatureBase` to construct the expected signed bytes. A shared canonicalization defect can leave both sides agreeing. The :67/:80 tests only match individual lines, so extra/order/parameter serialization mistakes can escape their oracles too. Keep the real crypto and Fetch method normalization coverage. Add one independently written, exact multiline canonical byte string with a fixed key and clock; verify the signature over that string; require tampering with target/method/covered header/body to fail. Assert the complete Signature-Input value. Static confidence: high; protocol compatibility remains unexecuted.

2. **The exact-range byte-view case never has an offset or unused backing bytes.** `web-bot-auth.test.mjs:130` uses a whole `Uint16Array([0x1234])` at :134; :138 hashes the entire backing buffer. This cannot distinguish correct byteOffset/byteLength handling from hashing `view.buffer`. Production `scripts/web-bot-auth.mjs:42-49` handles ArrayBuffer views. Use a backing byte array with prefix/suffix sentinels and a nonzero-offset Uint8Array and DataView; independently hash only the selected bytes. Retain the existing typed-array representation case if it protects element-vs-byte conversion. Static confidence: high.

3. **Smoke tests validate command exit semantics, not the actual search rules.** All five `security-smoke.test.mjs` top-level tests (:97/:105/:115/:129/:140) use the :39-64 fake rg, whose response depends on call ordinal. `node` and `jq` always succeed (:35-36). This is valuable isolation for rg statuses 0/1/2/127 and fail-closed PCRE handling, but a pattern/path becoming ineffective may still pass. Add separate fixtures that run real rg over clean and unsafe files, exercising the actual CLI. Keep every exit-status case. Add failing jq/node/build/governance probes with an execution trace that shows no success banner or subsequent work after failure. Avoid inheriting `SMOKE_TEST_REAL_RG` from the external environment (:84) for the default deterministic case; make forwarding an explicit fixture option. Static confidence: high; real dependency availability is not established here.

4. **Several policy assertions inspect source spelling rather than parsed security meaning.** `policy-regression.test.mjs:202/:215/:228/:300/:318/:358` use HTML regexes. The target=_blank oracle at :302 sees lowercase anchors with doublequoted targets only; :308 accepts substrings such as `xnoopener` instead of exact rel tokens. Dangerous-scheme :320 sees doublequoted values only and reuses an `/ig` regex with stateful lastIndex across files. Comments can satisfy source checks, while mixed case, singlequotes, unquoted attrs, and entity-decoded values are not reliably covered. Parse HTML with the already available shared HTML helper; inspect actual attributes, exact token sets, decoded schemes, actual CSP meta location, and parser recovery. Add a harmless-format positive matrix plus unsafe format negatives. `GENERATED_HTML_FILES` (:20-28) excludes public `.well-known/service-doc.html`; use the authoritative deployed page inventory where the contract is all public HTML. Do not infer that the whole repository lacks other parser/browser protection. Static confidence: high.

5. **CSP hash synchronization uses the build helper as its expected-value oracle.** `policy-regression.test.mjs:265`, expected directive at :269, calls `renderCspScriptHashesDirective` from the production builder. It usefully checks consistency across source/generated HTML/headers, but a defect shared with the build can agree. Supplement with independent HTML script extraction and `crypto.createHash` over exact executable/data-script bodies, plus route-local header/meta comparison. Include a changed-inline-body negative and a no-script positive; preserve the existing template placeholder contract. Static confidence: high.

6. **Workflow policy text can remain while an operative gate changes.** `policy-regression.test.mjs:74/:82/:136/:164/:172` match source strings, slice job text by indentation, and require command/config strings. Comments or a disabled/moved step could satisfy much of this. Current `scan.yml:31-55` contains real install/build/generated/coverage/audit/vendor steps, and Gemini `gemini-cli.yml:444-457/:680-693` contains the real bounded-response publish guards. Parse YAML to assert actual jobs/steps, effective permissions, model-step env/tool config, and publish ordering. In a later authorized harness execute the actual validator shell with a fake gh sink against missing/directory/symlink/60000-byte/60001-byte response fixtures; assert no publish for invalid input and correct command arguments for a valid response. Keep the tool-authority/no-checkout/security intent and pinned action requirements. Hosted Actions behavior is a separate validation boundary. Static confidence: high.

7. **The purported after-validation race fires during the first read.** `vendor-governance.test.mjs:298` monkeypatches `fs.readSync` (:303-309) and overwrites the file immediately after the first nonempty read; it accepts either changed-while-read or changed-during-validation (:315). It is a useful concurrent-read regression, but does not isolate the final reread invariant at `scripts/check-vendor-governance.mjs:354-365`. Keep it, clarify its meaning, and add two valid declared files: mutate the already validated first file while reading the second, after the first read's stability checks have completed. Require the specific final-digest-change failure. A future authorized discriminator would disable only the final reread and show this new case fails. The :242 lstat-call-count mock also has implementation coupling; prefer a scoped explicit inspection/read seam while retaining a real symlink swap. Restore global fs monkeypatches in finally (currently done) and keep them nonconcurrent. Static confidence: high.

8. **Vendor download/write success oracles could assert exact digest mapping.** `vendor-refresh.test.mjs:201` checks a 64-hex SHA and result count/path rather than independently derived payload SHA. :393 exercises real staging/persist/validation and deterministic bytes/date, but only one dependency/file; the separate updateManifestHashes call chiefly checks review date. `scripts/update-vendor.mjs:286-294` clones the manifest and writes hashes by dependency/file index. Add distinct payloads for multiple dependencies/files and assert exact SHA mapping, exact stored bytes, unchanged input manifest, and deterministic complete manifest output. Add a real `runVendorRefresh(write:false)` filesystem-tree equality case; :124/:336 establish exit helpers but do not themselves prove the actual dry-run leaves all files unchanged or the CLI uses its helper. Preserve the safe transaction matrices. Static confidence: medium-high; related tests outside these seven files may already cover some orchestration.

9. **Upstream retry tests stop at success or one nonretryable response.** `vendor-upstream.test.mjs:182/:206/:226` are valuable counts/backoff/nonretryable regressions. Add exhaustion for repeated 503 and retryable transport failures: exactly maxAttempts calls, maxAttempts-1 sleeps, final diagnostic, no extra request. For :148 add invalid UTF8, nonobject JSON, missing/malformed latest tag; production :201-217 explicitly validates these. For :245 include equal/ahead/prerelease versions and two dependencies to validate updateAvailable decisions independently. :160 intentionally replaces byte transport and checks wiring, so it is not evidence of real DNS/TLS safety; keep it with that evidence boundary. Static confidence: high.

10. **Workflow expression emulator is a bounded model, not an Actions runner.** `workflow-hygiene.test.mjs:672-739` translates the subset of GitHub expressions into JavaScript/vm; :741/:775/:806 compare actual workflow expressions against an expected request matrix, and :836 evaluates the draft guard. Keep these concrete policy cases. Document evaluator assumptions and assert unsupported expressions fail rather than silently using JS semantics. Where relevant, add reference fixtures for missing/null/empty fields, numeric/string coercion, case-insensitive comparison and contains. Prefer literal expected eligible jobs/groups (the current request tests have these), not only parity derived from the same job conditions. :836 should additionally assert that its validation step has no disabling if/continue-on-error; merely finding its run text proves presence, not mandatory gating. This is a fidelity limitation, not a demonstrated current workflow defect. Static confidence: medium.

## Contract gaps worth focused additions

- Web Bot Auth :164: accepted/rejected timestamp boundaries (age300/301, future30/31), maxAge bounds, normalized duplicate components, malformed/private JWK errors. Use a controlled clock, not wall-clock boundary guesses. Current Date.now-based positive tests are not known flaky; absence of boundary fixtures is the issue.
- Governance :60/:173: malformed calendar dates, future review, exact age limit, duplicate declared paths, missing declared files, preexisting unexpected inventory and declared Workbox digest mismatch. These are explicit production branches (:249-262/:305-320/:344-351). Check other files before adding duplicates. Fixed review dates in structural tests are appropriate; real CLI freshness must continue to use actual current dates.
- Workflow checker :64/:609: invalid/duplicate-key YAML, aliases, and the supported shell-wrapper depth boundary (production MAX_SHELL_WRAPPER_DEPTH=8). Add exact diagnostics and positive legal boundary fixtures if not already covered elsewhere. This is not a request to expand the checker into a complete shell interpreter.
- Policy :278 required runtime headers presently matches their presence anywhere, while :423 correctly tests exact-one route CSP/CORS. Require effective global header values on each monitored route. Keep runbook :289 and docs :392 as documentation contracts, but do not present phrase presence as behavior/collector/analytics proof.
- Policy :372/:380/:402/:413 are valid small content/wiring/performance canaries but cannot independently prove share execution, accessible live status updates, telemetry payload filtering/zero network, service-worker waiting/activation flow or rendered resource selection. Add or link existing browser/VM behavior coverage elsewhere before replacing/removing these. No claim is made that these behaviors are untested repository-wide.

## Useful regression matrices to preserve

Policy :450 includes ordinary/computed/optional DOM calls, aliases/bind/call/apply/destructuring, ASI, resource assignment, HTML sinks, CSS URL paths, Worker/import and safe inert/aria cases. :491 tests complete composed event arguments, reassigned guarded callees and optional calls. :511 distinguishes initial rejecting guards from nested/dead/late/duplicate definitions. :528 establishes a valid fixture before adding executables, script refs, inline JS, worker digest drift, HTML recovery, inert attributes, decoded references and template/foreign content. Do not remove security negatives just because broad fixture assertions overlap a lower-level helper.

Governance :72/:89 pin exact Bootstrap bytes, metadata/UTF8/version/license, symlink and freshness boundaries. :117 protects bounded/no-follow/regular/snapshot manifest reads. :182/:201/:220 pin registry/SemVer/source/prefix-sibling/signature validation. :229/:242/:272/:298/:323 use real filesystem rejection and races; retain each distinct phase while improving injection timing.

Smoke :105/:115 protect rg failures (including 2/127) and unavailable PCRE; :129 preserves each forbidden-match failure, :140 each required-positive-match failure, :97 clean completion. These are a useful shell error-handling contract even with deliberately mocked tools.

Refresh :147/:166/:182 ensure malformed inventory/signatures fail before fetch; :215 bounds bytes and stalled body wall time; :287 rejects private DNS before the fetch callback; :306/:320 protect source-directory boundaries. :343 comparison rejects symlink/directory/oversize/replacement. :442 restores original bytes after a partial transaction; :484 preserves a path never published by the transaction; :528 rejects prepublication drift; :569 rolls back after post-persist validation failure. :607/:651 exercise real exclusive lock ownership across fetch/publish/validate, including a second attempted writer and no fetch. :714 validates all backups before first write and asserts filesystem-tree equality/no transaction artifacts (symlink, directory, oversize, replacement, oversized manifest). :833 continues rollback for other entries, preserves concurrent owner bytes, and verifies recovery metadata plus exact backup bytes. :903 separately prevents a false retention claim when evidence writing fails. :953 proves a symlinked vendor parent cannot cause external writes. These assertions are unusually important; superficial mutation-to-error coverage is not a substitute.

Upstream :33/:58/:66 preserve package/input/SemVer boundaries including huge identifiers and build/prerelease behavior. :132/:148 preserve bounded metadata and invalid JSON. Real production transport is deliberately injected in orchestration tests; this is appropriate isolation when separate network-safety tests prove transport.

Workflow hygiene :64 is a named adversarial matrix of YAML event/action/reusable pins, lifecycle script env/options, wrappers/eval/dynamic shells/substitutions/xargs/heredocs/here strings/redirections/arithmetic, untrusted interpolation, GITHUB_OUTPUT, ratchet and digest references. It calls the actual checker over written YAML and requires one matching file/line finding per fixture. :377 exercises workflow/job permission escalation; :443/:458 protect approved exceptions and scope. :466/:514/:549/:572 protect valid controls, shell-data false positives and nested/wrapped executables. :609 uses real symlink/nonregular/oversized/hardlink/invalid UTF8 files. Keep the positives as well as attacks so hardening does not reject normal CI. Large unnamed positive lists can be converted to named subtests for diagnosis, without changing security assertions. Gemini request matrices cover supported events/associations/approval flows, ordinary discussion, bot/untrusted/unknown/missing fields and run-isolated concurrency. Release :836 covers every ready PR revision and draft/manual distinctions.

## Evidence and limits

No fresh execution status is supplied. Root should attach exact commands, environment, HEAD, collected line/branch/function coverage, any unsupported per-test attribution, and the independent evaluator's decisions. All current tests are retained by recommendation; there is no deletion/refactor plan approved by this report. Later improvement acceptance should require: a valid baseline fixture, one changed security condition, exact observable output/side effect, the corresponding positive boundary, and a targeted discriminator that the former weak oracle would miss. Real filesystem/crypto/shell behavior should be favored over production-helper-as-oracle or additional text matches. Network, hosted CI, provider and production proof remain separate.

## Complete top-level case ledger

Each row below names the existing test ID and start line; nested matrices are covered in the review above. Retain means preserve its regression/contract. Strengthen means preserve intent while adding a better oracle. No row authorizes deletion. Exact top-level IDs are copied from current files; counts are discovery counts, not test-run or coverage results.

### policy-regression.test.mjs — 27 top-level IDs

| Start line | Test ID | Disposition |
|---|---|---|
| 33 | discovery catalog advertises only static data files that the site serves | Retain |
| 74 | scan workflow enforces dependency audit and vendor governance gates | Retain; strengthen oracle/adjacent boundary |
| 82 | Gemini workflow keeps model sessions separate from GitHub and Git authority | Retain; strengthen oracle/adjacent boundary |
| 136 | Gemini workflow removes GitHub App bootstrap and branch automation in favor of deterministic response validation | Retain; strengthen oracle/adjacent boundary |
| 164 | required CI workflows use the authoritative generated-file inventory | Retain; strengthen oracle/adjacent boundary |
| 172 | the security coverage contract and required CI workflows enforce exact thresholds | Retain; strengthen oracle/adjacent boundary |
| 202 | CSP is declared in source pages and appears before script tags when present | Retain; strengthen oracle/adjacent boundary |
| 215 | source CSP style-src does not permit unsafe-inline | Retain; strengthen oracle/adjacent boundary |
| 228 | frame ancestor protection is delivered through enforceable headers | Retain; strengthen oracle/adjacent boundary |
| 243 | every generated HTML page has a CSP on its clean URL | Retain; strengthen oracle/adjacent boundary |
| 265 | generated index CSP hashes match inline scripts in both HTML and runtime headers | Retain; strengthen oracle/adjacent boundary |
| 278 | _headers includes required runtime security headers | Retain; strengthen oracle/adjacent boundary |
| 289 | CSP monitoring fallback and rollout requirements are documented | Retain |
| 300 | target=_blank always includes noopener and noreferrer | Retain; strengthen oracle/adjacent boundary |
| 318 | generated pages do not contain dangerous href/src schemes | Retain; strengthen oracle/adjacent boundary |
| 332 | public content does not reference retired unreachable vanity domains | Retain |
| 358 | generated pages do not contain inline style attributes | Retain; strengthen oracle/adjacent boundary |
| 372 | reading page exposes share controls with accessible status messaging | Retain; strengthen oracle/adjacent boundary |
| 380 | reading share measurement hooks remain wired in client script | Retain; strengthen oracle/adjacent boundary |
| 392 | privacy-safe telemetry posture is documented and visible in generated actions | Retain; strengthen oracle/adjacent boundary |
| 402 | service worker update flow has a single active client implementation | Retain; strengthen oracle/adjacent boundary |
| 413 | reading page avoids oversized 2x cover variants for known heavy assets | Retain; strengthen oracle/adjacent boundary |
| 423 | each canonical clean and HTML route matches exactly one response CSP rule | Retain |
| 450 | telemetry policy rejects DOM resource beacons and ordinary method aliases | Retain |
| 491 | composed event arguments require a guard and trackEvent assignments invalidate guard trust | Retain |
| 511 | only an initial top-level rejecting trackEvent guard protects dynamic events | Retain |
| 528 | runtime inventory rejects additional executables, script references, inline source, and worker drift | Retain |

### security-smoke.test.mjs — 5 top-level IDs

| Start line | Test ID | Disposition |
|---|---|---|
| 97 | security smoke CLI accepts clean no-matches and completes its positive guards | Retain; strengthen oracle/adjacent boundary |
| 105 | security smoke CLI fails closed when PCRE searches are unavailable | Retain; strengthen oracle/adjacent boundary |
| 115 | security smoke CLI rejects tool errors at every negative-match check | Retain; strengthen oracle/adjacent boundary |
| 129 | security smoke CLI preserves each original negative-match finding | Retain; strengthen oracle/adjacent boundary |
| 140 | security smoke CLI retains required positive-match failures | Retain; strengthen oracle/adjacent boundary |

### vendor-governance.test.mjs — 14 top-level IDs

| Start line | Test ID | Disposition |
|---|---|---|
| 60 | vendored dependency governance validates digests, freshness, and inventory | Retain |
| 68 | pinned Bootstrap CSS matches the reviewed distribution bytes | Retain |
| 72 | pinned Bootstrap CSS rejects modified bytes and symbolic links | Retain |
| 89 | pinned Bootstrap CSS rejects missing, malformed, version-drifted and stale assets | Retain |
| 117 | vendor manifest loading is bounded, no-follow, regular-only, and snapshot-stable | Retain |
| 173 | vendored dependency governance rejects stale reviews | Retain |
| 182 | vendor governance rejects malformed package names and SemVer | Retain |
| 201 | vendor governance rejects source/version incoherence and prefix-sibling paths | Retain |
| 220 | vendor governance rejects duplicate signatures | Retain |
| 229 | vendor governance rejects symlinks before reading declared content | Retain |
| 242 | vendor governance rejects a file swapped to a symlink between inspection and open | Retain; strengthen oracle/adjacent boundary |
| 272 | vendor governance rejects files added after its initial inventory snapshot | Retain |
| 298 | vendor governance rejects a declared file overwritten after its validated read | Retain; strengthen oracle/adjacent boundary |
| 323 | vendor governance rejects special filesystem nodes | Retain |

### vendor-refresh.test.mjs — 27 top-level IDs

| Start line | Test ID | Disposition |
|---|---|---|
| 98 | ensureHttpsUrl rejects non-https upstream URLs | Retain |
| 107 | parseArgs defaults to dry-run and validates known flags | Retain |
| 124 | fail-on-drift makes a changed vendored file fail the dry-run check | Retain |
| 139 | ensureVendorPath rejects traversal and non-vendor paths | Retain |
| 147 | fetchVendorFiles rejects an empty required-signature set before fetching | Retain |
| 166 | fetchVendorFiles rejects a malformed dependency inventory before fetching | Retain |
| 182 | fetchVendorFiles rejects duplicate signatures before fetching | Retain |
| 201 | fetchVendorFiles downloads upstream content and verifies signatures | Retain; strengthen oracle/adjacent boundary |
| 215 | fetchVendorFiles bounds injected response bytes and body wall time | Retain |
| 254 | fetchVendorFiles wires the default path to the pinned byte transport | Retain |
| 274 | fetchVendorFiles rejects upstream payloads that miss required signatures | Retain |
| 287 | fetchVendorFiles rejects private DNS answers before fetching upstream content | Retain |
| 306 | fetchVendorFiles rejects upstream URLs outside the dependency source | Retain |
| 320 | fetchVendorFiles rejects a sibling source directory with the same string prefix | Retain |
| 336 | vendor refresh dry-run exit decision fails only when upstream drift exists | Retain |
| 343 | refresh comparison rejects unsafe, oversized, and replaced current files | Retain |
| 393 | updateManifestHashes and runVendorRefresh write deterministic outputs | Retain; strengthen oracle/adjacent boundary |
| 442 | persistVendorRefresh restores every original byte after a mid-transaction failure | Retain |
| 484 | persistVendorRefresh never rolls back a path it did not publish | Retain |
| 528 | persistVendorRefresh refuses destination drift immediately before publication | Retain |
| 569 | persistVendorRefresh rolls back when post-persist validation fails | Retain |
| 607 | vendor refresh lock is exclusive, no-follow, and identity checked | Retain |
| 651 | runVendorRefresh holds one lock through fetch, publish, and validation | Retain |
| 714 | persistVendorRefresh validates every backup before the first write | Retain |
| 833 | persistVendorRefresh attempts every rollback and retains failed recovery bytes | Retain |
| 903 | persistVendorRefresh reports an incomplete recovery bundle without claiming retention | Retain |
| 953 | runVendorRefresh rejects a symlinked vendor parent without external writes | Retain |

### vendor-upstream.test.mjs — 13 top-level IDs

| Start line | Test ID | Disposition |
|---|---|---|
| 33 | ensureRegistryPackageName rejects malformed npm package names | Retain |
| 58 | parseArgs validates timeout flag | Retain |
| 66 | SemVer validation and precedence cover malformed, build, and huge identifiers | Retain |
| 95 | listTrackedRegistryDependencies returns registry-backed dependencies | Retain |
| 116 | fetchRegistryVersion reads latest version from npm metadata | Retain; strengthen oracle/adjacent boundary |
| 132 | fetchRegistryVersion bounds injected metadata bytes | Retain |
| 148 | fetchRegistryVersion rejects malformed registry JSON | Retain; strengthen oracle/adjacent boundary |
| 160 | fetchRegistryVersion wires the default path to the pinned byte transport | Retain |
| 182 | fetchRegistryVersion retries transient npm errors before succeeding | Retain; strengthen oracle/adjacent boundary |
| 206 | fetchRegistryVersion retries injected transport failures before succeeding | Retain; strengthen oracle/adjacent boundary |
| 226 | fetchRegistryVersion does not retry non-retryable npm responses | Retain |
| 245 | checkVendorUpstreamVersions reports stale dependencies | Retain; strengthen oracle/adjacent boundary |
| 281 | formatSummary distinguishes clean and stale states | Retain |

### web-bot-auth.test.mjs — 9 top-level IDs

| Start line | Test ID | Disposition |
|---|---|---|
| 15 | publishes a Web Bot Auth JWKS with an Ed25519 verification key | Retain |
| 30 | generated Web Bot Auth directory remains identical to its source | Retain |
| 34 | signs a request with the Web Bot Auth header set | Retain; strengthen oracle/adjacent boundary |
| 67 | signature base includes the signature parameters line | Retain; strengthen oracle/adjacent boundary |
| 80 | derives @authority, preserves method casing, and normalizes covered header whitespace | Retain; strengthen oracle/adjacent boundary |
| 105 | normalizes Fetch-standard method casing before signing | Retain; strengthen oracle/adjacent boundary |
| 130 | hashes the exact byte range for ArrayBuffer views | Retain; strengthen oracle/adjacent boundary |
| 142 | emits each signature field once after HTTP header normalization | Retain |
| 164 | rejects unsafe targets, components, and stale timestamps | Retain; strengthen oracle/adjacent boundary |

### workflow-hygiene.test.mjs — 13 top-level IDs

| Start line | Test ID | Disposition |
|---|---|---|
| 64 | workflow hygiene rejects each adversarial policy bypass | Retain |
| 377 | workflow and job token permissions reject privilege escalation | Retain |
| 443 | approved workflow and job grants remain accepted | Retain |
| 458 | a write grant approved for one job does not authorize another job | Retain |
| 466 | immutable references and explicit safe controls remain accepted | Retain; strengthen oracle/adjacent boundary |
| 514 | shell data and arithmetic do not invent npm ci executions | Retain |
| 549 | nested executable shell fragments preserve lifecycle-script controls | Retain |
| 572 | literal shell wrappers preserve safe commands | Retain |
| 609 | workflow hygiene rejects unsafe workflow input files | Retain |
| 741 | Gemini concurrency shares subjects only for requests accepted by its actual jobs | Retain; strengthen oracle/adjacent boundary |
| 775 | Gemini concurrency isolates ordinary trusted discussion and excluded requests | Retain; strengthen oracle/adjacent boundary |
| 806 | Gemini concurrency fails closed for untrusted, bot, unknown and incomplete events | Retain; strengthen oracle/adjacent boundary |
| 836 | Release Candidate validates each ready PR revision while retaining the draft guard | Retain; strengthen oracle/adjacent boundary |



---

# Appendix: Operations and network safety

# ProjectPortfolio production and operations test-quality audit

## Scope, authority, and evidence

Snapshot: `11362edcabc93025dafeea66a2f60c90d82a2b48` (HEAD rechecked at report completion). The repository was clean at initial inspection. This report is static analysis of **all 60 top-level cases** and **12 named nested cases** in the four assigned test files. No tests, source programs, mutation probes, coverage collection, provider requests, or remote requests were executed during this audit. The only written artifact is this authorized report. No source/test edits, deletions, commits, or exports were performed.

Instructions read: `/Users/leonardwongly/.codex/skills/audit-test-quality/SKILL.md`, `references/evaluation.md`, `references/evidence.md`, and `references/report.md`. Coverage is a selection signal, not a test-quality score. Parent owns fresh coverage/report collection. Repository coverage configuration requires lines 75%, branches 75%, functions 85% across the configured security targets; achieved metrics, denominator counts, below-threshold production targets, mutation sensitivity, runtime cost, and baseline failures are **unknown in this read-only audit**. No coverage exclusions were changed. Source inspection covered the assigned suites, their directly exercised contracts and shared parsing/network/file-read seams. This is not a claim of a full security review of the large workflow/telemetry analyzers.

The reviewer is the production audit subagent, reviewing assertion quality and contract wiring. This agent previously authored the shared HTML parser and some production script regressions in this task, so it is **not an independent removal reviewer for those authored tests**. There are no removal candidates and no deletion approval. Existing tests are valuable; recommendations below are retain-and-improve decisions. No disputed deletion decisions exist.

Reproducible collection commands for the parent, not run here: `npm run test:security:coverage`; focused behavioral verification `node --test tests/security/network-safety.test.mjs tests/security/ops-scripts.test.mjs tests/security/production-scripts.test.mjs tests/security/production-smoke.test.mjs`. Use the same Node version/settings for before/after comparison. Capture actual command exit status and coverage denominators; do not infer per-test quality or deletion safety from file-level coverage.

## Prioritized improvements

| Priority | Evidence and missing oracle | Behavioral risk | Minimal acceptance criteria | Cost |
|---|---|---|---|---|
| P1 | `network-safety.test.mjs:156–179`, case “pinned HTTPS request enforces declared and streamed byte limits”: the “chunked response” fixture contains one 65-byte chunk. Current cumulative check is `scripts/lib/network-safety.mjs:545–558`. | Replacing cumulative accounting with a per-chunk limit still passes this intended stream-limit regression. | Separate streamed chunks of 32 and 33 bytes must reject at max 64; 32+32 must succeed with exact concatenated bytes; assert request and response destruction on overflow. Keep declaration overflow distinct. | Small |
| P1 | `network-safety.test.mjs:182–235`, timeout header/body mocks have no-op `destroy`; byte-limit helper also has a no-op request destroy at line 21. Source destroys both on timeout at `network-safety.mjs:500–501`. | A change can reject on time while leaving a connection/body open and still pass. | Assert exact request/response destruction on timeout and overflow; resolve DNS after timeout and assert no request was created; deliver headers after timeout and assert response destruction. Use controlled promises plus a generous outer deadline, not an exact elapsed-time equality. | Small–moderate |
| P1 | `network-safety.test.mjs:40–59` exercises one DNS answer at a time. Current contract validates every answer and rejects any unsafe record (`network-safety.mjs:243–256`). | A first-answer-only validation regression can approve a mixed public/private response. | Both `[public, private]` and `[private, public]`, plus a malformed second record, must reject; a multi-public answer must pass. A transport spy must remain at zero for denied resolution. | Small |
| P1/P2 | `network-safety.test.mjs:109–118` only tests the missing lookup seam of `fetchInjectedHttpsBytes`; direct success, denial, body bounds, and timeout cleanup are not asserted there. Caller tests cover some of these, but do not isolate every helper contract. | The injected path can weaken a DNS/stream/abort boundary while consumer fixtures still succeed. | Direct helper cases: denied DNS produces zero fetch calls; validated happy response returns exact raw bytes/status; declaration and cumulative overflow fail; stalled stream is aborted/cancelled/released; invalid options reject before transport. Reuse existing caller coverage rather than duplicating every happy case. | Moderate |
| P2 | `ops-scripts.test.mjs:98–139`, duplicate cover assertion accepts any duplicate; valid digests at lines 195 and 239–241 are checked only for a 64-hex shape. Production digest participates in duplicate grouping (`audit-reading-metadata.mjs:95–245`). | A constant/wrong SHA-256 can create false duplicate findings and satisfy these assertions. | Assert an independently calculated known digest for a small fixture, exact equal-byte duplicate group, and no duplicate for different bytes. Assert hardlink/race failures remain safe. | Small |
| P2 | `ops-scripts.test.mjs:496–550` combines link fixtures and uses shared “some finding” predicates for multiple unsafe candidates; `ops-scripts.test.mjs:752–782` combines missing headers and wrong marker. | Removing srcset extraction, one control-character path, or marker validation can remain hidden behind a different failure. | Parameterize candidates and assert their exact source/path and category. Test wrong marker with all valid headers; test each absent header with valid marker and remaining headers, requiring the named header diagnostic. | Small–moderate |
| P2 | `production-smoke.test.mjs:52–71` low HSTS age `31535999` also omits preload; `production-smoke.test.mjs:119–151` missing/weak header assertions only require any finding. | Lowering the HSTS minimum can be masked by missing preload; another always-failing header can mask a disabled check. | For age boundary 31535999/31536000/31536001 use otherwise-valid HSTS including includeSubDomains/preload. For every page assert a valid baseline has no findings, then require the correct diagnostic for each single changed/deleted header. | Small |
| P2 | `production-scripts.test.mjs:27–31` iterates the implementation's PAGE_FILES; `ops-scripts.test.mjs:469–494` builds and expects link inventory from implementation-exported file lists. | Removing a monitored page/data file from the implementation can shrink both fixture and expected result without failure. | Independently assert the approved page-to-file manifest and authored link-data/generated-page manifest. Cross-check production PAGE_FILES with PAGE_CHECKS where their contracts are meant to coincide. Decide explicitly whether the link scan contract includes service-doc; do not silently change scope because the smoke contract includes it. | Small |
| P2 | `production-scripts.test.mjs:233–248` only tests repeated failure retries, some final messages, and sleep count. `ops-scripts.test.mjs:872–950` has useful smoke fail→success counts. | Script runner attempts can fetch too many/few resources, return stale findings, or sleep the wrong interval while this case passes. | Assert exact per-attempt request sequence/count, configured sleep argument, fail→success recovery, and final findings only from the last failed attempt; invalid inputs must produce zero requests. | Small |
| P2 | `ops-scripts.test.mjs:332–454` has strong rendering/inventory cases but only happy 2x classification. `check-performance-budget.mjs` treats rendered 2x image budget and general single-file budget separately. | Removing the 2x budget branch can pass these assigned cases; off-by-one boundaries are weak. | Render a real 2x source just above its specific limit and assert the 2x diagnostic while still under the general single-file limit; exact-limit counterpart succeeds. Add exact index budget boundary and distinct general file/directory limit cases where not already protected by another suite. | Small–moderate |
| P2 | `production-scripts.test.mjs:163–178` uses injected response text/Buffer mutation and MIME rejection; default asset path is covered only by happy bytes at lines 180–207. Current integrity compares buffers (`check-production-scripts.mjs:150–153`). | A raw-byte-to-decoded-text regression can miss unequal invalid UTF-8 bytes; response-status and HTML MIME branches can remain unprotected. | Default transport mock returns unequal raw bytes that decode identically and must fail integrity; separate bad asset status, bad page MIME, MIME parameter/case acceptance, and one-asset failure. | Moderate |
| P2/P3 | CSP grammar cases (`production-smoke.test.mjs:24–50`) reject broad variants but mostly use non-null rather than a specific failed invariant. Shared parsing/policy cases often use generic throws. | A different accidental validation failure may mask the intended rule; required-directive omissions and parser resource boundaries lack an independent fixture matrix here. | Start each negative from a valid baseline and change one rule; assert category/code where stable. Exercise policy-count boundary, each required directive, supported approved hash forms, and matching positive controls. Keep browser-confirmed payloads and parser unit tests as separate policy/semantics protections. | Moderate |

These are assertion/coverage gaps, not demonstrations that current production code is broken. No hand-seeded defect was executed. Prior phase results are not fresh execution evidence for this audit.

## All-cases decision ledger

Legend: **R** = retain; **I** = retain and strengthen as described. No cases are proposed for removal. Line numbers identify top-level case starts at the reviewed snapshot.

### `tests/security/network-safety.test.mjs` — 7 top-level, 12 named nested cases

| Line | Case | Oracle and unique protection | Decision / gap |
|---|---|---|---|
| 40 | DNS validation rejects empty, malformed, invalid, mismatched, and unsafe answers | Named subcases: empty answer, non-object record, invalid address, bracketed IPv6, invalid family, address/family mismatch, zone-scoped IPv6. Rejection diagnostic checks preserve malformed-answer handling. | I: add mixed/multi-record and second-record malformed cases; all current negatives are empty/single answer. |
| 62 | IP policy blocks special-purpose ranges that are not globally reachable | Exact booleans for deprecated/special IPv4 and IPv6, mapped/NAT64 private/public, nearby ranges and public controls. | R: rare security regression value. Consider independent endpoint tables for every denied CIDR; no completeness claim. |
| 109 | injected HTTPS transport requires an explicit validated DNS seam | Explicit missing-lookup rejection protects injected transport authorization seam. | I: direct validated/denied transport, bytes, resource, abort, and options cases. |
| 120 | pinned lookup refuses host substitution after DNS approval | Wrong-host callback returns error instead of an address. | R/I: options.all, IPv6, family selection, canonical host and malformed constructor records are not isolated here. |
| 130 | pinned HTTPS request reuses the approved address without a second resolver call | Resolver count 1; supplied lookup invoked; approved address, agent false, SNI, returned bytes/status. | R: verifies option wiring and unit seam, not actual socket/TLS binding. |
| 156 | pinned HTTPS request enforces declared and streamed byte limits | Named subcases: declared Content-Length and chunked response; both reject 65 at limit 64. | I P1: second subcase has only one chunk; add cumulative and exact-boundary assertions and cleanup. |
| 182 | pinned HTTPS wall timeout covers DNS, response headers, and body completion | Named subcases: DNS (request must not run), headers, body. AbortError and configured diagnostic; bounded outer test timeout. | I P1: mocks do not assert destruction; add late resolution/header and timer/cleanup oracles. |

### `tests/security/production-scripts.test.mjs` — 16 cases

| Line | Case | Oracle and unique protection | Decision / gap |
|---|---|---|---|
| 27 | Committed pages contain only approved script inventory | Actual pages pass hardcoded script identities, order, and approved inline hash. | I: independently lock all eight page/file entries; exported enumeration alone can shrink silently. |
| 33 | Offline/service documentation require no scripts | Exact empty extraction and validation; extra external/inline script fails. | R: independently protects the zero-script page exception. |
| 49 | Injection/removal/inline mutation rejection | External bridge/Cloudflare/module/inline, removed approved script, handler and changed JSON-LD fail. | R/I: assert replacement fixture target exists; expand isolated order/duplicate/removal controls if absent elsewhere. |
| 76 | Comments, raw-text and attribute parsing | Inert markup ignored, reordered attributes accepted, raw script body context and malformed endings fail. | R: semantics integration complements shared parser units; some small snippets assert counts rather than exact body/attrs. |
| 91 | Aliases and duplicate attributes fail closed | Protocol-relative, unexpected bridge/query, duplicate src, nonce, async fixtures throw. | I: generic throws can mask wrong failures; pair specific diagnostics with valid controls. |
| 106 | Injected runner happy request vector and bridge findings | All eight pages plus two assets, exact clean findings and exact all-page bridge findings; local origin rejected. | R: mocked local-byte contract integration, not production delivery proof. |
| 139 | Inline execution and malformed browser context rejected | Event, encoded/control URL, iframe/srcdoc, base, refresh, ambiguous comment, SVG/MathML payloads; Unicode control. | R: valuable fail-closed matrix; prefer categories where stable, retain all rare payloads. |
| 156 | Local baseline cannot approve extra executable content | Changed expected baseline is rejected; credential-bearing source fails. | R: prevents comparing two equally unsafe inventories. |
| 163 | Runner catches asset byte changes and MIME errors | Two failure modes each produce two asset findings with a reason. | I: default raw-byte edge, asset status, page MIME, exact boundary and one-asset failure. |
| 180 | Default transport pins every request | Agent false, SNI, connection close, approved DNS callback, exact pages/assets vector, clean findings. | R: meaningful consumer wiring; mocked callback is not a real TLS/DNS integration oracle. |
| 209 | Private DNS and unsafe local inputs rejected before transport | Request count zero, per-resource blocked findings; local JS symlink and parser bytes; missing validation seam rejected. | R: filesystem and pretransport regressions valuable; shared safe-input tests protect broader race/parent cases. |
| 233 | Retries and errors are bounded | Two attempts, one sleep, final error findings and invalid options rejection. | I: exact calls/delay, fail→success and final-attempt freshness. |
| 250 | Attribute/raw-tag recovery bypasses rejected | Five offline payloads throw. | R: preserve browser recovery regressions, pair normal authored equivalents. |
| 261 | Browser-confirmed raw/tag/declaration bypasses rejected | Seven historical payloads fail closed under current parser. | R: security history value; this audit did not rerun a browser. |
| 274 | Non-ASCII whitespace cannot create src attribute | NBSP, vertical tab, em-space mutations reject with execution/parser diagnostic. | R: regression against JavaScript whitespace/HTML tokenization mismatch. |
| 282 | Foreign scripts, xlink, templates and MathML rejected | Four foreign/template execution surfaces throw. | R: layer policy decision, not a duplicate of parser semantic units. |

### `tests/security/production-smoke.test.mjs` — 7 cases

| Line | Case | Oracle and unique protection | Decision / gap |
|---|---|---|---|
| 16 | CSP accepts current clean policy and stricter minimum | Exact null for approved baseline and stronger policy. | R: valuable positive oracle against blanket rejection. |
| 24 | CSP rejects broadened/injected/malformed policies | Broad unsafe-inline/eval/hash/wildcard/data/script-elem/attrs/frame/forms/connect/upgrade/duplicate/intersection/style/report/whitespace negative matrix. | R/I: single-invalid-rule fixtures and directive/count/hash boundaries; non-null alone may hide intended rejection source. |
| 52 | HSTS requires the required age and flags | Positive current/longer/quoted policies, malformed/short/duplicate flag negatives. | I: low-age fixture also lacks preload; isolate 31535999/31536000/31536001 with both flags. |
| 73 | Page validation reports weak CSP and HSTS | Exact clean findings; specific CSP and max-age diagnostics for changed headers. | R: composition oracle is stronger than generic error count. |
| 101 | Additional CSP policies obey intersection semantics | Good baseline, restrictive additional policies accepted; incomplete/unapproved additional policies fail. | R: independent multiple-policy semantic protection. |
| 109 | Permissions Policy disables all required capabilities | Positive baseline and extra disabled feature; missing/enabled/duplicate/empty-list malformed negatives. | R/I: per-required-feature omission and control/whitespace boundaries if not covered elsewhere. |
| 119 | Eight clean pages require complete security headers | Independent explicit page vector; each header weak and absent across each page. | I: establish no-findings baseline per page and require named header diagnostic, plus status-only/marker-only cases. |

### `tests/security/ops-scripts.test.mjs` — 30 cases

| Line | Case | Oracle and unique protection | Decision / gap |
|---|---|---|---|
| 70 | HTML attribute scan handles state and encoding | Exact three src values, no findings, inert comments/script/frame/plaintext, Unicode offsets, quotes/slash/entity and max-attribute limit. | R: shared scanner used by link/performance; standards parser units do not automatically validate this handwritten scanner. |
| 98 | Reading metadata reports missing/duplicate/missing cover | Individual finding predicates for author/ISBN/cover/identical content. | I: exact duplicate grouping and known digest, different-byte nonduplicate; other metadata fields are not isolated here. |
| 142 | Malformed records and unsafe cover paths rejected | Null/string/array, traversal/encoded/absolute, leaf/parent symlink, wrong file type, malformed field, oversize/hardlink; indexed diagnostics, preservation. | R/I: known digest for valid cover; retain resource and hardlink regressions. |
| 198 | Reading source validation bounds inputs | Empty valid JSON, symlink and over-2-MiB rejection. | R/I: malformed JSON and exact-boundary fixture where absent in shared source tests. |
| 217 | Source opens require nonfollow/nonblock flags | Actual wrapped open of five source paths; exact path list and available O_NOFOLLOW/O_NONBLOCK security flags. | R: unusual implementation assertion is justified by security contract; it covers invoked source paths, not all runtime files. |
| 280 | Cover reads detect post-validation races | Truncate after first chunk, same-size pathname replacement, hardlink gain; diagnostics, unchanged bytes/link preservation. | R: high-value race protection; optional descriptor-close oracle. |
| 332 | Performance happy inventory and index budget | Exact rendered srcset references, 2x classification, largest-file tie order; over-index-budget finding. | I: negative 2x threshold, general file/directory limits and exact boundary. |
| 360 | Performance dependency/junk/inventory constraints | Forbidden CSS/bootstrap/font, unreferenced book image, inventory cap, symlink asset fail. | R: separate policy and filesystem protections. |
| 385 | Performance HTML references and resource limits | Quoted/unquoted/query/entity/srcset, exact references/categories; malformed quote, traversal/control/unknown entity, inert text, 5001 references, large rendered asset, unreadable HTML. | R/I: 5000 success boundary and 2x-specific rejection; fixture mixture retains valuable detection but isolate masked categories if changed. |
| 455 | Link URL normalization rejects unsafe targets | Valid public HTTPS control; HTTP/credentials/localhost/private literals/malformed categories. | R/I: assert exact normalized URL/source, and table complete address boundaries outside pure-validation scope. |
| 469 | Link preflight inventories all configured inputs | Data and HTML fixtures created from exported source inventories; checks counts/source, no network. | I: independent authored manifest; removing an exported input otherwise changes both fixture and expectation. |
| 496 | Link collection handles JSON and generated HTML | Camel/snake keys, local controls, quotes/entities/raw contexts/srcset/malformed unsafe candidates with some category findings. | I: per-source/path assertions; srcset/href javascript and newline/backslash can mask each other. |
| 552 | Link numeric and traversal limits fail closed | Invalid numeric values, depth/node/reference budgets and strict result behavior. | R/I: exact-limit success and source-specific diagnostic optional; strict/non-strict distinction retained. |
| 575 | Link local source reads reject unsafe files | Leaf/parent symlinks and oversized HTML rejected. | R: parent path protection is distinct from ordinary local-read success. |
| 603 | Link HEAD transport is pinned and drains no body | Agent false, SNI, Range bytes=0-0, supplied lookup, status 204, response destroy count 1 and hostname substitution error. | R: strong cleanup oracle; distinct from network happy bytes test. |
| 652 | Link request timeout destroys request | Timeout message and request destroy count 1. | R: keep concrete cleanup count; late header/timer clearing can be added at shared helper. |
| 680 | Link DNS timeout is bounded | Never-resolving DNS produces timeout category/detail. | R/I: late-resolving DNS request-count check at shared/helper boundary. |
| 695 | Link transport failures retain diagnostic | Explicit transport error propagation. | R: separate request error path. |
| 719 | Repository hygiene path rules | Three exact pure classifier controls. | R: small baseline; broad path taxonomy tested through integration and other suites, not claimed complete. |
| 727 | Repository hygiene scans tracked/ignored junk safely | Real scoped temporary Git repo, ignored junk and allowed excluded dependency tree, exact findings. | R: genuine Git/filesystem integration; requires Git and expected platform facilities. |
| 746 | Workflow hygiene accepts current workflows | Current repository scan exact empty findings. | R: artifact integration smoke; rejection semantics are in standalone workflow suite outside this assignment. |
| 752 | Production header/marker validation | Valid page passes; missing headers plus wrong marker returns findings. | I: wrong marker must be tested alone with valid headers and exact marker finding; current negative can mask marker removal. |
| 784 | Smoke CLI options validate policy and bounds | Exact defaults/options, origin restrictions, attempts/time/retry bad values and explicit eight paths. | R/I: query/fragment/credential/missing/unknown and exact-max controls where absent elsewhere. |
| 806 | Smoke injected fetch enforces redirect/body bounds | redirect:error option, oversized response, stalled body AbortError, cancel count 1 and release count 1. | R: stronger cleanup oracle than network timeout mocks; additional declared/combined-chunk response forms can use shared helper. |
| 872 | Smoke runner attempts and DNS guards | Exact eight paths/count, invalid attempts fetch zero, private DNS failure, first 503 then second success with count 16 and one sleep. | R/I: final failed-attempt findings freshness and exact configured delay. |
| 952 | Default smoke pins DNS/transport every page | Exact resolver/request/lookup counts, approved address/family, SNI/agent and wrong-host behavior across eight paths. | R: consumer wiring unit; not real transport/TLS proof. |
| 1016 | Telemetry AST spellings and guard semantics | Combined network aliases plus isolated adapter spellings, each unsound event guard variant, explicit feature finding and 50k token rejection. | R: broad useful semantic negatives and rare spellings; combined predicates less precise but isolated variants preserve substantial sensitivity. |
| 1136 | Telemetry source read bounds and unsafe path | Symlink and >512-KiB runtime source report read failure. | R: independent local source boundary. |
| 1153 | Enforced first-party runtime inventory | Copied approved inventory clean; eight appended worker mutations each fail digest contract; normal fetch text, symlink failure; review date frozen to manifest. | R: mutations mainly prove reviewed-byte integrity, not independent semantic execution analysis. Retain historical payload intent; no claim of eight distinct semantic oracles. |
| 1183 | Enforced vendor inventory | Approved Workbox bytes clean, modified bytes fail, restored original plus unreviewed JS fails separate reason; review date frozen. | R: digest and unexpected-file contracts are distinct. |

## Integration, mocking, isolation, and nondeterminism limits

The network suites intentionally inject resolvers and request/fetch implementations. Their option/address/counter assertions prove application-to-transport seam wiring; they do not prove OS resolver behavior, actual TLS SNI, redirects on a live server, socket closure, or deployed headers. A small future loopback HTTPS integration with an owned certificate/transport override could validate actual cleanup and bytes without external access, but must keep the public-origin policy and production semantics intact. Browser-confirmed parser payloads remain useful regressions; rerunning Chromium and cross-engine checks is outside this static audit. CLI exit/status behavior and workflow hosted execution also remain unverified.

Temporary fixtures use scoped roots and test cleanup rather than shared application state; wrappers use injected filesystem seams instead of global monkeypatches. Real temporary Git initialization has an environmental dependency. No observed nondeterminism or runtime measurement is claimed because execution was prohibited. Timers of 10/20/100 ms can be sensitive under heavy scheduling, but current tests mostly assert outcome rather than tight elapsed duration. Strengthen with controlled promises and cleanup counters; preserve generous outer deadlines rather than brittle millisecond equalities. Inventory tests intentionally load current approved repository artifacts and therefore track authored baselines; they need independent scope manifests and explicit mutation-target-present assertions to avoid silent fixture drift.

Repeated hostname pinning cases in the library, link wrapper, smoke wrapper, and script wrapper protect different consumer wiring, response/body behavior, and resource vectors. Repeated CSP checks protect grammar, composition, and runner scope. Parser semantics and executable-element policy are distinct. Shared line coverage is not evidence these protections are redundant. No case should be removed based on this report.

## Evidence fingerprints and next step

SHA-256 of inspected test files:

```
cfe963b3f81c925fdf330630e762c8effc8b6302110701913373f7adcc4d9e6d  tests/security/network-safety.test.mjs
a6845e855013758d26755d6174716f2302471aa3919a371aede87887cc622109  tests/security/ops-scripts.test.mjs
5a670cf1eb124bc4b0069c609ce1ce6016b51d75718102bee8fdfab43424c892  tests/security/production-scripts.test.mjs
44d093ec29680ad939d90e17bd9cf93e9a0376019ca558a1f5813fde1e475c3a  tests/security/production-smoke.test.mjs
```

Direct production contract fingerprints:

```
30d088d3def8bb8f9131d56ec1b128ee8cc73e61b04ce79a5febd06f7b822726  scripts/lib/network-safety.mjs
774656c0bae8c6dece64f86e99418d4601ead867c01dad8e1eaa52a804e80674  scripts/check-production-scripts.mjs
6c473001d85ebd58cadfd76b758af3e9f976c2868232b727918b8cac97c6d733  scripts/check-production-smoke.mjs
5aee298d2478bd383260138eea4f3aa7051cb5adc23cac100c393db74095eaee  scripts/lib/html-document.mjs
995ccf4d28332bcc2612b8b0eba2a50cccfbeea8f59323bfd2592a19ea8ca59b  scripts/lib/html-attributes.mjs
2c53c039e244f0d7f4d979311501c36d8eb6e7bc499d18a03cdda9c7081ea6c6  scripts/audit-reading-metadata.mjs
4513e5119e7105983a9b81b1796547f8322cff7bf3b00cc861b398951f147c95  scripts/check-performance-budget.mjs
ebac55c6240f94c4be20d89b3a5c41b1760c5100fa0ce99de76ab11570ab2e41  scripts/check-link-health.mjs
cb29a8a9098a3e82cf5a0e08b71446ebf30affbfce3a058d2f2cbd6a45b69e60  scripts/check-repository-hygiene.mjs
e975e8040b5e3f551fc1cb7ac077320d20d8d94c5cf9886423492c872e7174e3  scripts/check-workflow-hygiene.mjs
8b08b15fe1f0eed1ad7b99338870f7f0a3d07996ba7fbe3b9f79f1add0f8c4d8  scripts/check-telemetry-policy.mjs
765e4979c60454068c8c77b2b2fd66fd5079a15ab97224c6124b3fa00c174e3c  package.json
55700d5562495b1809d2e524ef378d8df427b0a0bc62fb22ff78d8a4addd229b  package-lock.json
```

Applied changes: none. Recoverable source/test diff: none. Before/after behavioral inventory: unchanged; proposed assertions above are not implemented. Static audit findings are complete for all assigned cases. Execution/coverage/mutation proof remains pending under the parent's authority. Next step: parent prioritizes P1 cumulative/cleanup/mixed-DNS oracles, then unmasked negative and integrity boundaries, and runs focused verification plus the configured fresh coverage collection. Include actual failures and metric limits in the integrated report; do not describe this static analysis as a passing check.


---

# Appendix: Browser and worker

# Browser and service-worker test-quality audit

## Authority, evidence identity and limits

Audit-only inspection of **every declared case** in `tests/integration/mobile-nav-and-accordion.spec.mjs`, `tests/integration/offline-fallback.spec.mjs`, `tests/integration/accessibility-smoke.spec.mjs` and `tests/security/service-worker-message.test.mjs`, against relevant `js/main.js`, `js/site.js` and `pwabuilder-sw.js` contracts. Repository root: `/Users/leonardwongly/Developer/ProjectPortfolio`. HEAD inspected: `11362edcabc93025dafeea66a2f60c90d82a2b48`. Worktree was clean at initial inspection and identity capture, UTC `2026-10-03T16:33:53Z` (local date 2026-10-04).

Applied the audit-test-quality skill and read its evidence, evaluation and report references. This subagent performed **no test execution, coverage collection, mutations, source/test edits, deletions or commits**. The sole written artifact is this requested audit report. Root owns fresh runner and coverage evidence. Earlier-turn test results and ad hoc upgrade checks are not fresh results for this audit. No passing result is claimed here, and no per-test coverage percentage is inferred from suite totals.

All current cases should be retained. `Improve` below means retain existing protection and strengthen it or add a complementary case. No removal candidate exists. This is a code-based decision ledger, not a numerical quality grade. Default low-coverage selection is strictly below25% separately for each supported metric; there is no computed below-threshold set here. Coverage line/statement, branch and function dimensions are **unknown here** until root provides fresh instrumented reports, not zero. In the package's normal Node coverage command, includes cover `scripts/**`, `playwright.config.mjs` and `pwabuilder-sw.js`; they do not include `js/main.js` or `js/site.js`. Browser execution does not itself establish measured coverage for those omitted frontend targets.

Reviewer: `/root/audit_offline`, browser/worker audit subagent. The reviewer authored the localhost regression and the debug:false unit expectation in an earlier implementation turn; this audit of those portions is **not independent review of its own work**. Root or another independent reviewer must evaluate their raw snapshots. All six collaboration slots were occupied, so no further reviewer was spawned. No deletion is requested or authorized, and an independent deletion gate therefore remains unused.

### SHA-256 snapshot manifest

| Input | SHA-256 |
|---|---|
| tests/integration/mobile-nav-and-accordion.spec.mjs | 2db5d53ec5dcb5f81172fd758a93e8d1d497c89cdb610322281e24dd22b100ac |
| tests/integration/offline-fallback.spec.mjs | eea98d3849e745654521678838c3ad8d8cecfaae9859bb3dd4b487e42cd03851 |
| tests/integration/accessibility-smoke.spec.mjs | 8b7ac3b333432c26acc78e03c1c49f2709209dfa8a98a2c54ad8571af94382a1 |
| tests/security/service-worker-message.test.mjs | 64f542e4bb34bfb8ede231a937d5e9139ab72ed92a861d6a8e915823d7c43781 |
| js/site.js | cea6ec631aa1a6e2ecb6698e87b0cb997d00335b76b89dd30de24ef23a3bf7f3 |
| js/main.js | e8b9705de81610124a27b2b6e6a99918be07741be72119fbb52d7cbc2a9ee663 |
| pwabuilder-sw.js | 3f119738bdd1e6e48b4b638e264a7c26706b99c3c54f3eb5fd1f265150fccc4c |
| playwright.config.mjs | 9d7e312c16ba846d988476151a2acb974eaac85aa3b13d4a80ff56956d1a9031 |
| package.json | 765e4979c60454068c8c77b2b2fd66fd5079a15ab97224c6124b3fa00c174e3c |
| package-lock.json | 55700d5562495b1809d2e524ef378d8df427b0a0bc62fb22ff78d8a4addd229b |

## Runner boundaries and inventory

`playwright.config.mjs:95-129` defines Pixel 5 mobile Chromium and desktop Chromium 1366×900, one worker, fresh staged static-site server on loopback, no server reuse, 30-second case timeout, and one CI retry. Default `serviceWorkers:'block'` at line 106 isolates ordinary UI/axe cases; offline tests override to `allow`. This is useful isolation, but ordinary update cases replace navigator.serviceWorker with a harness and cannot prove native lifecycle transitions. No Firefox/WebKit/iOS/device/hosted-header evidence is established by this configuration. Staging is local and deliberately does not reproduce provider `_headers` enforcement.

Inventory: 21 named mobile-nav-and-accordion cases; four offline named cases after expanding light/dark; 14 axe page/theme cases; ten Node worker cases. That is 49 named cases across the four files. The 39 Playwright names expand to 78 project instances: the three mobile navigation cases skip desktop, one desktop navigation case skips mobile, and five update cases skip mobile, yielding **nine intentional project skips and 69 runnable instances** under the current config. These are static inventory expectations, not run outcomes. Root should reconcile fresh results against them. Project-name prefixes drive skips (`mobile-nav-and-accordion.spec.mjs:3-8`); renaming a project can silently skip relevant contracts. Offline CDP cases explicitly skip non-Chromium, so adding WebKit/Firefox would require a separate non-CDP registration/offline strategy.

## All-cases ledger: mobile-nav-and-accordion.spec.mjs

All line references below are repository-relative under the root above; each row identifies an exact current test title. M01–M03 run mobile only; M04 and M05–M09 desktop only; M10–M21 run both current projects.

| ID / start | Exact case | Existing valuable oracle / decision |
|---|---|---|
| M01 :147 | navbar toggles and collapses after selecting a nav item | Initial/expanded/collapsed aria-expanded and show class; forged cloned readiness marker must not prevent new click listener. **Retain**, strengthen rendered visibility and selected destination in F04. |
| M02 :182 | navbar closes on Escape for keyboard users | Escape from an opened menu's link closes menu and updates aria-expanded. **Improve**: assert focus returns to the toggle, F04. |
| M03 :201 | navbar closes on Escape when focus remains on the toggle | Enter opens, Escape closes, toggle retains focus. **Retain**; valuable distinct keyboard dispatch owner, not duplicate M02. |
| M04 :224 | navbar links are visible without opening collapse toggle | Desktop toggle hidden, panel/work link visible and correct href. **Retain**; complementary breakpoint behavior. |
| M05 :240 | registers once across loading, interactive, and complete initialization states | Three synthetic readyState branches, duplicate explicit initialization, synthetic load; exact registration/listener/load-handler counts and registration state. **Retain**, add real delayed-script initialization boundary F11. |
| M06 :270 | fallback update token satisfies the worker schema at the zero-random boundary | Overrides crypto, Date.now and Math.random, restores them, asserts schema at zero entropy/time boundary. **Retain**; rare supported fallback boundary. Its oracle is schema, not entropy/security authentication. |
| M07 :299 | first installation taking control does not reload an unsuspecting page | Synthetic controllerchange without reload request, one observed main-frame navigation. **Retain**, complement with real install F06 and improve bounded negative timing F11. |
| M08 :325 | discovered update stays actionable after postMessage failure and reloads once after retry | Synthetic updatefound/install, visible prompt, thrown postMessage retry, exact attempts/payload, two controllerchanges produce one reload. **Retain**; valuable failure/race protection. Complement native upgrade F06. |
| M09 :384 | prompt stays actionable when another tab activates before or during the activation request | Waiting disappears before click then during getter; observed reload counts and still actionable prompt. **Retain**; two distinct synthetic races. Real multi-tab/native activation remains unproved F06. |
| M10 :432 | keeps keyboard focus inside the dialog until closed | Opener, input initial focus, Shift+Tab/Tab wrapping, Escape hidden state and focus restoration. **Retain**; filtered focusable list/removed opener boundaries in F05/F09. |
| M11 :463 | does not leave focus inside the hidden dialog after shortcut close | Control+K opens but **Escape closes**; oracle only says activeElement is outside palette. **Improve**, actual shortcut close and a positive valid focus target F05. |
| M12 :481 | exposes arrow-key command selection to assistive technology | First active descendant, ArrowDown selects known second option and ARIA ID relationship, Enter changes URL to #work. **Retain**; add ArrowUp/bounds/filter reset and visible option exclusivity F05. |
| M13 :505 | announces empty command palette results | No-match query makes status visible, aria-describedby set, active descendant absent. **Retain**; test clearing query restores options/state F05; live announcement delivery is not proved. |
| M14 :526 | home presents three flagship projects and linked proof points | Exact card/link counts and View-all href. **Improve**: counts do not establish each project identity, proof destination or meaningful label, F03. |
| M15 :534 | project archive presents the complete inventory with explicit status | Seven cards/seven status elements and heading visible. **Improve**: blank/duplicate/wrong status elements still satisfy counts, F03. |
| M16 :542 | flagship case studies expose architecture, evidence, and tradeoffs | AgentForge h1, five architecture entries/four decision cards, visible sections, Work aria-current, next href. **Improve**: only one flagship page covered despite plural title; content/links and other case studies F03. |
| M17 :556 | accordion panel expands and collapses via trigger button | Listener readiness marker, initial state, click state and reversal. **Retain**, add rendered content visibility/keyboard activation F04. |
| M18 :577 | opening second panel collapses the first panel | Second aria/show true; first aria/show false. **Retain**; distinct single-open invariant, scoped sibling/independent group behavior F04. |
| M19 :600 | recovers from corrupt state and forged listener markers without duplicate ownership | Corrupt button metadata repaired from panel state, repeated init avoids double toggle, cloned forged marker gets a working listener. **Retain**; unusual regression protection not redundant with M17. |
| M20 :652 | filter buttons expose selected state to assistive technology | Incoming year/tag selects ARIA buttons, All-year click swaps two year states. **Improve**: actual books, count, tag persistence, URL and list/grid remain unchecked, F02. |
| M21 :674 | typing a search does not persist free-form text into the URL | Search filled, fixed 250ms sleep, q absent in initially q-free URL. **Improve**: a missing/dead search listener passes this oracle, F01. |

## All-cases ledger: offline-fallback.spec.mjs

| ID / start | Exact case | Existing valuable oracle / decision |
|---|---|---|
| O01 :5 | real worker registers and serves its offline assets on localhost | Manual native registration, active script URL, controller polling, CDP HTTP-cache clear, offline nested navigation, h1 and nonempty stylesheet rules. **Retain**; uniquely catches Workbox localhost development-module loading. Uses script-free offline page, so complements auto-registration O02/O03. Reviewer authored it earlier; independent final evaluation required. |
| O02 :31 | offline fallback retains its styles and visible links with an empty HTTP cache (light) | Real main.js auto-registration and controller, HTTP-cache clear then offline nested route; correct heading/no scripts or buttons/CSS rules/light background; three visible absolute links navigate while offline; reconnect Work navigation returns real content. **Retain**. |
| O03 :31 | offline fallback retains its styles and visible links with an empty HTTP cache (dark) | Same as O02 with dark computed background; distinct theme branch, **Retain**. |
| O04 :68 | real worker activation preserves unrelated caches and removes its retired offline cache | Native fresh installation after seeded v2/unrelated caches, controller claim, only expected v2 removal and preserved unrelated name. **Retain**; tests fresh activation, not an already-active old worker upgrade. Populate cache entries and add native upgrade/error recovery F06/F07. |

O01–O03 explicitly require Chromium CDP. Clearing the HTTP cache before first offline navigation is a meaningful cache-origin oracle; these tests should not be removed as duplicated by VM mocks. Nested URL plus absolute stylesheet/links protects base-path regressions. The arbitrary offline route was not previously fetched, further separating fallback from HTTP-cache reuse. There is no native failed-install, erased-CacheStorage emergency response, real waiting-worker update, or native navigation-preload assertion in the committed cases; VM tests protect many of those decisions but do not replace those boundaries.

## All-cases ledger: accessibility-smoke.spec.mjs

Every named case originates at line 19 and uses the page path at lines 4–11, media color scheme plus reducedMotion:'reduce' at line 20, full-page AxeBuilder with wcag2a/wcag2aa/wcag21a/wcag21aa tags at lines 23–25, and an empty violations array at line 27. All fourteen names run in both current Chromium projects. All are **Retain + complementary improvements F09/F10**; each adds a distinct page/theme/breakpoint boundary.

| ID | Exact case |
|---|---|
| A01 | /index.html (light) has no axe violations |
| A02 | /index.html (dark) has no axe violations |
| A03 | /work.html (light) has no axe violations |
| A04 | /work.html (dark) has no axe violations |
| A05 | /case-study-agentforge.html (light) has no axe violations |
| A06 | /case-study-agentforge.html (dark) has no axe violations |
| A07 | /case-study-agentic.html (light) has no axe violations |
| A08 | /case-study-agentic.html (dark) has no axe violations |
| A09 | /case-study-apple-calendar-mcp.html (light) has no axe violations |
| A10 | /case-study-apple-calendar-mcp.html (dark) has no axe violations |
| A11 | /reading.html (light) has no axe violations |
| A12 | /reading.html (dark) has no axe violations |
| A13 | /offline.html (light) has no axe violations |
| A14 | /offline.html (dark) has no axe violations |

The assertion is a valid automated WCAG 2/2.1 smoke oracle. It does not establish overall accessibility conformance, WCAG 2.2, actual screen-reader announcement, manual keyboard flow, magnification/forced-colors behavior, open hidden widgets, native worker fallback pages under arbitrary navigation, or no-preference animation behavior. Default worker blocking is intentional; O02/O03 independently inspect actual served fallback. No explicit theme-state assertion precedes axe, so two media modes are requested but the desired computed theme/persisted-toggle behavior is not verified.

## All-cases ledger: service-worker-message.test.mjs

VM executes current worker source, but `importScripts` and Workbox are stubs (`:65-79`), CacheStorage always opens successfully (`:56-59`), and clients.claim always succeeds (`:85-89`). Native request/response/client/event semantics are replaced by plain objects except for emergency Response. Retain this fast decision-level layer and supplement it where browser semantics matter.

| ID / start | Exact case | Valuable oracle / decision and limit |
|---|---|---|
| W01 :174 | worker owns skipWaiting only for well-formed messages from same-origin windows | Rejects 22 named payload/token/origin/client spoof cases; accepts inclusive 16/64-length tokens including uppercase; exact waitUntil promise ownership and skip count. **Retain**. No actual WindowClient/message transport; native accepted upgrade belongs in F06. Rejection from skipWaiting itself is untested F07. |
| W02 :226 | install atomically stores the offline document and stylesheet and fails closed | Exact owned cache/addAll asset list/local import/config and waitUntil rejection on addAll failure. **Retain**. “Atomically” invokes the cache API contract rather than proving native storage atomicity or previous-worker survival, F07. |
| W03 :249 | activation claims existing clients so an accepted update completes the reload flow | waitUntil awaited and clients.claim count one. **Retain** as unit contract; title overstates native frontend reload proof, F06. W04 additionally checks ordering/nonempty cleanup; do not remove W03 based only on similar names. |
| W04 :258 | activation removes only explicitly retired owned offline caches before claiming clients | All three retired exact names deleted, current/future/lookalike/unrelated excluded, unresolved deletion blocks claim, claim occurs after resolution. **Retain**; valuable bounded ownership/ordering. Rejected keys/delete/claim paths need an explicit contract F07. |
| W05 :284 | navigation response pipeline prefers preload, then network, then cached offline content | Five branches: successful preload skips fetch/cache; absent preload fetches; rejected preload recovers via fetch; failed fetch reads owned fallback; unsupported preload stays disabled. **Improve** exact original request argument and real Response status/header identity, F08. Plain sentinels prove selection but not browser response compatibility. |
| W06 :353 | offline navigation still returns a bounded response when cache state is corrupt | Missing entry/read failure produce native Response status503/no-store/body containing offline and length≤80. **Retain**. No caches.open failure can be injected by current harness, F07; add explicit Content-Type parity with W09. |
| W07 :385 | worker has one fetch listener and leaves unrelated non-navigation requests alone | Single listener, throws if preload observed, no ownership/fetch/cache for unrelated CSS. **Retain**; protects against broad interception, not redundant with URL-specific W10. |
| W08 :409 | offline stylesheet prefers network, then its owned cache, without caching arbitrary responses | GET exact CSS request forwarded; network skips cache; failed fetch reads own CSS key; no cache.addAll runtime writes. **Retain**, real Response/error-status cases F08. |
| W09 :431 | offline stylesheet cache failure returns a bounded non-HTML response | Missing/unreadable cache produces503/plaintext/no-store/body≤80. **Retain**; CSS MIME/resource-bound boundary differs from document W06. caches.open failure remains F07. |
| W10 :451 | offline asset interception rejects non-GET, other-origin, altered and malformed URLs | Fourteen named method/origin/query/fragment/encoding/case/path/malformed variants all leave request alone; no fetch/cache side effects. **Retain**. Some synthetic fragment/malformed inputs do not occur in native Request URLs but cheaply protect exact predicate scope; do not delete solely for rarity. |

## Prioritized gaps and proposed behavior/oracles

These are **test-quality findings and missing protection**, not claims of confirmed production defects. Priorities describe improvement order. Implementation and test execution require separately authorized remediation. No hand-seeded defect probes were run.

### F01 — P2: search privacy case can pass with a broken search control

Evidence: M21 `mobile-nav-and-accordion.spec.mjs:674-680`; source `js/main.js:936-961,986-994`, sanitize/query params `:785-790,896-927`. Test starts without q, fills a query, sleeps250ms and only observes q still absent. Removing the whole input listener preserves its observed oracle. A delayed address-bar regression can also arrive after the fixed wait.

Propose a known matching/nonmatching query with independently known fixture book identities; assert the visible identity set, result text and empty-state transitions, input sanitization at the 120-character boundary, and absence of raw query in resulting history URL. Add incoming `?q=` initialization: search is populated and filtering works, but implicit history drops q while retaining allowed year/tag/view. Observe the scheduled/history operation deterministically (clock or a recorded replaceState call) rather than sleeping. Distinguish explicit share intent, which deliberately adds q, from implicit address-bar privacy. Cost small/medium; dependency a stable book fixture and deterministic timer strategy; acceptance a disabled listener or no-op filter would fail meaningful oracles while valid search still leaves no implicit q.

### F02 — P2: selected filter states do not prove filtering correctness

Evidence: M20 `:652-671` asserts buttons only; `js/main.js:843-846,874-963,965-983` conjunctively filters year/tag/query and announces counts. Proposed oracle: known expected books for year AND tag, count matches set, zero matches announces empty state, All-year retains active tag and updates URL without dropping view; grid/list selection updates grid data-view and exclusive pressed states. Invalid incoming year/tag/view fall back to safe defaults. Cost medium, stable independent fixture needed. Acceptance removing `updateFilters` or changing AND to OR fails; retain existing ARIA-state checks.

### F03 — P3: evidence hierarchy cases rely mainly on counts

Evidence: M14 `:526-531`, M15 `:534-539`, M16 `:542-551`. Correct numbers of empty/duplicate links/cards/status elements can pass. M16 visits only AgentForge despite the plural title. Proposed oracle: expected unique project names/IDs, nonempty status from approved vocabulary per card, expected proof destinations and meaningful accessible link names, followed internal links display intended heading. Parameterize architecture/evidence/tradeoff contract over the applicable case-study pages with explicit expected section identities. Keep counts as inventory guards. Cost small/medium; dependency approved generated-content inventory; acceptance duplicate/blank/wrong destinations fail.

### F04 — P2: navigation/accordion state checks should include visible content and focus

Evidence: M02 `:195-198` omits toggle focus although `main.js:327-334` promises it. M17–M19 primarily assert class/ARIA (`:564-647`) while source `main.js:349-409` governs panels. Proposed oracle: opened panel text visible, closed content inaccessible/hidden; Enter and Space trigger native buttons; Escape from nav link returns focus to visible toggle; selecting link reaches expected hash/page. Two accordion groups do not collapse each other; a missing/invalid target is a safe no-op when that supported guard is deliberately fixture-tested. Cost small; acceptance broken CSS visibility or focus restoration fails separately from class toggling.

### F05 — P2: shortcut-close name and focus oracle overstate what is checked

Evidence: M11 `:467-478` opens using Control+K then closes using Escape. Source `main.js:178-185` has a separate shortcut-toggle closing branch. ActiveElement outside a hidden dialog permits unfocusable body or an unrelated hidden element. Proposed case uses shortcut twice and asserts exact visible opener or `#content` fallback focus; removed/hidden previous opener triggers fallback. Add filtered command Tab/Shift+Tab containment, ArrowUp/bounds, one selected visible option, empty-query reset, Enter closing and returned focus, theme command effect, backdrop close. Cost small/medium; fixture an opener removed during open; acceptance removing shortcut close or pointing focus to hidden content fails. Retain current Escape scenario under an accurate title.

### F06 — P2: real waiting-worker/message/reload lifecycle is absent from committed cases

Evidence: M05–M09 replace native serviceWorker (`:103-105`); W01–W04 use VM stubs; O04 performs fresh registration with caches seeded, not a previously controlling worker. Source `main.js:646-695` and worker `:77-107` form a native same-origin MessageEvent/WindowClient/waitUntil/activation handshake. Proposed complementary local-only browser scenario: a reviewed disposable server/fixture serves two trusted worker revisions, install and control revision1, update to revision2, observe native registration.waiting and visible prompt, click Reload, assert revision2 becomes controller, exactly one navigation occurs, cache ownership remains correct and offline CSS survives HTTP-cache clearing. Separate first-install no unsolicited reload and two-tab activation race. Cost medium; dependency controlled trusted worker fixture, no historical/untrusted execution; acceptance removing message origin/client acceptance or native skipWaiting breaks the test. Keep deterministic race harnesses, which cheaply cover difficult schedules.

### F07 — P2: installation/cache-storage error integration and some unit failures are missing

Evidence: harness open/keys/claim cannot reject (`worker test:48-59,85-89`); W02 injects addAll rejection only, W06/W09 match failure only; O04 success path only. Source worker `:93-107,128-161`. Proposed unit hooks for caches.open failure in install and navigation/CSS fallback, skipWaiting rejection ownership, and rejected claim/keys/delete with explicit lifecycle policy. Real browser: intentionally unavailable stylesheet during new-worker install leaves old active worker and its usable cache intact; externally deleted offline cache while controlled yields bounded503/plaintext/no-store offline navigation. Missing CSS entry yields a non-HTML failure rather than substituted document. Cost medium, local fixture and supported cache clearing required. The intended recovery policy for activation cleanup rejection is not specified; **blocked pending contract choice**, rather than inventing expected success. Acceptance original controlled offline experience survives failed update, and advertised emergency branches return their promised bounded response.

### F08 — P2: navigation stub does not check the forwarded Request or HTTP-response contract

Evidence: W05 `:303-329` returns sentinels regardless fetch argument, checks only fetch length; native `fetch(event.request)` contract at worker `:128-129`. Proposed oracle asserts strict identity of captured original Request (URL/query/method/headers preserved), uses real Response objects for network/preload/cache and asserts status/header/body forwarding. Include 404/503 responses to establish that normal HTTP errors are forwarded rather than mislabeled offline; fetch rejection alone selects fallback. CSS equivalent verifies Content-Type/status and exact original request. Cost small; acceptance replacing request with a hard-coded URL or ignoring response identity/status fails. Do not remove sentinel branch-selection tests; stronger inputs complement them.

### F09 — P2: axe default-page sweeps leave interactive accessibility states unexamined

Evidence: all A01–A14 only `goto` then axe (`accessibility-smoke.spec.mjs:19-27`); default hidden command palette/menu, collapsed accordion, unshown update prompt and filtered/empty results are not audited as opened states. Source `main.js:149-174,295-409,605-643,954-961`. Add focused axe sweeps after representative widgets are opened/filtered; assert intended computed theme before theme audits; keyboard skip-link reaches main, focus order/restore and no hidden tabbables, 200%/400% zoom or narrow reflow, forced-colors where supported. Human screen-reader checks are separate evidence. Cost medium; dependency local trusted states/harness and agreed accessibility standard; acceptance open-widget label/role/relationship defects fail. Current tagged smoke does not establish WCAG2.2 or full conformance; retain page/theme matrix.

### F10 — P2: site-card, theme preference and reveal behaviors have no direct assertions

Evidence: no case asserts `interactive-card` or `interactive-card-pointer` from `js/site.js:16-44`. Source adds card class once, then adds pointer class only without reduced motion AND with a fine pointer. Theme source `main.js:412-487` handles stored valid/invalid/missing preference, storage exceptions, explicit toggles and system changes; the axe matrix only sets OS media preference. Reveal source `main.js:490-568` has deduplication, bounded delay, IntersectionObserver reveal/unobserve, absent API/reduced-motion immediate visibility, and live reduced-motion changes.

Propose a compact behavioral matrix: known visible card gets base class; reduced-motion/coarse pointer excludes pointer class; fine pointer/no-reduction adds it; overlapping selectors do not duplicate effects; no-card page safely initializes. Theme toggle changes data-theme, accessible label/pressed state and visual colors; persists across reload, invalid/storage-failure fallback remains usable, system change only governs unset preference. Reveal target becomes visible on intersection; without API/reduced motion all targets visible without delay; live reduction removes pending reveal delay. Cost medium; dependency trustworthy browser media controls and small local fixture. Acceptance deleting site.js entirely, breaking preference change, or leaving cards hidden causes a direct failure. Numeric coverage for these targets remains unknown until instrumented collection.

### F11 — P3: timing and synthetic platform assumptions need explicit boundaries

Evidence: M07/M09 negative reload uses one requestAnimationFrame before count; M21 fixed250ms; M05 overwrites readyState rather than loading scripts at actual timings; project-name skip helpers `:3-8`. Proposed deterministic time/history observation for debounce, bounded quiet window or persisted navigation counter for no-unrequested-reload contracts, native late-loaded script initialization and actual loading-state progression, and a run inventory check for expected intentional skips. Preserve case-isolated pages, try/finally page closure in M05, restored global overrides in M06, exact payload checks, poll-based positive assertions, and no-server-reuse fixture. Cost small; acceptance delayed navigation/history regressions and accidental all-skipped groups are visible. CI retry may expose flakes through traces; a retry pass must be reported distinctly from a clean first-attempt pass.

## Handoff and verification acceptance

Root should attach fresh Playwright command/result/environment and coverage artifact hash with matching input manifest; distinguish retry passes, expected project skips, unsupported engines, and frontend targets omitted by Node coverage. Proposed reproducible suite selection (not run by this subagent): `npx --no-install playwright test tests/integration/mobile-nav-and-accordion.spec.mjs tests/integration/offline-fallback.spec.mjs tests/integration/accessibility-smoke.spec.mjs --config=playwright.config.mjs` and `node --test tests/security/service-worker-message.test.mjs`. Root owns commands/collection and should select a free local port if needed.

All-case static review complete. Retain all49 named cases; implement stronger reading oracles and a native worker upgrade first, then interactive accessibility/rendered-focus assertions, then theme/card/reveal matrices. Independent root review is required for self-authored localhost/config assertions and any later removal decision. No deletion or remediation is justified by coverage totals alone.


---

# Appendix: fresh independent candidate review

# Independent candidate evaluation

Audit-only evaluation of ProjectPortfolio snapshot `11362edcabc93025dafeea66a2f60c90d82a2b48`, 2026-10-04 Asia/Singapore. Initial conclusions were formed without reading other auditors' proposed findings or reports. No tests, defect probes, exporters, repository mutations, source/test edits, deletions or commits were performed by this reviewer. This report is the sole authorized write.

## Evidence boundary

Raw evidence directory: `/private/tmp/portfolio-test-quality-2026-10-04-l3lSsz`. Reviewed `before.json`, `baseline-execution.json`, `coverage-normalized.json`, and their recorded event/LCOV identities. SHA256 comparison against `before.json` matched all six candidate test files, network-safety, Web Bot Auth, resume builder, Playwright config, main/site scripts, package.json and package-lock.json. SHA256 comparisons matched the normalized report's identities for events.jsonl, lcov.info, baseline.log, baseline-execution.json and native-reporter.mjs. Normalized coverage is aggregate production-file coverage, not per-test attribution; no test quality verdict is inferred from percentages.

Baseline evidence records Node24.21.0, Darwin/arm64, exit0, no timeout, 14.129s. Candidate suite results: network-safety19/19 including subtests, web-bot-auth9/9, policy-regression27/27, resume-build22/22, playwright-config4/4. These are supplied runner results, not runs by this reviewer. `browser-results.json` was absent when checked; browser runtime success remains blocked pending that evidence.

There are **no instrumented production files below25%** in any supported metric. Therefore there is no available below25 candidate to remove or improve solely because it crosses the threshold. There are eight omitted targets:

| Target | Decision | Evidence and required protection |
|---|---|---|
| js/main.js | Improve | Outside Node includes. Browser cases execute navigation, palette, accordion, reading and mocked SW paths, but this supplies no numeric browser coverage. Add behavioral reading-share/fallback and theme/storage cases; preserve existing browser cases. |
| js/site.js | Improve | Outside Node includes. Source1-45 adds interactive classes, then gates pointer classes on reduced-motion and fine-pointer. Add coarse/fine-pointer × reduced-motion cases with exact class membership and an empty-document boundary. No selected browser test asserts those classes. |
| scripts/check-markdown-negotiation.mjs | Improve | Matching include but never loaded; unknown coverage. Source16-59 validates public origin and CLI timeout;94-125 checks status, media type, HTML-vs-Markdown, nonempty body and Vary. Add bounded injected/local fixtures for each response failure plus argument/origin boundaries. Transport should never contact the public site in a unit test. Shared network tests do not establish this consumer's Accept headers or classification. |
| Five js/vendor/workbox assets | Retain; numeric assessment blocked | Intentionally vendor-excluded. Do not count as zero. Dependency governance and real-worker integration are the suitable protection; changing vendored files or deleting tests based on absent native coverage is unsupported. |

## Independent decisions for the six candidates

### tests/security/network-safety.test.mjs — retain and improve

Retain all seven top-level cases and their subtests. Their unique contracts/oracles are materially different: `DNS validation rejects empty, malformed, invalid, mismatched, and unsafe answers`40 asserts precise rejection classes; `IP policy blocks special-purpose ranges that are not globally reachable`62 brackets permitted/blocked address ranges; `injected HTTPS transport requires an explicit validated DNS seam`109 rejects an unsafe injection seam; `pinned lookup refuses host substitution after DNS approval`120 prevents hostname substitution; `pinned HTTPS request reuses the approved address without a second resolver call`130 checks resolver count, actual selected address, agent disabling, SNI and returned bytes; byte-limit156 separates declared-length from streamed overflow; wall-timeout182 separates stalled DNS, headers and body. These protect SSRF/rebinding and resource bounds, even when other consumers invoke the same helper.

Improve `pinned HTTPS request enforces declared and streamed byte limits`156 and `pinned HTTPS wall timeout covers DNS, response headers, and body completion`182: `makeRequest`21 uses a no-op destroy, and timeout fixture destroys202/223/227 also do nothing. The rejection oracles would pass if the helper stopped destroying the request/response, leaving resources active. Source496-502 and535-555 explicitly destroy on timeout/overflow. Add destroy spies, exact-byte-limit acceptance, two-chunk overflow, and late response after deadline; assert both required cleanup and no successful settlement/continuing useful work. Add `aborted` and response-error propagation at source560-563. Cost low; no actual network necessary.

Improve direct `createPinnedLookup` cases for `{all:true}`, family mismatch, callback overload and missing callback (source284-314). These uncovered branches are compatibility/error-contract gaps, not a reason to remove host-substitution or pinning cases. Acceptance: all returned records belong to the approved set, mutation of returned records cannot change the pin, and unmatched family rejects.

### tests/security/web-bot-auth.test.mjs — retain and improve

Retain key publication15, source parity30, outbound signing34, signature-parameters67, authority/custom-method/whitespace80, Fetch method105, body digest130, normalized signature-header replacement142 and unsafe input164. Each guards a distinct artifact/cryptographic/HTTP normalization boundary; no equivalent replacement was demonstrated.

High-confidence improve: `hashes the exact byte range for ArrayBuffer views`130 supplies `new Uint16Array([0x1234])`134, with byteOffset0 and byteLength equal to the entire buffer. Expected digest138 also hashes the whole backing buffer. A defect replacing source44's `Buffer.from(body.buffer, body.byteOffset, body.byteLength)` with `Buffer.from(body.buffer)` would satisfy this test. Add a Uint8Array.subarray and a DataView with nonzero offset, shorter length and distinct prefix/suffix; compare digest against an independently constructed payload-only byte array, plus full ArrayBuffer and empty body boundaries. Cost low; expected defect sensitivity follows directly from the differing byte sets, not an executed mutation probe.

Improve signing34 and Fetch-method105 with at least one exact, independently constructed signature-base string and tamper negatives (method, target, covered header/body digest). Both existing verification cases reconstruct the base through imported production `signatureBase`, so correlated serialization errors can pass. The direct base67/80 checks verify fragments, not the exact complete serialization/order. Preserve their existing crypto verification.

Improve published JWKS15: only `directory.keys[0]`12 is examined for private material24; loop every published key, require usable verification metadata/unique nonempty kids and reject private `d` in any key. A second private key currently evades that specific assertion. This is an observed test gap, not evidence that the committed directory leaks a key.

Improve unsafe-input164 with duplicate/case-colliding components, malformed/missing/private-key type, future clock skew, exact freshness boundaries and maxAge invalid values. Source95-101,108-123 and150-158 implement these contracts; supplied uncovered lines confirm many are not exercised. Stub a clock in a disposable test seam to avoid the second-boundary race; do not weaken freshness policy.

### tests/security/playwright-config.test.mjs — retain and improve

Retain ownership8, deployment allowlist13, port parser24 and empty-port/staging-cleanup31. They protect distinct listener ownership, secret/source exclusion, command construction and temporary-root lifetime. Current allowlist assertions only exclude .git/package.json/scripts; add representative .env/config/data controls and verify staged intended artifact bytes/content, while preserving the actual declared allowlist. Exact valid ports1/65535 and noninteger/signed/whitespace forms improve parser boundaries.

Improve deployment-staging failure cases for a missing allowlisted artifact, nested symlink, nonregular entry and shell-significant workspace path. Source37-66 contains explicit reject branches; normalized uncovered lines40-41,53-54,64-65 show the branches were not executed. Use an isolated config fixture, never the live repository. Assert failure before listener launch, no secret bytes copied, exact command argument preservation, and temporary-root cleanup.

Potential production issue to expose with a regression: `stageStaticSite`60 creates a directory and can throw64 before the cleanup exit hook is installed86. A staging failure may leak that unique temporary directory. This is source-derived and unreproduced; a failing regression does not authorize a production fix within this audit-only request. Existing success-cleanup31 must stay.

### tests/security/policy-regression.test.mjs — retain and improve

Retain static discovery33; workflow security74/82/136; generated inventory164/coverage contract172; CSP/meta/header/hash202/215/228/243/265/278/423; documentation289; link/scheme300/318; retired domains332; inline style358; reading/static telemetry372/380/392; one SW implementation402; heavy covers413; semantic telemetry negative/positive fixtures450/491/511; runtime-inventory and worker-drift528. Source/text tests are legitimate policy/artifact guards, and overlap alone does not establish redundant protection. In particular clean URL243 and canonical rule423 differ in parser, source/generated scope and duplicate-rule/CORS oracle; do not remove either without demonstrated equivalence and retained replacement execution.

Improve `target=_blank always includes noopener and noreferrer`300 and `generated pages do not contain dangerous href/src schemes`318. Their regexes only recognize double-quoted, case-specific target syntax or immediately adjacent literal schemes. Browser-equivalent single-quote, unquoted, uppercase, whitespace/entity variants can evade those local assertions. Use the existing HTML parser with explicit parsed attribute/token oracles and table-driven syntax variations; ensure inert text/comment examples are not flagged. Retain parser/URL regressions elsewhere. Scope note: this gap is in these test oracles; other hardened validators may still reject unsafe generated content.

Improve `generated index CSP hashes match inline scripts in both HTML and runtime headers`265 with an independent SHA256 derivation of parsed inline script bytes. Its expected directive269 uses the production `renderCspScriptHashesDirective`, permitting correlated builder/hash errors. Assert exact script hash set in the relevant index route and meta policy, not presence somewhere in the whole headers file.

Improve reading controls372, share wiring380 and single SW implementation402 with browser behavior, while retaining their static artifact guarantees. Mere token presence cannot prove click handling, privacy-safe properties, native share cancellation, clipboard fallback, feedback or ownership. Strong semantic negative/positive tests450-572 should be retained; they exercise scanner decisions rather than merely listing expected source tokens.

Improve workflow-string checks74/164/172 with parsed YAML/job/step assertions where not already supplied by the dedicated workflow suite; a matching comment or disabled/unreachable step does not enforce a gate. Deduplication/removal of overlapping workflow cases remains blocked until that suite's retained IDs, job boundaries and defect sensitivity are shown equivalent.

### tests/security/resume-build.test.mjs — retain; targeted improve

Retain the validation/load/parser/render/hash/freshness/structure cases178-538, exporter resource timeout563/675/758, coherent concurrent publication849, cleanup902, rollback932 and lock replacement983. Especially keep `PDF exporter bounds each Playwright stage and forces cleanup`563: it drives seven separate stalled stages, typed timeout/configured deadline and late-acquisition cleanup. Keep `build lock preserves stale and replacement ownership`983: the exact externally replaced lock bytes and AggregateError order1005-1018 protect ownership and error preservation. Keep `stable artifact reads detect deletion and replacement races after bytes are read`538: it probes a distinct read/validation race, not the write-lock race.

Improve `nth publication failure restores the exact prior bundle and leaves no temporary files`932: despite the title, only the fourth publication is forced to fail963. Parameterize failures1-4, existing vs initially absent outputs, and a rollback-write failure; preserve exact previous bytes/modes, cleanup and both primary/rollback errors. Existing fourth-write case provides strong protection and is retained.

Integration gap, decision blocked pending authorized execution/environment: production `loadPlaywrightChromium`590-603 and CLI main1090 are uncovered in supplied native evidence. Mock exporters/stored artifact copying in849-873 establish orchestration, not successful actual Playwright/Pandoc export of current content. Add a separately scoped local disposable artifact integration run with actual engines, validating produced structure/content/hash/coherent manifest. This audit authorizes neither execution nor exports; do not advertise exporter success from mocks or remove deterministic timeout cases because an integration check is unavailable.

### tests/integration/mobile-nav-and-accordion.spec.mjs — retain and improve; execution outcome blocked

Retain mobile navigation147/182/201 and desktop224: mobile breakpoint skips are intended environment selection, and the two Escape cases protect different focus origins. Retain all mocked SW lifecycle cases240/270/299/325/384: ready-state registration, fallback token, first installation, postMessage failure/retry and cross-tab race each have distinct call/message/navigation oracles. The harness is appropriate deterministic client testing; it does not establish real SW activation or browser/device portability.

Retain palette focus432/463, selection481 and empty-state505; portfolio content526/534/542; accordion expansion556, group exclusivity577 and corrupt marker/reinitialization600; reading selected-state652 and search privacy674. No obsolete behavior or equivalent replacement was established for any of these21 cases.

Improve `typing a search does not persist free-form text into the URL`674. It fills arbitrary text677, sleeps250ms678 and only asserts no `q`680. Disconnecting the input listener would pass, as would a different URL parameter carrying the query. Source988-995 promises filtering plus a120ms debounced update;896-927 excludes query from ordinary address changes, while1008-1011 deliberately includes query for explicit sharing. Assert observable result/empty-state update; exact allowed year/tag/view URL and absence of query text across URL/history writes; removal of inbound q; filter/view changes after typing; explicit Share includes sanitized query in mocked native/clipboard payload. Synchronize debounce with a browser clock or witnessed history operation plus a bounded settle interval, not a fixed sleep alone. Cost medium, no external sharing necessary.

Improve `filter buttons expose selected state to assistive technology`652: currently it verifies ARIA transitions, not visible book subset/count, URL persistence or combined year/tag/view constraints. Retain ARIA oracle and add independently computed fixture counts/identities.

Add browser cases for native-share success, AbortError cancellation (no clipboard), non-AbortError clipboard fallback, clipboard failure/manual feedback and bounded allowed telemetry properties. Source1008-1046 contains these distinct current contracts; selected browser scope has no Share click. Avoid asserting real third-party sharing. Theme/storage/reduced-motion and js/site pointer behavior are also absent from these candidate cases; runtime instrumentation would further measure these omissions.

## Removal and stopping gate

**Remove: none.** Passing, high/low coverage, superficial overlap and textual assertions do not establish obsolescence. Existing cases retain unique security, resource, platform, accessibility, concurrency or generated-artifact contracts. Independent replacement execution and defect probes are unavailable because this reviewer is audit-only; uncertainty is retain/blocked. Any future deletion requires fresh complete source/test/config/lock/report/environment provenance and a retained equivalent case inventory under the skill's deletion gates.

This was a bounded independent candidate review, not a second full repository audit. Browser-result classification must be updated by the owner when the raw report arrives; no numeric coverage, browser success, mutation score, real exporter success, CI or production claim is made here.


Evidence SHA-256 inventory: /Users/leonardwongly/Developer/ProjectPortfolio/artifacts/test-quality-audit-2026-10-04/evidence-hashes.json. Report body SHA-256 is stored separately in report.sha256; hashes identify bytes, while before/after provenance establishes freshness.
