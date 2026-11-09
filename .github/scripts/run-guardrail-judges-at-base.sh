#!/usr/bin/env bash
# Runs guardrail checker bundles from the merge-base revision so PRs cannot weaken judges at head.
set -euo pipefail

BASE=${1:?merge-base ref required}
ROOT=${GITHUB_WORKSPACE:-$PWD}
shift || true
REQUESTED_BUNDLES=("$@")

if ! git -C "$ROOT" cat-file -e "${BASE}:tools/guardrail-base-runner.mjs"; then
  exit 0
fi

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

SELF_FILES=(
  tools/guardrail-base-runner.mjs
  tools/parse-cli-options.mjs
  tools/guardrail-git-io.mjs
  tools/guardrail-repo-root.mjs
)

for path in "${SELF_FILES[@]}"; do
  mkdir -p "$tmpdir/$(dirname "$path")"
  git -C "$ROOT" show "${BASE}:${path}" >"$tmpdir/$path"
done

export GUARDRAIL_REPO_ROOT="$ROOT"

should_run_bundle() {
  local bundle=$1
  if [ "${#REQUESTED_BUNDLES[@]}" -eq 0 ]; then
    return 0
  fi
  for requested in "${REQUESTED_BUNDLES[@]}"; do
    if [ "$requested" = "$bundle" ]; then
      return 0
    fi
  done
  return 1
}

run_bundle() {
  local bundle=$1
  local entry=$2
  if ! should_run_bundle "$bundle"; then
    return 0
  fi
  if git -C "$ROOT" cat-file -e "${BASE}:${entry}"; then
    node "$tmpdir/tools/guardrail-base-runner.mjs" --base "$BASE" --bundle "$bundle" -- --base "$BASE"
  fi
}

run_bundle spec-quality tools/check-spec-quality.mjs
run_bundle interaction-baselines tools/check-interaction-baselines.mjs
run_bundle allowlist-growth tools/check-allowlist-growth.mjs
