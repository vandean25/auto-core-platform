#!/usr/bin/env bash
# NOT PRODUCTIZED (AUT-154/AUT-171). Do not run against production.
# Status: docs/internal/05-Runbooks/single-tenant-restore-playbook.md
# Deferral: docs/internal/.architecture/deferrals.md
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <primary_database_url> <tenant_id> <tenant_dump_sql>"
  exit 1
fi

PRIMARY_DATABASE_URL="$1"
TENANT_ID="$2"
DUMP_FILE="$3"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/restore-common.sh"
tenant_restore_validate_target "${PRIMARY_DATABASE_URL}" "${TENANT_ID}"

if [[ "${DRY_RUN:-1}" == "1" ]]; then
  echo "[tenant-restore] Would verify schema, purge tenant ${TENANT_ID}, and import ${DUMP_FILE}"
  exit 0
fi

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "Dump file not found: ${DUMP_FILE}"
  exit 1
fi

node "${SCRIPT_DIR}/verify-dump.mjs" "${DUMP_FILE}" "${TENANT_ID}"

echo "[tenant-restore] Verifying primary schema against generated restore manifest"
psql "${PRIMARY_DATABASE_URL}" \
  -X \
  -v ON_ERROR_STOP=1 \
  -v target_tenant_id="${TENANT_ID}" \
  -f "${SCRIPT_DIR}/verify-tenant-schema.sql" >/dev/null

COMBINED_SQL="$(mktemp "${TMPDIR:-/tmp}/tenant-restore.XXXXXX.sql")"
trap 'rm -f "${COMBINED_SQL}"' EXIT
{
  cat "${SCRIPT_DIR}/purge-tenant-data.sql"
  cat "${DUMP_FILE}"
  printf '\nCOMMIT;\n'
} > "${COMBINED_SQL}"

echo "[tenant-restore] Purging and importing tenant ${TENANT_ID} in one transaction"
psql "${PRIMARY_DATABASE_URL}" \
  -X \
  -v ON_ERROR_STOP=1 \
  -v target_tenant_id="${TENANT_ID}" \
  -v tenant_restore_in_transaction=1 \
  -f "${COMBINED_SQL}"

echo "[tenant-restore] Restore complete for tenant ${TENANT_ID}"
