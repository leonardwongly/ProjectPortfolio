# Privacy-Safe Telemetry

This portfolio does not enable third-party analytics, cookies, fingerprinting,
or an external event collector by default.

The runtime may emit a local `portfolio:track` browser event for high-level
interaction intent, and may keep aggregate event counts in `sessionStorage` for
manual QA during the current browser session. These signals are same-page only:
they are not sent over the network by the committed site.

## Allowed Events

- `portfolio_action_clicked`
- `reading_filter_changed`
- `reading_view_changed`
- `reading_share_clicked`
- `reading_share_completed`

## Allowed Properties

Only short, low-cardinality values are allowed:

- `surface`
- `action`
- `destination`
- `group`
- `value`
- `view`
- `has_query`
- `year_filter`
- `tag_filter`
- `method`

Do not collect names, email addresses, IP addresses, full URLs, query strings,
free-form search text, user agent strings, referrers, or persistent identifiers.

## Collector Approval

No `fetch`, `sendBeacon`, image beacon, third-party script, `gtag`, `dataLayer`,
or Plausible adapter should be committed unless a separate privacy and CSP review
approves the collector endpoint, retention policy, and exact event schema.

Run the telemetry policy check before enabling any measurement change:

```bash
npm run check:telemetry
```


## Runtime Review Boundary

The default repository check scans `js/main.js` and `js/site.js`, inventories
script references in the authored templates, seven generated HTML pages and
public service documentation, and rejects unclassified executable files under `js/` or the web root. New page
scripts and inline executable source require explicit inventory and policy
review. The homepage's inert JSON-LD is permitted; generated JSON-LD must parse
as JSON. Script inventory uses the shared HTML parser, including browser
attribute and raw-text rules; parse errors require review rather than trusting
browser recovery. Comments, text containers, and quoted attribute contents do
not introduce executable scripts.

The page scanner rejects DOM resource creation (`img`, `script`, `link`, and
other resource elements), resource URL assignments and `setAttribute` sinks,
HTML insertion, CSS resource setters, ordinary method aliases, and new
worker/import adapters. Existing text, ARIA, class, and same-page events remain
permitted. Dynamic tag or attribute names and indirect `.call`/`.apply` resource
method invocation require review rather than speculative interpretation.
Optional method calls and ordinary aliases separated by automatic semicolon
insertion receive the same checks as their explicit forms.

A dynamic `trackEvent` name is permitted only when a single top-level function
starts with the supported rejecting allowlist guard. Nested or dead guards,
guards after earlier statements, and duplicate definitions do not establish
protection. This is a narrow source contract, not general JavaScript
control-flow analysis. A static event argument must be one complete string
literal; composed arguments require the guard. Assigning a replacement to
`trackEvent` invalidates that contract and fails the policy check.

`pwabuilder-sw.js` is reviewed separately because navigation fetches, offline
HTML/CSS caching, and same-origin client messages are intentional. Its exact
SHA-256 is pinned in `scripts/check-telemetry-policy.mjs`; changes fail the
inventory gate until their network, cache, message, and import behavior is
reviewed and the pin is updated. Vendored Workbox source remains governed by
its manifest and byte hashes rather than the page network-API ban.

These checks cover committed, classified runtime sources. They are bounded
regression guards, not proof of an exhaustive absence of telemetry or a
sandbox for malicious JavaScript. They do not attest to provider-injected
scripts, hosting settings, browser extensions, or production behavior. Small
test fixtures can explicitly opt into the complete repository inventory with
`enforceRuntimeInventory: true`; the CLI always uses it for this repository.
Structural test fixtures may inject `today` to isolate inventory checks from
review freshness. The CLI continues to validate freshness using the current
UTC date by default.
