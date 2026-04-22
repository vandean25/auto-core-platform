\set ON_ERROR_STOP on

-- Usage:
--   psql "$PRIMARY_DATABASE_URL" -v target_tenant_id='<tenant-id>' -f tools/tenant-restore/purge-tenant-data.sql

SELECT set_config('app.target_tenant_id', :'target_tenant_id', false);

BEGIN;

-- Leaf tables first
DELETE FROM workshop_task_line_items WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM labor_fitments WHERE labor_operation_id IN (
  SELECT id FROM labor_operations WHERE tenant_id = current_setting('app.target_tenant_id')
);
DELETE FROM purchase_invoice_lines WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM purchase_order_items WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM sales_order_items WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM invoice_items WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM inventory_transactions WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM inventory_stocks WHERE tenant_id = current_setting('app.target_tenant_id');

-- Mid-level tables
DELETE FROM workshop_tasks WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM labor_operations WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM labor_categories WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM purchase_invoices WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM purchase_orders WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM invoices WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM invoice_sequences WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM sales_orders WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM workshop_orders WHERE tenant_id = current_setting('app.target_tenant_id');

-- Root domain tables
DELETE FROM vehicles WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM customers WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM vendors WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM catalog_items WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM storage_locations WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM brands WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM finance_settings WHERE tenant_id = current_setting('app.target_tenant_id');
DELETE FROM revenue_groups WHERE tenant_id = current_setting('app.target_tenant_id');

COMMIT;
