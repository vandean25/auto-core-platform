#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/.cursor/scripts/cloud-agent-export-env.sh"

if ! pg_lsclusters 2>/dev/null | awk '{print $1}' | grep -qx 17; then
  sudo pg_createcluster 17 main -- --data-checksums
fi

if ! pg_isready -q -p 5432; then
  sudo pg_ctlcluster 17 main start
fi

PG_PORT="$(pg_lsclusters 2>/dev/null | awk '$1 == "17" && $2 == "main" { print $3; exit }')"
if [[ -z "${PG_PORT}" || "${PG_PORT}" != "5432" ]]; then
  echo "postgresql 17/main must listen on port 5432 (found: ${PG_PORT:-none}). Remove other Postgres clusters from the image." >&2
  exit 1
fi

for _ in $(seq 1 60); do
  if pg_isready -q -p 5432; then
    break
  fi
  sleep 1
done

if ! pg_isready -q -p 5432; then
  echo "postgres 17 did not become ready on port 5432" >&2
  exit 1
fi

bash "${ROOT}/.cursor/scripts/cloud-agent-postgres-setup.sh"
