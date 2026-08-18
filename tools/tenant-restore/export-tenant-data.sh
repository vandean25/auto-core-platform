#!/usr/bin/env bash
# NOT PRODUCTIZED (AUT-154). Do not run against production.
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

echo "[tenant-restore] Applying tenant RLS policies on clone for tenant ${TENANT_ID}"
psql "${CLONE_DATABASE_URL}" \
  -v target_tenant_id="${TENANT_ID}" \
  -f "${SCRIPT_DIR}/apply-tenant-rls.sql"

# Use a dedicated extractor connection string if available.
EXTRACT_DATABASE_URL="${TENANT_EXTRACTOR_DATABASE_URL:-${CLONE_DATABASE_URL}}"

echo "[tenant-restore] Exporting tenant-scoped data to ${OUTPUT_FILE}"
pg_dump "${EXTRACT_DATABASE_URL}" \
  --data-only \
  --inserts \
  --column-inserts \
  --no-owner \
  --no-privileges \
  --enable-row-security \
  --file "${OUTPUT_FILE}"

echo "[tenant-restore] Export complete: ${OUTPUT_FILE}"
