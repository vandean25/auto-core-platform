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
  ('brands'),
  ('catalog_oem_concerns'),
  ('customers'),
  ('employees'),
  ('finance_settings'),
  ('inspection_templates'),
  ('invoice_sequences'),
  ('labor_categories'),
  ('legal_entities'),
  ('revenue_groups'),
  ('tenant_members'),
  ('vendors'),
  ('voice_translation_settings'),
  ('_VendorBrands'),
  ('attendance_events'),
  ('catalog_items'),
  ('catalog_oem_concern_makes'),
  ('catalog_provider_settings'),
  ('employee_leave_balances'),
  ('employee_work_schedules'),
  ('inspection_template_items'),
  ('labor_operations'),
  ('leave_requests'),
  ('purchase_invoices'),
  ('purchase_orders'),
  ('sites'),
  ('vehicle_make_aliases'),
  ('voice_note_rate_limits'),
  ('bays'),
  ('employee_work_schedule_days'),
  ('labor_fitments'),
  ('purchase_order_items'),
  ('site_memberships'),
  ('storage_locations'),
  ('workshop_holidays'),
  ('workshop_opening_hours'),
  ('inventory_stocks'),
  ('inventory_transactions'),
  ('purchase_invoice_lines'),
  ('vehicles'),
  ('sales_orders'),
  ('vehicle_purchases'),
  ('vehicle_sales'),
  ('workshop_orders'),
  ('invoices'),
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

CREATE TEMP TABLE tenant_restore_expected_foreign_keys (
  child_table text NOT NULL,
  parent_table text NOT NULL,
  child_columns text NOT NULL,
  parent_columns text NOT NULL,
  on_delete text NOT NULL,
  on_update text NOT NULL,
  PRIMARY KEY (
    child_table,
    parent_table,
    child_columns,
    parent_columns
  )
) ON COMMIT DROP;

