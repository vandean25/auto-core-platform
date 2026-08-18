#!/usr/bin/env bash
# NOT PRODUCTIZED (AUT-154). Do not run against production.
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

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "Dump file not found: ${DUMP_FILE}"
  exit 1
fi

echo "[tenant-restore] Purging existing tenant rows for ${TENANT_ID}"
psql "${PRIMARY_DATABASE_URL}" \
  -v target_tenant_id="${TENANT_ID}" \
  -f "${SCRIPT_DIR}/purge-tenant-data.sql"

echo "[tenant-restore] Importing tenant dump ${DUMP_FILE}"
psql "${PRIMARY_DATABASE_URL}" -f "${DUMP_FILE}"

echo "[tenant-restore] Verifying tenant row counts"
psql "${PRIMARY_DATABASE_URL}" -c "
SELECT table_name, count(*)
FROM (
  SELECT 'catalog_items'::text AS table_name, count(*)::bigint AS count FROM catalog_items WHERE tenant_id='${TENANT_ID}'
  UNION ALL
  SELECT 'inventory_transactions', count(*)::bigint FROM inventory_transactions WHERE tenant_id='${TENANT_ID}'
  UNION ALL
  SELECT 'invoices', count(*)::bigint FROM invoices WHERE tenant_id='${TENANT_ID}'
  UNION ALL
  SELECT 'invoice_items', count(*)::bigint FROM invoice_items WHERE tenant_id='${TENANT_ID}'
) t
ORDER BY table_name;
"

echo "[tenant-restore] Restore complete for tenant ${TENANT_ID}"
