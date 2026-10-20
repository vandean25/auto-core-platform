#!/usr/bin/env bash
# Print only the Repowise health gate result block from the CI log.
# Read-only: it queries GitHub Actions via gh and changes nothing.
#
# Usage: scripts/ci-repowise-gate-line.sh <pr-number|commit-sha>
# The CI run must be finished; wait once with `gh run watch <run-id>` first.
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: $0 <pr-number|commit-sha>" >&2
  exit 2
fi

ref="$1"
if [[ "$ref" =~ ^[0-9]+$ ]]; then
  sha="$(gh pr view "$ref" --json headRefOid -q .headRefOid)"
else
  sha="$ref"
fi

rid="$(gh run list --commit "$sha" --workflow 'PR Build Check' --json databaseId -q '.[0].databaseId')"
if [[ -z "$rid" ]]; then
  echo "no 'PR Build Check' run found for $sha" >&2
  exit 1
fi

echo "commit $sha, run $rid"
block="$(gh run view "$rid" --log \
  | awk -F'\t' '$1=="Repowise Health Gate"{print $3}' \
  | cut -c30- \
  | awk '/health gate (passed|FAILED)|no changed source files/{p=1}
         p && /Post job cleanup|##\[(group|endgroup|error)\]|^Process completed/{exit}
         p{print; if (++n >= 40) exit}' || true)"

if [[ -z "$block" ]]; then
  echo "no Repowise gate result line in the log of run $rid (still running, or the job did not reach the gate step)" >&2
  exit 1
fi
printf '%s\n' "$block"
