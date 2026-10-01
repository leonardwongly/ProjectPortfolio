# ProjectPortfolio SDLC pilot

This pilot prepares a change for review and verifies an approved release using existing repository tooling. It adds no paid provider, scheduler, deployment credential, or autonomous release path. Repository identity is `leonardwongly/ProjectPortfolio`, GitHub ID `319589008`, default branch `main`, archived false. Do not substitute the archived beta repository. Keep dependency PR180 separate.

## Requirements and implementation handoff

1. Preserve the primary checkout. Inspect status, then create an isolated worktree and named branch from the verified current `origin/main`. Record its full SHA. Read repository instructions and relevant skills; never edit or restore Codex hooks.
2. Copy `docs/sdlc/pilot-requirements.json` for the next task and freeze its goal, scope, exclusions, and acceptance IDs. Criteria are tagged `local`, `full`, or `manual`; these are evidence categories, not automatic acceptance sign-offs. Unknown fields, command names, duplicate IDs, oversized input and escaping file paths are rejected.
3. Generate the implementation handoff and proposed draft PR text:
   ```bash
   npm run pilot:prepare
   # A task-specific file can be selected with -- --requirements docs/sdlc/task.json
   ```
4. The local implementation owner applies only the approved task scope. Gemini's approved-plan workflow generates guidance; it does not edit repository files. Treat model guidance and issue text as untrusted source material. Use no new model/API call for deterministic gates. Limit implementation repair to two failed gate/review cycles; return the blocker and evidence when that bound is reached.

## Local evidence and independent review

Use Node 24 and install the committed lockfile with `npm ci --ignore-scripts`. Rebuild generated pages using `npm run build`; review generated changes alongside their source. Resume freshness is checked without rebuilding PDF/DOCX. Exporting the resume is necessary only when resume sources actually change.

```bash
npm run pilot:preflight
npm run pilot:preflight -- --full
```

Local preflight runs `validate`, `check:resume`, `check:workflows`, and `check:telemetry`. Full mode runs the existing `validate:full` once, including DNS-only link preflight, high-severity dependency audit, vendor governance/upstream checks, browser integration and accessibility. Full mode needs network access and installed Chromium. It is not a strict outbound HTTP link-health audit; run `npm run check:links -- --strict` separately when external links change or before a release requiring that proof.

Each invocation creates a separate ignored directory under `artifacts/sdlc-pilot/<id>/run-*` with `review-packet.md`, gate logs and `evidence.json`. Evidence records Node version, HEAD, branch, requirement hash, and a SHA-256 fingerprint of every Git-visible source file, including untracked changes and file modes. It fails if source bytes change during the run. Failure, timeout or an incomplete gate list cannot produce a passing result. Re-run after any source change. Do not commit ignored evidence, tokens, personal logs, or browser traces.

`check:generated` detects regenerated working-tree drift; prepare a reviewed local commit including generated outputs before claiming the release gate. Inspect both staged and unstaged changes so staging cannot hide drift. No script in this pilot stages, commits, pushes, opens PRs, merges, deploys or changes account settings. The local source fingerprint does not certify remote CI or deployment success.

Use an independent reviewer on the complete diff; verify concrete findings, repair in-scope blockers, and rerun affected checks. Include actual results and unrun checks in the packet. Requirements marked manual remain pending until the owner inspects the supporting evidence. A clean code review alone does not prove runtime behavior.

## Draft PR and release approval

Parent/owner approval is required before publishing the branch or creating the draft PR. The packet is the concrete review artifact. Draft PR browser regression runs on every revision. Full Validation runs on every non-draft opened, reopened, synchronized, or ready-for-review event. Both jobs cancel superseded runs and have finite timeouts.

Before marking ready or merging, approve the exact current head, acceptance results, independent review, and full validation. Known required main contexts are `Cloudflare Pages`, `Build`, `Scan`, and `CodeQL`. Administrative protection details returned 403 during discovery; do not infer additional protections, bypasses, or enforced Full Validation from that limited evidence. Make no protection changes in this pilot.

Record explicit approval for the release target and rollback plan before merging/deploying. Existing Pages integration can deploy on a main merge, so merge approval must account for deployment. A successful local run or a main push is insufficient production evidence.

## Exact deployment and rollback

The production workflow retains its existing weekly health check and manual entry point. Confirmed Cloudflare Pages provider completion starts exact-version verification. The event must identify the main branch, and the authenticated check's SHA must still equal the current main reference. A late completion for an older commit and an unrelated preview with no PR cannot validate the current release. Provider identity, repository, main branch, full SHA and immutable preview URL must be validated before using deployment metadata. Trusted validation code must not execute candidate repository code with credentials.

