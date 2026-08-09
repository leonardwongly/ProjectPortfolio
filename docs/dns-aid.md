# DNS for AI Discovery (DNS-AID)

The portfolio publishes an A2A Agent Card at
`https://leonardwong.tech/.well-known/agent-card.json`. DNS-AID records make
that HTTPS endpoint discoverable before an agent fetches the card.

## Authoritative records

[`/dns-aid.zone`](../dns-aid.zone) is the provider-neutral source for the two
records:

```dns
_index._agents.leonardwong.tech. 3600 IN SVCB 1 leonardwong.tech. alpn="h2,http/1.1" port=443 mandatory=alpn,port
_a2a._agents.leonardwong.tech.   3600 IN HTTPS 1 leonardwong.tech. alpn="h2,http/1.1" port=443 mandatory=alpn,port
```

`alpn` and `port` are explicit connection parameters. No experimental SvcParam
keys are currently needed; if a future DNS-AID extension adds one before IANA
registration, write it as a numeric `keyNNNNN` key rather than an unregistered
text name.

## Cloudflare publication checklist

1. Add the records from `dns-aid.zone` to the authoritative
   `leonardwong.tech` zone. Keep proxying disabled for the DNS records; SVCB and
   HTTPS answers must be returned by the authoritative DNS service.
2. Enable DNSSEC for the zone and publish the resulting DS record at the
   registrar. Cloudflare (or the authoritative provider) must generate the
   RRSIG/NSEC records; do not add hand-written signatures to the repository.
3. After propagation, run the DoH check:

   ```bash
   npm run check:dns-aid
   ```

   The checker queries Cloudflare DoH first and falls back to Google DoH only
   for resolver-level failures. Override the resolver for an independent check:

   ```bash
   DNS_AID_DOH_RESOLVER_URL=https://dns.google/resolve npm run check:dns-aid
   ```

   The override is restricted to the pinned public Cloudflare and Google DoH
   hosts, and requests reject redirects. `DNS_AID_TIMEOUT_MS` is bounded to
   1–30 seconds.

4. Validate the deployed site with the DNS-AID scanner:

   ```http
   POST https://isitagentready.com/api/scan
   Content-Type: application/json

   {"url":"https://leonardwong.tech"}
   ```

   The result is complete when `checks.discoverability.dnsAid.status` is
   `"pass"` and the DoH response has authenticated data (`AD: true`).
