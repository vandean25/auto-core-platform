\set ON_ERROR_STOP on

-- NOT PRODUCTIZED (AUT-154/AUT-171). Do not run against production.
-- Status: docs/internal/05-Runbooks/single-tenant-restore-playbook.md
-- Deferral: docs/internal/.architecture/deferrals.md
--
-- Usage (draft only):
--   psql "$CLONE_DATABASE_URL" -v target_tenant_id='<tenant-id>' -f tools/tenant-restore/apply-tenant-rls.sql

SELECT set_config('app.target_tenant_id', :'target_tenant_id', false);

DO $$
DECLARE
  table_row RECORD;
  policy_name TEXT;
BEGIN
  FOR table_row IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND c.table_name <> 'tenants'
    ORDER BY c.table_name
  LOOP
    policy_name := format('tenant_restore_select_%s', table_row.table_name);

    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      table_row.table_schema,
      table_row.table_name
    );

    EXECUTE format(
      'ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
      table_row.table_schema,
      table_row.table_name
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_name,
      table_row.table_schema,
      table_row.table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR SELECT USING (tenant_id = current_setting(''app.target_tenant_id''))',
      policy_name,
      table_row.table_schema,
      table_row.table_name
    );
  END LOOP;
END
$$;

-- This file is retained only for clone experiments. The export script uses
-- per-table COPY (SELECT ... WHERE tenant_id = ...) and never pg_dump.
-- If an operator uses RLS manually, FORCE is required because table owners
-- otherwise bypass policies. A table-owner pg_dump is forbidden.
