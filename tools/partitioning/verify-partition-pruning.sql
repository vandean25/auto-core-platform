\set ON_ERROR_STOP on

-- Usage:
--   psql "$DATABASE_URL" -v tenant_id='<tenant-id>' -f tools/partitioning/verify-partition-pruning.sql

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, "createdAt"
FROM inventory_transactions
WHERE tenant_id = :'tenant_id'
ORDER BY "createdAt" DESC
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, invoice_id, "createdAt"
FROM invoice_items
WHERE tenant_id = :'tenant_id'
ORDER BY "createdAt" DESC
LIMIT 50;

-- Expectation:
-- Execution plan should show partition pruning (only tenant partition + default if applicable).
