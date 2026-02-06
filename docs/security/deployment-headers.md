# Deployment Header Requirements

This document defines the expected security headers for production responses served from `https://leonardwong.tech`.

## Required Response Headers

### 1) Strict-Transport-Security

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

- Enforces HTTPS for repeat visits.
- Apply only after HTTPS is stable on all relevant subdomains.

### 2) Content-Security-Policy (Response Header)

Use a response header policy that mirrors the in-page policy and is enforced before any HTML parsing:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-mvCwwKuVDWE+Rkei4e1WUnj8mTLXU5m1Sn40vtcTSWw='; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests; block-all-mixed-content
```

For pages without inline scripts, the `script-src` directive can omit hash values and remain `script-src 'self'`.

### 3) Referrer-Policy

```
Referrer-Policy: strict-origin-when-cross-origin
```

### 4) X-Content-Type-Options

```
X-Content-Type-Options: nosniff
```

### 5) Permissions-Policy

Deny APIs not needed by this static site:

```
Permissions-Policy: accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()
```

### 6) Optional Legacy Header

This is redundant with CSP `frame-ancestors 'none'`, but can be added for older clients:

```
X-Frame-Options: DENY
```

## CORS Guidance

- Avoid sending `Access-Control-Allow-Origin: *` on HTML pages unless there is an explicit cross-origin embedding requirement.
- If CORS is required for static assets, scope it to those asset routes rather than all routes.

## Cloudflare/Edge Rollout Checklist

1. Add rules at edge for all HTML routes first.
2. Verify headers with:
   - `curl -sSI https://leonardwong.tech/`
   - `curl -sSI https://leonardwong.tech/reading`
   - `curl -sSI https://leonardwong.tech/offline`
3. Validate that service worker and PWA install flows still function.
4. Monitor CSP violations and tighten incrementally if new inline sources are removed.
