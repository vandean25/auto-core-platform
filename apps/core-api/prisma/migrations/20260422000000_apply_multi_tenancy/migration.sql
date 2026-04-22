-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'ISSUED';

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_sales_order_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_workshop_order_id_fkey";

-- DropForeignKey
ALTER TABLE "labor_categories" DROP CONSTRAINT "labor_categories_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "labor_fitments" DROP CONSTRAINT "labor_fitments_labor_operation_id_fkey";

-- DropForeignKey
ALTER TABLE "labor_operations" DROP CONSTRAINT "labor_operations_category_id_fkey";

-- DropForeignKey
ALTER TABLE "local_inventories" DROP CONSTRAINT "local_inventories_master_part_id_fkey";

-- DropForeignKey
ALTER TABLE "part_fitments" DROP CONSTRAINT "part_fitments_master_part_id_fkey";

-- DropForeignKey
ALTER TABLE "workshop_task_line_items" DROP CONSTRAINT "workshop_task_line_items_labor_operation_id_fkey";

-- DropForeignKey
ALTER TABLE "workshop_task_line_items" DROP CONSTRAINT "workshop_task_line_items_workshop_task_id_fkey";

-- DropForeignKey
ALTER TABLE "workshop_tasks" DROP CONSTRAINT "workshop_tasks_workshop_order_id_fkey";

-- AlterTable
ALTER TABLE "labor_categories" DROP CONSTRAINT "labor_categories_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "parent_id",
ADD COLUMN     "parent_id" UUID,
ADD CONSTRAINT "labor_categories_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "labor_fitments" DROP CONSTRAINT "labor_fitments_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "labor_operation_id",
ADD COLUMN     "labor_operation_id" UUID NOT NULL,
ADD CONSTRAINT "labor_fitments_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "labor_operations" DROP CONSTRAINT "labor_operations_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "category_id",
ADD COLUMN     "category_id" UUID,
ADD CONSTRAINT "labor_operations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "local_inventories" DROP CONSTRAINT "local_inventories_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "master_part_id",
ADD COLUMN     "master_part_id" UUID NOT NULL,
ADD CONSTRAINT "local_inventories_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "master_parts" DROP CONSTRAINT "master_parts_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "master_parts_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "part_fitments" DROP CONSTRAINT "part_fitments_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "master_part_id",
ADD COLUMN     "master_part_id" UUID NOT NULL,
ADD CONSTRAINT "part_fitments_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "workshop_task_line_items" DROP COLUMN "labor_operation_id",
ADD COLUMN     "labor_operation_id" UUID;

