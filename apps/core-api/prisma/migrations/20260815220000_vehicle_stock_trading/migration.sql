-- CreateEnum
CREATE TYPE "VehicleInventoryRole" AS ENUM ('CUSTOMER', 'USED', 'NEW', 'DEMO');

-- CreateEnum
CREATE TYPE "VehicleStockStatus" AS ENUM ('ON_ORDER', 'IN_STOCK', 'RESERVED', 'IN_PREP', 'SOLD');

-- CreateEnum
CREATE TYPE "VehicleTaxScheme" AS ENUM ('MARGIN', 'STANDARD');

-- CreateEnum
CREATE TYPE "VehiclePurchaseSellerType" AS ENUM ('VENDOR', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "VehicleAcquisitionKind" AS ENUM ('DIRECT', 'TRADE_IN');

-- CreateEnum
CREATE TYPE "VehiclePurchaseStatus" AS ENUM ('DRAFT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VehicleSaleStatus" AS ENUM ('DRAFT', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VehicleLedgerEntryType" AS ENUM ('PURCHASE', 'WORKSHOP_COST', 'ADJUSTMENT', 'SALE');

-- CreateEnum
CREATE TYPE "InvoiceTaxMode" AS ENUM ('STANDARD', 'MARGIN_SCHEME');

-- CreateEnum
CREATE TYPE "WorkshopOrderPurpose" AS ENUM ('CUSTOMER_REPAIR', 'STOCK_PREP');

-- AlterEnum
ALTER TYPE "LocationType" ADD VALUE 'vehicle_lot';

-- AlterTable
ALTER TABLE "finance_settings"
  ADD COLUMN "next_vehicle_purchase_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "vehicle_purchase_prefix" TEXT NOT NULL DEFAULT 'VP-2026-',
  ADD COLUMN "next_vehicle_sale_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "vehicle_sale_prefix" TEXT NOT NULL DEFAULT 'VS-2026-';

-- AlterTable
ALTER TABLE "workshop_orders"
  ALTER COLUMN "customer_id" DROP NOT NULL,
  ADD COLUMN "purpose" "WorkshopOrderPurpose" NOT NULL DEFAULT 'CUSTOMER_REPAIR';

-- AlterTable
ALTER TABLE "vehicles"
  ADD COLUMN "inventory_role" "VehicleInventoryRole" NOT NULL DEFAULT 'CUSTOMER',
  ADD COLUMN "stock_status" "VehicleStockStatus",
  ADD COLUMN "tax_scheme" "VehicleTaxScheme",
  ADD COLUMN "mileage" INTEGER,
  ADD COLUMN "color" TEXT,
  ADD COLUMN "key_number" TEXT,
  ADD COLUMN "registration_certificate_no" TEXT,
  ADD COLUMN "location_id" TEXT,
  ADD COLUMN "reserved_for_customer_id" TEXT;

-- AlterTable
ALTER TABLE "invoices"
  ADD COLUMN "tax_mode" "InvoiceTaxMode" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "vehicle_sale_id" TEXT;

-- CreateTable
CREATE TABLE "vehicle_purchases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "purchase_number" TEXT NOT NULL,
    "status" "VehiclePurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "seller_type" "VehiclePurchaseSellerType" NOT NULL,
    "vendor_id" TEXT,
    "customer_id" TEXT,
    "acquisition_kind" "VehicleAcquisitionKind" NOT NULL DEFAULT 'DIRECT',
    "vehicle_id" TEXT,
    "vin" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "engine_code" TEXT,
    "plate" TEXT,
    "color" TEXT,
    "mileage" INTEGER,
    "key_number" TEXT,
    "registration_certificate_no" TEXT,
    "purchase_price" DECIMAL(12,2) NOT NULL,
    "location_id" TEXT,
    "received_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_sales" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sale_number" TEXT NOT NULL,
    "status" "VehicleSaleStatus" NOT NULL DEFAULT 'DRAFT',
    "vehicle_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "sale_price" DECIMAL(12,2) NOT NULL,
    "cost_basis_snapshot" DECIMAL(12,2),
    "margin_vat_snapshot" DECIMAL(12,2),
    "trade_in_purchase_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_ledger_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "entry_type" "VehicleLedgerEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "posting_date" TIMESTAMP(3) NOT NULL,
    "vehicle_purchase_id" TEXT,
    "vehicle_sale_id" TEXT,
    "workshop_order_id" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_purchases_tenant_id_idx" ON "vehicle_purchases"("tenant_id");
CREATE UNIQUE INDEX "vehicle_purchases_tenant_id_purchase_number_key" ON "vehicle_purchases"("tenant_id", "purchase_number");
CREATE INDEX "vehicle_sales_tenant_id_idx" ON "vehicle_sales"("tenant_id");
CREATE UNIQUE INDEX "vehicle_sales_tenant_id_sale_number_key" ON "vehicle_sales"("tenant_id", "sale_number");
CREATE INDEX "vehicle_ledger_entries_tenant_id_idx" ON "vehicle_ledger_entries"("tenant_id");
CREATE INDEX "vehicle_ledger_entries_tenant_id_vehicle_id_idx" ON "vehicle_ledger_entries"("tenant_id", "vehicle_id");
CREATE INDEX "vehicles_tenant_id_inventory_role_stock_status_idx" ON "vehicles"("tenant_id", "inventory_role", "stock_status");
CREATE UNIQUE INDEX "invoices_vehicle_sale_id_key" ON "invoices"("vehicle_sale_id");
CREATE UNIQUE INDEX "invoices_tenant_id_vehicle_sale_id_key" ON "invoices"("tenant_id", "vehicle_sale_id");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_reserved_for_customer_id_fkey" FOREIGN KEY ("reserved_for_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicle_purchases" ADD CONSTRAINT "vehicle_purchases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_purchases" ADD CONSTRAINT "vehicle_purchases_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicle_purchases" ADD CONSTRAINT "vehicle_purchases_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicle_purchases" ADD CONSTRAINT "vehicle_purchases_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicle_sales" ADD CONSTRAINT "vehicle_sales_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_sales" ADD CONSTRAINT "vehicle_sales_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_sales" ADD CONSTRAINT "vehicle_sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_ledger_entries" ADD CONSTRAINT "vehicle_ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_ledger_entries" ADD CONSTRAINT "vehicle_ledger_entries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_ledger_entries" ADD CONSTRAINT "vehicle_ledger_entries_vehicle_purchase_id_fkey" FOREIGN KEY ("vehicle_purchase_id") REFERENCES "vehicle_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicle_ledger_entries" ADD CONSTRAINT "vehicle_ledger_entries_vehicle_sale_id_fkey" FOREIGN KEY ("vehicle_sale_id") REFERENCES "vehicle_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicle_ledger_entries" ADD CONSTRAINT "vehicle_ledger_entries_workshop_order_id_fkey" FOREIGN KEY ("workshop_order_id") REFERENCES "workshop_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vehicle_sale_id_fkey" FOREIGN KEY ("vehicle_sale_id") REFERENCES "vehicle_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
