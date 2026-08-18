\set ON_ERROR_STOP on

-- NOT ROLLED OUT (AUT-154 / AUT-74). Production tables are not partitioned.
-- Status: docs/internal/05-Runbooks/postgres-tenant-partitioning-rollout.md
--
-- Usage (after partitioning ships):
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