-- CreateIndex
CREATE INDEX "brands_tenant_id_idx" ON "brands"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_tenant_id_name_key" ON "brands"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "catalog_items_tenant_id_idx" ON "catalog_items"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_tenant_id_sku_key" ON "catalog_items"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "customers_tenant_id_idx" ON "customers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "finance_settings_tenant_id_idx" ON "finance_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_settings_tenant_id_key" ON "finance_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_stocks_tenant_id_idx" ON "inventory_stocks"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stocks_tenant_id_catalog_item_id_location_id_key" ON "inventory_stocks"("tenant_id", "catalog_item_id", "location_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_tenant_id_idx" ON "inventory_transactions"("tenant_id");

-- CreateIndex
CREATE INDEX "invoice_items_tenant_id_idx" ON "invoice_items"("tenant_id");

-- CreateIndex
CREATE INDEX "invoice_sequences_tenant_id_idx" ON "invoice_sequences"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_sequences_tenant_id_year_key" ON "invoice_sequences"("tenant_id", "year");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_idx" ON "invoices"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_invoice_number_key" ON "invoices"("tenant_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_sales_order_id_key" ON "invoices"("tenant_id", "sales_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_workshop_order_id_key" ON "invoices"("tenant_id", "workshop_order_id");

-- CreateIndex
CREATE INDEX "labor_categories_tenant_id_idx" ON "labor_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "labor_categories_parent_id_idx" ON "labor_categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "labor_categories_tenant_id_name_key" ON "labor_categories"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "labor_fitments_labor_operation_id_idx" ON "labor_fitments"("labor_operation_id");

-- CreateIndex
CREATE INDEX "labor_operations_tenant_id_idx" ON "labor_operations"("tenant_id");

-- CreateIndex
CREATE INDEX "labor_operations_category_id_idx" ON "labor_operations"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "labor_operations_tenant_id_code_key" ON "labor_operations"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "local_inventories_master_part_id_key" ON "local_inventories"("master_part_id");

-- CreateIndex
CREATE INDEX "part_fitments_master_part_id_idx" ON "part_fitments"("master_part_id");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_tenant_id_idx" ON "purchase_invoice_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "purchase_invoices_tenant_id_idx" ON "purchase_invoices"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_tenant_id_invoice_number_key" ON "purchase_invoices"("tenant_id", "invoice_number");

-- CreateIndex
CREATE INDEX "purchase_order_items_tenant_id_idx" ON "purchase_order_items"("tenant_id");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_idx" ON "purchase_orders"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_order_number_key" ON "purchase_orders"("tenant_id", "order_number");

-- CreateIndex
CREATE INDEX "revenue_groups_tenant_id_idx" ON "revenue_groups"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_groups_tenant_id_name_key" ON "revenue_groups"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "sales_order_items_tenant_id_idx" ON "sales_order_items"("tenant_id");

-- CreateIndex
CREATE INDEX "sales_orders_tenant_id_idx" ON "sales_orders"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_tenant_id_id_key" ON "sales_orders"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_tenant_id_order_number_key" ON "sales_orders"("tenant_id", "order_number");

-- CreateIndex
CREATE INDEX "storage_locations_tenant_id_idx" ON "storage_locations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_tenant_id_code_key" ON "storage_locations"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "vehicles_tenant_id_idx" ON "vehicles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenant_id_vin_key" ON "vehicles"("tenant_id", "vin");

-- CreateIndex
CREATE INDEX "vendors_tenant_id_idx" ON "vendors"("tenant_id");

-- CreateIndex
CREATE INDEX "workshop_orders_tenant_id_idx" ON "workshop_orders"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_orders_tenant_id_id_key" ON "workshop_orders"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_orders_tenant_id_order_number_key" ON "workshop_orders"("tenant_id", "order_number");

-- CreateIndex
CREATE INDEX "workshop_task_line_items_tenant_id_idx" ON "workshop_task_line_items"("tenant_id");

-- CreateIndex
CREATE INDEX "workshop_task_line_items_labor_operation_id_idx" ON "workshop_task_line_items"("labor_operation_id");

-- CreateIndex
CREATE INDEX "workshop_tasks_tenant_id_idx" ON "workshop_tasks"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_tasks_tenant_id_id_key" ON "workshop_tasks"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "revenue_groups" ADD CONSTRAINT "revenue_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stocks" ADD CONSTRAINT "inventory_stocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_sales_order_id_fkey" FOREIGN KEY ("tenant_id", "sales_order_id") REFERENCES "sales_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_workshop_order_id_fkey" FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_orders" ADD CONSTRAINT "workshop_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_tenant_id_workshop_order_id_fkey" FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_task_line_items" ADD CONSTRAINT "workshop_task_line_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_task_line_items" ADD CONSTRAINT "workshop_task_line_items_tenant_id_workshop_task_id_fkey" FOREIGN KEY ("tenant_id", "workshop_task_id") REFERENCES "workshop_tasks"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_task_line_items" ADD CONSTRAINT "workshop_task_line_items_labor_operation_id_fkey" FOREIGN KEY ("labor_operation_id") REFERENCES "labor_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_categories" ADD CONSTRAINT "labor_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_categories" ADD CONSTRAINT "labor_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "labor_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_operations" ADD CONSTRAINT "labor_operations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_operations" ADD CONSTRAINT "labor_operations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "labor_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_fitments" ADD CONSTRAINT "labor_fitments_labor_operation_id_fkey" FOREIGN KEY ("labor_operation_id") REFERENCES "labor_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_fitments" ADD CONSTRAINT "part_fitments_master_part_id_fkey" FOREIGN KEY ("master_part_id") REFERENCES "master_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_inventories" ADD CONSTRAINT "local_inventories_master_part_id_fkey" FOREIGN KEY ("master_part_id") REFERENCES "master_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
