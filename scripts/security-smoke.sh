#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo "[security-smoke] Validating JSON payloads..."
for json_file in data/*.json; do
  jq empty "${json_file}" >/dev/null
done

echo "[security-smoke] Checking build script syntax..."
node --check scripts/build.js

echo "[security-smoke] Regenerating static pages..."
node scripts/build.js >/dev/null

echo "[security-smoke] Ensuring all GitHub Actions are SHA-pinned..."
if rg -n -P "uses:\\s*[^@\\s]+@(?![0-9a-f]{40}\\b)" .github/workflows/*.yml; then
  echo "[security-smoke] Found unpinned action reference(s)." >&2
  exit 1
fi

echo "[security-smoke] Verifying target=_blank rel protections..."
if rg -n -P 'target="_blank"(?![^\\n]*rel="[^"]*noopener[^"]*noreferrer)(?![^\\n]*rel="[^"]*noreferrer[^"]*noopener)' src/*.html partials/*.html index.html reading.html offline.html; then
  echo "[security-smoke] Found target=_blank link without noopener+noreferrer." >&2
  exit 1
fi

echo "[security-smoke] Checking generated pages for dangerous URL schemes..."
if rg -n -i 'href="(javascript:|data:|vbscript:)|src="(javascript:|data:text|vbscript:)' index.html reading.html offline.html; then
  echo "[security-smoke] Found dangerous URL scheme in generated HTML." >&2
  exit 1
fi

echo "[security-smoke] Verifying CSP is declared before script tags in source templates..."
node - <<'NODE'
const fs = require('fs');

const files = ['src/index.html', 'src/reading.html', 'src/offline.html'];

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const cspLine = lines.findIndex((line) => line.includes('Content-Security-Policy'));
  const scriptLine = lines.findIndex((line) => line.includes('<script'));
  if (cspLine === -1) {
    throw new Error(`Missing CSP in ${file}`);
  }
  if (scriptLine >= 0 && cspLine > scriptLine) {
    throw new Error(`CSP appears after script tags in ${file}`);
  }
}
NODE

echo "[security-smoke] Verifying strict style-src policy in source templates..."
if rg -n "style-src[^\\\"]*'unsafe-inline'" src/*.html; then
  echo "[security-smoke] Found forbidden style-src 'unsafe-inline' in source templates." >&2
  exit 1
fi

echo "[security-smoke] Verifying _headers contains required runtime security headers..."
if ! rg -n "Content-Security-Policy:" _headers >/dev/null; then
  echo "[security-smoke] Missing CSP response header in _headers." >&2
  exit 1
fi
if ! rg -n "Permissions-Policy:" _headers >/dev/null; then
  echo "[security-smoke] Missing Permissions-Policy in _headers." >&2
  exit 1
fi
if ! rg -n "X-Frame-Options:\\s*DENY" _headers >/dev/null; then
  echo "[security-smoke] Missing X-Frame-Options: DENY in _headers." >&2
  exit 1
fi

echo "[security-smoke] Checking generated HTML for inline style attributes..."
if rg -n "\\sstyle\\s*=" index.html reading.html offline.html; then
  echo "[security-smoke] Found inline style attribute in generated HTML." >&2
  exit 1
fi

echo "[security-smoke] Checking workflow permission baseline..."
if ! rg -n "contents: 'read'" .github/workflows/gemini-cli.yml >/dev/null; then
  echo "[security-smoke] gemini-cli workflow should default to contents: read." >&2
  exit 1
fi

echo "[security-smoke] All checks passed."