INSERT INTO tenant_restore_expected_foreign_keys (
  child_table,
  parent_table,
  child_columns,
  parent_columns,
  on_delete,
  on_update
)
VALUES
  ('_VendorBrands', 'brands', 'A', 'id', 'CASCADE', 'CASCADE'),
  ('_VendorBrands', 'vendors', 'B', 'id', 'CASCADE', 'CASCADE'),
  ('attendance_events', 'employees', 'tenant_id,employee_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('attendance_events', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('audit_logs', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('bays', 'sites', 'tenant_id,site_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('bays', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('brands', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('catalog_items', 'brands', 'brand_id', 'id', 'SET NULL', 'CASCADE'),
  ('catalog_items', 'catalog_items', 'superseded_by_id', 'id', 'SET NULL', 'CASCADE'),
  ('catalog_items', 'revenue_groups', 'revenue_group_id', 'id', 'SET NULL', 'CASCADE'),
  ('catalog_items', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('catalog_oem_concern_makes', 'brands', 'brand_id', 'id', 'RESTRICT', 'CASCADE'),
  ('catalog_oem_concern_makes', 'catalog_oem_concerns', 'tenant_id,concern_id', 'tenant_id,id', 'CASCADE', 'CASCADE'),
  ('catalog_oem_concern_makes', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('catalog_oem_concerns', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('catalog_provider_settings', 'labor_categories', 'default_labor_category_id', 'id', 'RESTRICT', 'CASCADE'),
  ('catalog_provider_settings', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('customers', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('employee_leave_balances', 'employees', 'tenant_id,employee_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('employee_leave_balances', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('employee_work_schedule_days', 'employee_work_schedules', 'tenant_id,schedule_id', 'tenant_id,id', 'CASCADE', 'CASCADE'),
  ('employee_work_schedule_days', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('employee_work_schedules', 'employees', 'tenant_id,employee_id', 'tenant_id,id', 'CASCADE', 'CASCADE'),
  ('employee_work_schedules', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('employees', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('employees', 'users', 'user_id', 'id', 'SET NULL', 'CASCADE'),
  ('finance_settings', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('inspection_template_items', 'inspection_templates', 'tenant_id,inspection_template_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('inspection_template_items', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('inspection_templates', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('inventory_stocks', 'catalog_items', 'catalog_item_id', 'id', 'RESTRICT', 'CASCADE'),
  ('inventory_stocks', 'storage_locations', 'location_id', 'id', 'RESTRICT', 'CASCADE'),
  ('inventory_stocks', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('inventory_transactions', 'catalog_items', 'item_id', 'id', 'RESTRICT', 'CASCADE'),
  ('inventory_transactions', 'storage_locations', 'location_id', 'id', 'RESTRICT', 'CASCADE'),
  ('inventory_transactions', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('invoice_items', 'catalog_items', 'catalog_item_id', 'id', 'SET NULL', 'CASCADE'),
  ('invoice_items', 'invoices', 'invoice_id', 'id', 'CASCADE', 'CASCADE'),
  ('invoice_items', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('invoice_sequences', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('invoices', 'customers', 'customer_id', 'id', 'RESTRICT', 'CASCADE'),
  ('invoices', 'sales_orders', 'tenant_id,sales_order_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('invoices', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('invoices', 'vehicle_sales', 'tenant_id,vehicle_sale_id', 'tenant_id,id', 'SET NULL', 'CASCADE'),
  ('invoices', 'vehicles', 'vehicle_id', 'id', 'SET NULL', 'CASCADE'),
  ('invoices', 'workshop_orders', 'tenant_id,workshop_order_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('labor_categories', 'labor_categories', 'parent_id', 'id', 'RESTRICT', 'CASCADE'),
  ('labor_categories', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('labor_entries', 'employees', 'tenant_id,employee_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('labor_entries', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('labor_entries', 'workshop_tasks', 'tenant_id,workshop_task_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('labor_fitments', 'labor_operations', 'labor_operation_id', 'id', 'CASCADE', 'CASCADE'),
  ('labor_operations', 'labor_categories', 'category_id', 'id', 'RESTRICT', 'CASCADE'),
  ('labor_operations', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('leave_requests', 'employees', 'tenant_id,employee_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('leave_requests', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('legal_entities', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('local_inventories', 'master_parts', 'master_part_id', 'id', 'CASCADE', 'CASCADE'),
  ('part_fitments', 'master_parts', 'master_part_id', 'id', 'CASCADE', 'CASCADE'),
  ('platform_admins', 'users', 'user_id', 'id', 'RESTRICT', 'CASCADE'),
  ('purchase_invoice_lines', 'purchase_invoices', 'purchase_invoice_id', 'id', 'CASCADE', 'CASCADE'),
  ('purchase_invoice_lines', 'purchase_order_items', 'purchase_order_item_id', 'id', 'SET NULL', 'CASCADE'),
  ('purchase_invoice_lines', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('purchase_invoices', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('purchase_invoices', 'vendors', 'vendor_id', 'id', 'RESTRICT', 'CASCADE'),
  ('purchase_order_items', 'catalog_items', 'catalog_item_id', 'id', 'RESTRICT', 'CASCADE'),
  ('purchase_order_items', 'purchase_orders', 'purchase_order_id', 'id', 'RESTRICT', 'CASCADE'),
  ('purchase_order_items', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('purchase_orders', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('purchase_orders', 'vendors', 'vendor_id', 'id', 'RESTRICT', 'CASCADE'),
  ('revenue_groups', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('sales_order_items', 'catalog_items', 'catalog_item_id', 'id', 'SET NULL', 'CASCADE'),
  ('sales_order_items', 'sales_orders', 'sales_order_id', 'id', 'CASCADE', 'CASCADE'),
  ('sales_order_items', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('sales_orders', 'customers', 'customer_id', 'id', 'RESTRICT', 'CASCADE'),
  ('sales_orders', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('sales_orders', 'vehicles', 'vehicle_id', 'id', 'SET NULL', 'CASCADE'),
  ('site_memberships', 'sites', 'tenant_id,site_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('site_memberships', 'tenant_members', 'tenant_id,user_id', 'tenant_id,user_id', 'CASCADE', 'CASCADE'),
  ('site_memberships', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('site_memberships', 'users', 'user_id', 'id', 'RESTRICT', 'CASCADE'),
  ('sites', 'legal_entities', 'tenant_id,legal_entity_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('sites', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('storage_locations', 'sites', 'tenant_id,site_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('storage_locations', 'storage_locations', 'tenant_id,site_id,parent_id', 'tenant_id,site_id,id', 'RESTRICT', 'CASCADE'),
  ('storage_locations', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('tenant_members', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('tenant_members', 'users', 'user_id', 'id', 'RESTRICT', 'CASCADE'),
  ('users', 'tenants', 'active_tenant_id', 'id', 'SET NULL', 'CASCADE'),
  ('vehicle_ledger_entries', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('vehicle_ledger_entries', 'vehicle_purchases', 'vehicle_purchase_id', 'id', 'SET NULL', 'CASCADE'),
  ('vehicle_ledger_entries', 'vehicle_sales', 'vehicle_sale_id', 'id', 'SET NULL', 'CASCADE'),
  ('vehicle_ledger_entries', 'vehicles', 'vehicle_id', 'id', 'RESTRICT', 'CASCADE'),
  ('vehicle_ledger_entries', 'workshop_orders', 'workshop_order_id', 'id', 'SET NULL', 'CASCADE'),
  ('vehicle_make_aliases', 'brands', 'brand_id', 'id', 'RESTRICT', 'CASCADE'),
  ('vehicle_make_aliases', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('vehicle_purchases', 'customers', 'customer_id', 'id', 'SET NULL', 'CASCADE'),
  ('vehicle_purchases', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('vehicle_purchases', 'vehicles', 'vehicle_id', 'id', 'SET NULL', 'CASCADE'),
  ('vehicle_purchases', 'vendors', 'vendor_id', 'id', 'SET NULL', 'CASCADE'),
  ('vehicle_sales', 'customers', 'customer_id', 'id', 'RESTRICT', 'CASCADE'),
  ('vehicle_sales', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('vehicle_sales', 'vehicles', 'vehicle_id', 'id', 'RESTRICT', 'CASCADE'),
  ('vehicles', 'brands', 'make_brand_id', 'id', 'SET NULL', 'CASCADE'),
  ('vehicles', 'customers', 'customer_id', 'id', 'SET NULL', 'CASCADE'),
  ('vehicles', 'customers', 'reserved_for_customer_id', 'id', 'SET NULL', 'CASCADE'),
  ('vehicles', 'storage_locations', 'location_id', 'id', 'SET NULL', 'CASCADE'),
  ('vehicles', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('vendors', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('voice_note_rate_limits', 'employees', 'tenant_id,mechanic_id', 'tenant_id,id', 'CASCADE', 'CASCADE'),
  ('voice_note_rate_limits', 'tenants', 'tenant_id', 'id', 'CASCADE', 'CASCADE'),
  ('voice_translation_settings', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_holidays', 'sites', 'tenant_id,site_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('workshop_holidays', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_inspection_items', 'inspection_template_items', 'tenant_id,inspection_template_item_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('workshop_inspection_items', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_inspection_items', 'workshop_inspections', 'tenant_id,workshop_inspection_id', 'tenant_id,id', 'CASCADE', 'CASCADE'),
  ('workshop_inspections', 'inspection_templates', 'tenant_id,inspection_template_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('workshop_inspections', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_inspections', 'workshop_orders', 'tenant_id,workshop_order_id', 'tenant_id,id', 'CASCADE', 'CASCADE'),
  ('workshop_inspections', 'workshop_tasks', 'tenant_id,workshop_task_id', 'tenant_id,id', 'SET NULL', 'CASCADE'),
  ('workshop_media', 'employees', 'tenant_id,uploaded_by_employee_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('workshop_media', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_media', 'workshop_orders', 'tenant_id,workshop_order_id', 'tenant_id,id', 'CASCADE', 'CASCADE'),
  ('workshop_media', 'workshop_tasks', 'tenant_id,workshop_task_id', 'tenant_id,id', 'SET NULL', 'CASCADE'),
  ('workshop_opening_hours', 'sites', 'tenant_id,site_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('workshop_opening_hours', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_orders', 'bays', 'bay_id', 'id', 'SET NULL', 'CASCADE'),
  ('workshop_orders', 'customers', 'customer_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_orders', 'employees', 'mechanic_id', 'id', 'SET NULL', 'CASCADE'),
  ('workshop_orders', 'storage_locations', 'staging_location_id', 'id', 'SET NULL', 'CASCADE'),
  ('workshop_orders', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_orders', 'vehicles', 'vehicle_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_task_line_items', 'catalog_items', 'catalog_item_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_task_line_items', 'labor_categories', 'labor_category_id', 'id', 'SET NULL', 'CASCADE'),
  ('workshop_task_line_items', 'labor_operations', 'labor_operation_id', 'id', 'SET NULL', 'CASCADE'),
  ('workshop_task_line_items', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_task_line_items', 'workshop_tasks', 'tenant_id,workshop_task_id', 'tenant_id,id', 'CASCADE', 'CASCADE'),
  ('workshop_tasks', 'bays', 'tenant_id,bay_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('workshop_tasks', 'employees', 'tenant_id,mechanic_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('workshop_tasks', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_tasks', 'workshop_orders', 'tenant_id,workshop_order_id', 'tenant_id,id', 'CASCADE', 'CASCADE'),
  ('workshop_voice_note_drafts', 'employees', 'tenant_id,accepted_by_employee_id', 'tenant_id,id', 'SET NULL', 'CASCADE'),
  ('workshop_voice_note_drafts', 'employees', 'tenant_id,mechanic_employee_id', 'tenant_id,id', 'RESTRICT', 'CASCADE'),
  ('workshop_voice_note_drafts', 'tenants', 'tenant_id', 'id', 'RESTRICT', 'CASCADE'),
  ('workshop_voice_note_drafts', 'workshop_tasks', 'tenant_id,workshop_task_id', 'tenant_id,id', 'CASCADE', 'CASCADE');

CREATE TEMP TABLE tenant_restore_live_foreign_keys (
  child_table text NOT NULL,
  parent_table text NOT NULL,
  child_columns text NOT NULL,
  parent_columns text NOT NULL,
  on_delete text NOT NULL,
  on_update text NOT NULL,
  PRIMARY KEY (
    child_table,
    parent_table,
    child_columns,
    parent_columns
  )
) ON COMMIT DROP;

INSERT INTO tenant_restore_live_foreign_keys (
  child_table,
  parent_table,
  child_columns,
  parent_columns,
  on_delete,
  on_update
)
SELECT
  child.relname,
  parent.relname,
  string_agg(child_column.attname, ',' ORDER BY child_key.ordinality),
  string_agg(parent_column.attname, ',' ORDER BY parent_key.ordinality),
  CASE constraint_row.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END,
  CASE constraint_row.confupdtype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END
FROM pg_constraint constraint_row
JOIN pg_class child ON child.oid = constraint_row.conrelid
JOIN pg_namespace child_schema ON child_schema.oid = child.relnamespace
JOIN pg_class parent ON parent.oid = constraint_row.confrelid
JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
CROSS JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS child_key(attnum, ordinality)
CROSS JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS parent_key(attnum, ordinality)
JOIN pg_attribute child_column
  ON child_column.attrelid = child.oid
 AND child_column.attnum = child_key.attnum
JOIN pg_attribute parent_column
  ON parent_column.attrelid = parent.oid
 AND parent_column.attnum = parent_key.attnum
WHERE constraint_row.contype = 'f'
  AND child_schema.nspname = 'public'
  AND parent_schema.nspname = 'public'
  AND child_key.ordinality = parent_key.ordinality
GROUP BY
  constraint_row.oid,
  child.relname,
  parent.relname,
  constraint_row.confdeltype,
  constraint_row.confupdtype;

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

  SELECT string_agg(
    format(
      '%s(%s)->%s(%s) %s/%s',
      child_table,
      child_columns,
      parent_table,
      parent_columns,
      on_delete,
      on_update
    ),
    '; ' ORDER BY child_table, parent_table, child_columns
  )
  INTO unexpected
  FROM (
    SELECT * FROM tenant_restore_expected_foreign_keys
    EXCEPT
    SELECT * FROM tenant_restore_live_foreign_keys
    UNION
    SELECT * FROM tenant_restore_live_foreign_keys
    EXCEPT
    SELECT * FROM tenant_restore_expected_foreign_keys
  ) foreign_key_drift;

  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'foreign-key signatures differ from restore manifest: %', unexpected;
  END IF;
END
$$;

COMMIT;