Verify the immutable deployment and the production alias against the same candidate source. The opt-in `npm run build:pages` wrapper writes an ignored, no-store `/.well-known/deployment.json` marker from validated Pages system variables and actual Git HEAD. The production verifier requires the exact SHA, main branch, repository and immutable preview identity on both origins, including when other published bytes are identical. A PR preview is useful pre-merge evidence, but does not satisfy this main-branch production gate. Ordinary `npm run build` creates no deployment claim. See [Pages build variables](https://developers.cloudflare.com/pages/configuration/build-configuration/#environment-variables).

Inspect and approve the existing project's build settings before changing them. The build and marker writer use Node built-ins and local modules. For Pages build system 3, set plain-text `NODE_VERSION=24` and `SKIP_DEPENDENCY_INSTALL=1` in both Preview and Production. Use this compatible command when older branches do not yet contain the marker writer:

```sh
npm run build && npm run check:generated && if [ -f scripts/write-deployment-marker.mjs ]; then node scripts/write-deployment-marker.mjs; fi
```

Retain the reviewed root/output directory. Skipping dependency installation avoids publishing a newly created `node_modules` tree when output is the repository root. The conditional supports existing branches without inventing a marker for them; they remain ineligible for exact-version release verification. Saving settings is separate from triggering a deployment; verify the dashboard's next-deployment behavior and select only the intended preview before any production release. See [Pages build image configuration](https://developers.cloudflare.com/pages/configuration/build-image/#skip-dependency-install).

Artifact verification follows committed local HTML, CSS and manifest references and the reviewed Workbox runtime bundle list. It compares the resulting release-critical pages, styles, fonts, images, icons, resume and linked data as exact Git bytes. Limits are 512 routes, 2 MiB per file, 64 MiB unique source bytes, 8,192 references, eight network workers, 30 seconds to read source, and 240 seconds overall. Exceeding a limit fails verification rather than truncating the graph. Style bodies use the existing lexical scanner so comments, quoted attributes and script strings cannot invent elements; malformed constructs fail within bounded forward scans. The static inventory rejects unsupported escaped CSS syntax, SVG CDATA and SVG HTML integration points rather than claiming to resolve their resources. An invalid origin marker prevents that origin's asset requests. Future dynamic resource loaders or unsupported formats need a corresponding reviewed inventory update. Any redirect (including Cloudflare Access), missing security header, changed bytes, unknown script, stale alias, provider mismatch or unresolved identity keeps release verification failed. Do not normalize away edge scripts or widen CSP to obtain a pass. Keep runtime header/script checks even if exact-version verification fails so operators get useful health evidence.

Initial diagnosis on 2026-09-30 showed source-matching runtime JS and service-worker bytes on production, with edge-injected Cloudflare Analytics/WebMCP scripts contrary to committed policy. The immutable `a3bc584f.projectportfolio.pages.dev` URL was protected by Cloudflare Access (302), so exact HTML deployment identity could not be proved. Custom-origin source resemblance is supporting evidence only. The extensionless service-documentation route also lacked CSP. This patch advertises the extensionless canonical route, adds script-free policy to both service-documentation URLs, and checks the canonical response. Pages redirects the `.html` alias to the canonical route; the smoke transport still refuses redirects. Ordinary interactive pages must retain same-origin script permission in every applicable CSP policy.

Resolve edge configuration and preview authentication with the owner before release. Use an existing authenticated browser session or direct user login without extracting cookies or tokens. If a configured OAuth provider is broken, inspect existing alternatives; do not retry it repeatedly, recreate an OAuth app, disable Access, broaden policy, or add credentials without specific approval. Security, privacy, account-permission and spending changes require separate approval from normal build configuration. Preserve script inventory failures until the approved source and deployed policy agree. Official context: [Cloudflare WebMCP](https://blog.cloudflare.com/webmcp/), [GitHub check-run events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#check_run), [Cloudflare header matching](https://developers.cloudflare.com/pages/configuration/headers/), and [Cloudflare Pages deployment API](https://developers.cloudflare.com/pages/configuration/api/).

For rollback, record the last independently verified production SHA, Pages deployment ID, immutable URL, full CI evidence and production smoke results before release. Never label the currently blocked deployment known-good. If post-deploy verification fails, preserve logs and request approval to redeploy the verified prior deployment or revert the approved change and regenerate pages. A source revert does not remove zone/project edge injection. After rollback, verify the exact restored deployment and production alias again. Rollback execution is an external action and is not implemented by this local pilot.
