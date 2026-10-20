#!/usr/bin/env bash
# Claude Code SessionStart hook (cloud sessions only, see agents.md "Local checks before pushing").
# Installs npm deps when missing or stale and a Chromium that matches @playwright/test
# (plus its system libraries when running as root with apt).
# If the browser download fails, points Playwright at an existing Chromium via
# PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH (honored by apps/core-web/playwright*.config.ts).
# Idempotent and never fails the session: always exits 0. Logs go to stderr; the short
# summary on stdout becomes session context for Claude.

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

summary=()
log() { echo "[session-start] $*" >&2; }
warn() { echo "[session-start] WARN: $*" >&2; summary+=("WARN: $*"); }

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || { warn "cannot cd to project dir"; exit 0; }

# 1) npm ci only when node_modules is missing or older than package-lock.json.
if [ -f node_modules/.package-lock.json ] && [ ! package-lock.json -nt node_modules/.package-lock.json ]; then
  log "node_modules up to date, skipping npm ci"
else
  log "running npm ci"
  if npm ci --no-audit --no-fund >&2; then
    summary+=("npm ci: done")
  else
    warn "npm ci failed; run it manually"
  fi
fi

# 2) Chromium matching @playwright/test (a no-op when it is already installed).
pw_version=$(node -p "require('@playwright/test/package.json').version" 2>/dev/null || echo unknown)
# Skip browser GC so a failed install never deletes a preinstalled Chromium we could fall back to.
if PLAYWRIGHT_SKIP_BROWSER_GC=1 timeout 300 npm exec --workspace=core-web -- playwright install chromium >&2; then
  summary+=("Playwright ${pw_version}: chromium installed")
  # System libraries (= --with-deps) only when root + apt are available, once per VM.
  deps_marker="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}/.claude-deps-${pw_version}"
  if [ "$(id -u)" = "0" ] && command -v apt-get >/dev/null 2>&1 && [ ! -f "$deps_marker" ]; then
    if timeout 300 npm exec --workspace=core-web -- playwright install-deps chromium >&2; then
      touch "$deps_marker"
    else
      warn "playwright install-deps chromium failed; browser may miss system libraries"
    fi
  fi
else
  warn "playwright install chromium failed (network restricted?); looking for an existing Chromium"
  # 3) Fallback: newest Chromium from the ms-playwright cache, else a system Chromium.
  cache="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
  exe=$(printf '%s\n' "$cache"/chromium-*/chrome-linux*/chrome | sort -V | tail -n 1)
  [ -x "$exe" ] || exe=""
  if [ -z "$exe" ]; then
    for name in chromium chromium-browser google-chrome-stable google-chrome; do
      exe=$(command -v "$name" 2>/dev/null) && break
    done
  fi
  if [ -z "$exe" ] || [ ! -x "$exe" ]; then
    warn "no Chromium found; local Playwright runs will fail, rely on CI"
  elif [ -z "${CLAUDE_ENV_FILE:-}" ]; then
    warn "CLAUDE_ENV_FILE not set; export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$exe manually"
  else
    grep -qF "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='$exe'" "$CLAUDE_ENV_FILE" 2>/dev/null ||
      echo "export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='$exe'" >>"$CLAUDE_ENV_FILE"
    summary+=("Playwright ${pw_version}: using existing Chromium $exe via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
  fi
fi

printf 'Session setup: %s\n' "${summary[@]}"
printf 'Local checks policy: lint, typecheck/build, related unit tests and only new/changed e2e specs; full e2e suites run in CI only (agents.md).\n'
exit 0
