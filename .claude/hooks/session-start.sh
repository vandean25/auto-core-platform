#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: installs dependencies,
# generates the Prisma client, starts a local Postgres and exports dev-only
# defaults for the variables core-api needs at boot.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# --- Dependencies (npm install, not ci, so the cached container state is reused)
npm install --no-audit --no-fund
npm exec --workspace=core-api -- prisma generate

# --- Local Postgres (skipped when DATABASE_URL already points somewhere else)
DB_NAME="auto_core"
LOCAL_DB_URL="postgresql://postgres:postgres@localhost:5432/${DB_NAME}?schema=public"

if [ -z "${DATABASE_URL:-}" ] && command -v pg_lsclusters >/dev/null 2>&1; then
  if ! pg_isready -q -h localhost -p 5432; then
    cluster="$(pg_lsclusters --no-header | awk 'NR==1 {print $1" "$2}')"
    if [ -n "$cluster" ]; then
      # shellcheck disable=SC2086
      pg_ctlcluster $cluster start || true
      for _ in $(seq 1 20); do
        pg_isready -q -h localhost -p 5432 && break
        sleep 1
      done
    fi
  fi

  if pg_isready -q -h localhost -p 5432; then
    su postgres -c "psql -qtAc \"ALTER USER postgres PASSWORD 'postgres'\"" >/dev/null
    if ! su postgres -c "psql -qtAc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\"" | grep -q 1; then
      su postgres -c "createdb ${DB_NAME}"
    fi
    DATABASE_URL="$LOCAL_DB_URL"
  fi
fi

# --- Dev-only env defaults, persisted for the session. Anything already set
# in the environment settings wins, so real values never get overridden.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    [ -n "${DATABASE_URL:-}" ] && echo "export DATABASE_URL='${DATABASE_URL}'"
    echo "export SECRET_ENCRYPTION_KEY='${SECRET_ENCRYPTION_KEY:-$(openssl rand -base64 32)}'"
    echo "export CATALOG_HIT_HMAC_SECRET='${CATALOG_HIT_HMAC_SECRET:-$(openssl rand -hex 32)}'"
    echo "export FIREBASE_PROJECT_ID='${FIREBASE_PROJECT_ID:-auto-core-platform}'"
  } >> "$CLAUDE_ENV_FILE"
fi
