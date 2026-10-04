#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

# rg returns 1 only when the search completed without a match.
# A search error must fail validation rather than look like a clean result.
assert_no_matches() {
  local finding_message="$1"
  shift
  local status=0
  rg "$@" || status=$?
  case "$status" in
    0)
      echo "$finding_message" >&2
      return 1
      ;;
    1)
      return 0
      ;;
    *)
      echo "[security-smoke] Search failed (rg exit $status); validation is incomplete." >&2
      return "$status"
      ;;
  esac
}

echo "[security-smoke] Validating JSON payloads..."
for json_file in data/*.json; do
  jq empty "${json_file}" >/dev/null
done

echo "[security-smoke] Checking build script syntax..."
node --check scripts/build.js

echo "[security-smoke] Validating vendored dependency governance..."
node scripts/check-vendor-governance.mjs

echo "[security-smoke] Regenerating static pages..."
node scripts/build.js >/dev/null

echo "[security-smoke] Ensuring all GitHub Actions are SHA-pinned..."
assert_no_matches "[security-smoke] Found unpinned action reference(s)." \
  -n -P "uses:\\s*[^@\\s]+@(?![0-9a-f]{40}\\b)" .github/workflows/*.yml

echo "[security-smoke] Verifying target=_blank rel protections..."
assert_no_matches "[security-smoke] Found target=_blank link without noopener+noreferrer." \
  -n -P 'target="_blank"(?![^\\n]*rel="[^"]*noopener[^"]*noreferrer)(?![^\\n]*rel="[^"]*noreferrer[^"]*noopener)' src/*.html partials/*.html index.html reading.html offline.html

echo "[security-smoke] Checking generated pages for dangerous URL schemes..."
assert_no_matches "[security-smoke] Found dangerous URL scheme in generated HTML." \
  -n -i 'href="(javascript:|data:|vbscript:)|src="(javascript:|data:text|vbscript:)' index.html reading.html offline.html

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
assert_no_matches "[security-smoke] Found forbidden style-src 'unsafe-inline' in source templates." \
  -n "style-src[^\\\"]*'unsafe-inline'" src/*.html

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
assert_no_matches "[security-smoke] Found inline style attribute in generated HTML." \
  -n "\\sstyle\\s*=" index.html reading.html offline.html

echo "[security-smoke] Checking workflow permission baseline..."
if ! rg -n "contents: 'read'" .github/workflows/gemini-cli.yml >/dev/null; then
  echo "[security-smoke] gemini-cli workflow should default to contents: read." >&2
  exit 1
fi

echo "[security-smoke] All checks passed."
