# Web Bot Auth

The site publishes its HTTP Message Signatures verification key as a JWKS at
`https://leonardwong.tech/.well-known/http-message-signatures-directory`.
The directory currently exposes the Ed25519 key with key ID
`leonardwong.tech`. The public JWK is safe to publish; the corresponding
private JWK must remain in the bot or agent's secret store.

Outbound bot and agent processes can use `scripts/web-bot-auth.mjs` to produce
the HTTP Message Signature headers required by Web Bot Auth:

```js
import { signWebBotAuthRequest } from './scripts/web-bot-auth.mjs';

const body = JSON.stringify({ message: 'hello' });
const headers = signWebBotAuthRequest({
  url: 'https://receiver.example/endpoint',
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
  privateJwk: process.env.WEB_BOT_AUTH_PRIVATE_JWK
});

await fetch('https://receiver.example/endpoint', {
  method: 'POST',
  headers,
  body
});
```

The helper emits `Signature-Agent`, `Signature-Input`, and `Signature`
headers. It signs the request method, target URI, signature-agent value, and,
when a body is supplied, a SHA-256 `Content-Digest` using Ed25519. Keep
`WEB_BOT_AUTH_PRIVATE_JWK` configured only in the outbound agent runtime; it is
intentionally not stored in this static-site repository. Signatures are limited
to a five-minute freshness window and include an `expires` parameter; receivers
must enforce both `created` and `expires` to prevent replay.
