# auth.md

## Audience

This document describes authentication and agent registration for
`https://leonardwong.tech`. It is intended for autonomous agents, crawlers, and
other software that wants to read the public portfolio, project case studies,
or reading list.

## Resource access

The site is a public, read-only static resource. The HTML pages and published
assets do not require an account, bearer token, API key, or other credential.
Agents may use ordinary HTTPS `GET` requests and should respect the site's
`robots.txt`, cache headers, and published rate limits.

The public pages remain readable without credentials. For any future protected
agent integration, the service publishes OAuth Protected Resource Metadata at
[`/.well-known/oauth-protected-resource`](https://leonardwong.tech/.well-known/oauth-protected-resource).
That document identifies the resource, the configured Cloudflare Access
authorization server, the `openid` scope, and the `header` bearer method. The
matching authorization-server metadata is published at
[`/.well-known/oauth-authorization-server`](https://leonardwong.tech/.well-known/oauth-authorization-server)
and uses the same issuer advertised by the PRM.

## Registration and provisioning

Dynamic client registration is not enabled. If an agent needs access to a
non-public collaboration or integration, provisioning is handled manually by
the site owner after human review. Agents should use the authorization-server
metadata as the source of truth for any future OAuth flow and must not guess
endpoint paths:

- Registration/provisioning contact: [LinkedIn](https://linkedin.leonardwong.tech)
- Discovery reference: [this document](https://leonardwong.tech/auth.md#registration-and-provisioning)
- Supported method: `manual_review` (out-of-band coordination; no automated
  `POST` request and no credentials are issued by this static site)

Do not probe or submit `POST /agent/auth`. This static site does not expose
that endpoint, and registration requests must not be used as a passive
discovery technique.

## Agent authentication declaration

The following block is intentionally explicit so discovery tooling can
distinguish the supported manual path from OAuth or dynamic registration:

```yaml
agent_auth:
  skill: oauth-agent-registration
  register_uri: https://leonardwong.tech/auth.md#registration-and-provisioning
  methods:
    - type: manual_review
      name: Human-reviewed provisioning
      register_uri: https://linkedin.leonardwong.tech
      method: out_of_band
      content_type: text/plain
      credential_type: none
      credential_use: none
      automated: false
```

## Credential use

No credential is needed for the public site. Agents must not manufacture or
persist credentials for this resource. If a future protected integration is
enabled, use only the bearer token and issuer rules published by the PRM and
authorization-server metadata; do not send credentials to any undocumented
endpoint.
