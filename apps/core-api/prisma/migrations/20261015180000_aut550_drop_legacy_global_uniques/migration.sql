-- AUT-550: Drop legacy global unique indexes left behind when apply_multi_tenancy
-- added tenant-scoped replacements without removing pre-multi-tenant indexes.
-- Idempotent: safe on DBs that never had the legacy indexes or already dropped them manually.

-- revenue_groups.name
CREATE UNIQUE INDEX IF NOT EXISTS "revenue_groups_tenant_id_name_key"
  ON "revenue_groups" ("tenant_id", "name");
ALTER TABLE "revenue_groups" DROP CONSTRAINT IF EXISTS "revenue_groups_name_key";
DROP INDEX IF EXISTS "revenue_groups_name_key";

-- catalog_items.sku
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_items_tenant_id_sku_key"
  ON "catalog_items" ("tenant_id", "sku");
ALTER TABLE "catalog_items" DROP CONSTRAINT IF EXISTS "catalog_items_sku_key";
DROP INDEX IF EXISTS "catalog_items_sku_key";

-- labor_categories.name
CREATE UNIQUE INDEX IF NOT EXISTS "labor_categories_tenant_id_name_key"
  ON "labor_categories" ("tenant_id", "name");
ALTER TABLE "labor_categories" DROP CONSTRAINT IF EXISTS "labor_categories_name_key";
DROP INDEX IF EXISTS "labor_categories_name_key";

-- labor_operations.code
CREATE UNIQUE INDEX IF NOT EXISTS "labor_operations_tenant_id_code_key"
  ON "labor_operations" ("tenant_id", "code");
ALTER TABLE "labor_operations" DROP CONSTRAINT IF EXISTS "labor_operations_code_key";
DROP INDEX IF EXISTS "labor_operations_code_key";

-- inventory_stocks (catalog_item_id, location_id) before site scoping; global legacy only
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_stocks_tenant_id_catalog_item_id_site_id_location_id_key"
  ON "inventory_stocks" ("tenant_id", "catalog_item_id", "site_id", "location_id");
ALTER TABLE "inventory_stocks" DROP CONSTRAINT IF EXISTS "inventory_stocks_catalog_item_id_location_id_key";
DROP INDEX IF EXISTS "inventory_stocks_catalog_item_id_location_id_key";
ALTER TABLE "inventory_stocks" DROP CONSTRAINT IF EXISTS "inventory_stocks_catalog_item_id_key";
DROP INDEX IF EXISTS "inventory_stocks_catalog_item_id_key";

-- invoices.invoice_number
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_tenant_id_invoice_number_key"
  ON "invoices" ("tenant_id", "invoice_number");
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_invoice_number_key";
DROP INDEX IF EXISTS "invoices_invoice_number_key";

-- invoices.sales_order_id — tenant-scoped 1:1 (at most one invoice per sales order per tenant), not global
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_tenant_id_sales_order_id_key"
  ON "invoices" ("tenant_id", "sales_order_id");
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_sales_order_id_key";
DROP INDEX IF EXISTS "invoices_sales_order_id_key";

-- invoices.workshop_order_id — tenant-scoped 1:1 (at most one invoice per workshop order per tenant), not global
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_tenant_id_workshop_order_id_key"
  ON "invoices" ("tenant_id", "workshop_order_id");
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_workshop_order_id_key";
DROP INDEX IF EXISTS "invoices_workshop_order_id_key";

-- purchase_invoices.invoice_number
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_invoices_tenant_id_invoice_number_key"
  ON "purchase_invoices" ("tenant_id", "invoice_number");
ALTER TABLE "purchase_invoices" DROP CONSTRAINT IF EXISTS "purchase_invoices_invoice_number_key";
DROP INDEX IF EXISTS "purchase_invoices_invoice_number_key";

-- purchase_orders.order_number
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_tenant_id_order_number_key"
  ON "purchase_orders" ("tenant_id", "order_number");
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_order_number_key";
DROP INDEX IF EXISTS "purchase_orders_order_number_key";

-- sales_orders.order_number
CREATE UNIQUE INDEX IF NOT EXISTS "sales_orders_tenant_id_order_number_key"
  ON "sales_orders" ("tenant_id", "order_number");
ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS "sales_orders_order_number_key";
DROP INDEX IF EXISTS "sales_orders_order_number_key";

-- workshop_orders.order_number
CREATE UNIQUE INDEX IF NOT EXISTS "workshop_orders_tenant_id_order_number_key"
  ON "workshop_orders" ("tenant_id", "order_number");
ALTER TABLE "workshop_orders" DROP CONSTRAINT IF EXISTS "workshop_orders_order_number_key";
DROP INDEX IF EXISTS "workshop_orders_order_number_key";
