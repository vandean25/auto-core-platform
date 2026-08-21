#!/usr/bin/env bash
# NOT PRODUCTIZED (AUT-154/AUT-171). Do not run against production.
# Status: docs/internal/05-Runbooks/single-tenant-restore-playbook.md
# Deferral: docs/internal/.architecture/deferrals.md
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <clone_database_url> <tenant_id> <output_sql_file>"
  exit 1
fi

CLONE_DATABASE_URL="$1"
TENANT_ID="$2"
OUTPUT_FILE="$3"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/restore-common.sh"
tenant_restore_validate_target "${CLONE_DATABASE_URL}" "${TENANT_ID}"

if [[ "${DRY_RUN:-1}" == "1" ]]; then
  echo "[tenant-restore] Would verify the live schema and export tenant ${TENANT_ID} to ${OUTPUT_FILE}"
  exit 0
fi

echo "[tenant-restore] Verifying clone schema against generated restore manifest"
psql "${CLONE_DATABASE_URL}" \
  -X \
  -v ON_ERROR_STOP=1 \
  -v target_tenant_id="${TENANT_ID}" \
  -f "${SCRIPT_DIR}/verify-tenant-schema.sql" >/dev/null

echo "[tenant-restore] Exporting tenant-scoped data to ${OUTPUT_FILE}"
node "${SCRIPT_DIR}/export-tenant-data.mjs" \
  "${CLONE_DATABASE_URL}" \
  "${TENANT_ID}" \
  "${OUTPUT_FILE}"

echo "[tenant-restore] Export complete: ${OUTPUT_FILE}"
