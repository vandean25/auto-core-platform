#!/usr/bin/env bash
set -euo pipefail

if npm run test:e2e --workspace=core-web -- --shard="$1/$2"; then
  exit 0
fi

mkdir -p apps/core-web/first-attempt
for path in playwright-report test-results; do
  if [ -e "apps/core-web/$path" ]; then
    mv "apps/core-web/$path" apps/core-web/first-attempt/
  fi
done

echo "::warning::UI smoke shard $1/$2 failed on the first attempt; retrying."
echo "UI smoke shard $1/$2 required a retry. First-attempt artifacts are in the Playwright report." >> "$GITHUB_STEP_SUMMARY"
sleep 20
npm run test:e2e --workspace=core-web -- --shard="$1/$2"
