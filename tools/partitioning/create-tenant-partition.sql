\set ON_ERROR_STOP on

-- NOT ROLLED OUT (AUT-154 / AUT-74). Production tables are not partitioned.
-- Status: docs/internal/05-Runbooks/postgres-tenant-partitioning-rollout.md
--
-- Usage (after partitioning ships):
--   psql "$DATABASE_URL" -v table_name='inventory_transactions' -v tenant_id='<tenant-id>' -f tools/partitioning/create-tenant-partition.sql

DO $$
DECLARE
  source_table TEXT := :'table_name';
  tenant_value TEXT := :'tenant_id';
  partition_suffix TEXT;
  partition_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_partitioned_table p
    JOIN pg_class c ON c.oid = p.partrelid
    WHERE c.relname = source_table
  ) THEN
    RAISE EXCEPTION 'Table % is not partitioned', source_table;
  END IF;

  partition_suffix := replace(replace(lower(tenant_value), '-', '_'), ' ', '_');
  partition_name := format('%s_tenant_%s', source_table, partition_suffix);

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES IN (%L)',
    partition_name,
    source_table,
    tenant_value
  );

  RAISE NOTICE 'Ensured partition % for tenant %', partition_name, tenant_value;
END
$$;
