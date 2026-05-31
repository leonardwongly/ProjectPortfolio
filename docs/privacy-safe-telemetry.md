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
