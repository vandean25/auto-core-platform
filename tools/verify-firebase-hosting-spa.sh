#!/usr/bin/env bash
# Verify Firebase Hosting SPA rewrite behaviour against a running hosting emulator.
# Usage: firebase emulators:start --only hosting --project auto-core-platform-vande
#        tools/verify-firebase-hosting-spa.sh [base-url]
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:5000}"

expect_status() {
  local path="$1"
  local want="$2"
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}${path}")"
  if [[ "$got" != "$want" ]]; then
    echo "FAIL ${path}: expected HTTP ${want}, got ${got}" >&2
    exit 1
  fi
  echo "OK   ${path} → ${got}"
}

expect_status '/assets/does-not-exist.js' '404'
expect_status '/missing.png' '404'
expect_status '/some/spa/route' '200'
expect_status '/dashboard/' '200'
expect_status '/customers/abc-123/' '200'

echo 'All hosting SPA checks passed.'
