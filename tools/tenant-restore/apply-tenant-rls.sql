\set ON_ERROR_STOP on

-- Usage:
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

-- Optional hardening for dedicated extractor role.
-- Run this once after creating the tenant_extractor role.
-- ALTER ROLE tenant_extractor SET row_security = on;
