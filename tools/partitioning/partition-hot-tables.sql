\set ON_ERROR_STOP on

-- WARNING:
-- Execute in staging first. This script performs table renames and data copy.
-- It keeps *_legacy tables for rollback validation.

BEGIN;

-- ---------------------------------------------------------------------------
-- inventory_transactions partitioning by tenant_id
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_partitioned_table p
    JOIN pg_class c ON c.oid = p.partrelid
    WHERE c.relname = 'inventory_transactions'
  ) THEN
    RAISE NOTICE 'inventory_transactions is already partitioned. Skipping.';
  ELSE
    ALTER TABLE inventory_transactions RENAME TO inventory_transactions_legacy;

    CREATE TABLE inventory_transactions (
      LIKE inventory_transactions_legacy INCLUDING DEFAULTS INCLUDING STORAGE INCLUDING COMMENTS INCLUDING GENERATED
    ) PARTITION BY LIST (tenant_id);

    ALTER TABLE inventory_transactions
      ADD CONSTRAINT inventory_transactions_pkey PRIMARY KEY (tenant_id, id);

    ALTER TABLE inventory_transactions
      ADD CONSTRAINT inventory_transactions_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

    ALTER TABLE inventory_transactions
      ADD CONSTRAINT inventory_transactions_item_id_fkey
      FOREIGN KEY (item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT ON UPDATE CASCADE;

    ALTER TABLE inventory_transactions
      ADD CONSTRAINT inventory_transactions_location_id_fkey
      FOREIGN KEY (location_id) REFERENCES storage_locations(id) ON DELETE RESTRICT ON UPDATE CASCADE;

    CREATE TABLE inventory_transactions_default
      PARTITION OF inventory_transactions DEFAULT;

    INSERT INTO inventory_transactions
    SELECT * FROM inventory_transactions_legacy;

    CREATE INDEX inventory_transactions_tenant_id_idx ON inventory_transactions (tenant_id);
    CREATE INDEX inventory_transactions_item_id_location_id_idx ON inventory_transactions (item_id, location_id);
    CREATE INDEX inventory_transactions_type_idx ON inventory_transactions (type);
    CREATE INDEX inventory_transactions_createdat_idx ON inventory_transactions ("createdAt");
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- invoice_items partitioning by tenant_id
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_partitioned_table p
    JOIN pg_class c ON c.oid = p.partrelid
    WHERE c.relname = 'invoice_items'
  ) THEN
    RAISE NOTICE 'invoice_items is already partitioned. Skipping.';
  ELSE
    ALTER TABLE invoice_items RENAME TO invoice_items_legacy;

    CREATE TABLE invoice_items (
      LIKE invoice_items_legacy INCLUDING DEFAULTS INCLUDING STORAGE INCLUDING COMMENTS INCLUDING GENERATED
    ) PARTITION BY LIST (tenant_id);

    ALTER TABLE invoice_items
      ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (tenant_id, id);

    ALTER TABLE invoice_items
      ADD CONSTRAINT invoice_items_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

    ALTER TABLE invoice_items
      ADD CONSTRAINT invoice_items_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE invoice_items
      ADD CONSTRAINT invoice_items_catalog_item_id_fkey
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL ON UPDATE CASCADE;

    CREATE TABLE invoice_items_default
      PARTITION OF invoice_items DEFAULT;

    INSERT INTO invoice_items
    SELECT * FROM invoice_items_legacy;

    CREATE INDEX invoice_items_tenant_id_idx ON invoice_items (tenant_id);
    CREATE INDEX invoice_items_catalog_item_id_idx ON invoice_items (catalog_item_id);
  END IF;
END
$$;

COMMIT;

-- Post-check guidance:
-- 1) Validate row counts vs *_legacy tables.
-- 2) Run tools/partitioning/verify-partition-pruning.sql.
-- 3) Keep *_legacy tables until rollback window closes.
