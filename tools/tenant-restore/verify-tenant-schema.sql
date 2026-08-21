-- GENERATED FILE. Run node tools/tenant-restore/generate-tenant-restore-sql.mjs
-- The expected table set is derived from apps/core-api/prisma/schema.prisma.
\set ON_ERROR_STOP on

SELECT set_config('app.target_tenant_id', :'target_tenant_id', false);

DO $$
BEGIN
  IF current_setting('app.target_tenant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'target_tenant_id must be a UUID';
  END IF;
END
$$;

BEGIN;

CREATE TEMP TABLE tenant_restore_expected_tables (
  table_name text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO tenant_restore_expected_tables (table_name)
VALUES
  ('audit_logs'),
  ('bays'),
  ('brands'),
  ('customers'),
  ('employees'),
  ('finance_settings'),
  ('inspection_templates'),
  ('invoice_sequences'),
  ('labor_categories'),
  ('revenue_groups'),
  ('storage_locations'),
  ('tenant_members'),
  ('vendors'),
  ('voice_translation_settings'),
  ('_VendorBrands'),
  ('catalog_items'),
  ('inspection_template_items'),
  ('labor_operations'),
  ('purchase_invoices'),
  ('purchase_orders'),
  ('vehicles'),
  ('voice_note_rate_limits'),
  ('inventory_stocks'),
  ('inventory_transactions'),
  ('labor_fitments'),
  ('purchase_order_items'),
  ('sales_orders'),
  ('vehicle_purchases'),
  ('vehicle_sales'),
  ('workshop_orders'),
  ('invoices'),
  ('purchase_invoice_lines'),
  ('sales_order_items'),
  ('vehicle_ledger_entries'),
  ('workshop_tasks'),
  ('invoice_items'),
  ('labor_entries'),
  ('workshop_inspections'),
  ('workshop_media'),
  ('workshop_task_line_items'),
  ('workshop_voice_note_drafts'),
  ('workshop_inspection_items');

CREATE TEMP TABLE tenant_restore_allowed_global_tables (
  table_name text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO tenant_restore_allowed_global_tables (table_name)
VALUES
  ('users');

DO $$
DECLARE
  unexpected text;
BEGIN
  SELECT string_agg(table_name, ', ' ORDER BY table_name)
  INTO unexpected
  FROM (
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
      AND table_name <> 'tenants'
    EXCEPT
    SELECT table_name FROM tenant_restore_expected_tables
  ) missing_from_manifest;

  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'tenant_id tables missing from restore manifest: %', unexpected;
  END IF;

  SELECT string_agg(table_name, ', ' ORDER BY table_name)
  INTO unexpected
  FROM (
    SELECT table_name
    FROM tenant_restore_expected_tables expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.tables live
      WHERE live.table_schema = 'public'
        AND live.table_name = expected.table_name
    )
  ) missing_from_database;

  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'restore manifest tables missing from database: %', unexpected;
  END IF;

  SELECT string_agg(child_table, ', ' ORDER BY child_table)
  INTO unexpected
  FROM (
    SELECT DISTINCT tc.table_name AS child_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_schema = tc.constraint_schema
     AND ccu.constraint_name = tc.constraint_name
  WHERE tc.constraint_schema = 'public'
      AND tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name IN (
        SELECT table_name FROM tenant_restore_expected_tables
      )
      AND tc.table_name NOT IN (
        SELECT table_name FROM tenant_restore_expected_tables
      )
      AND tc.table_name NOT IN (
        SELECT table_name FROM tenant_restore_allowed_global_tables
      )
  ) dependent_table_drift;

  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'tenant-dependent tables missing from restore manifest: %', unexpected;
  END IF;
END
$$;

COMMIT;
