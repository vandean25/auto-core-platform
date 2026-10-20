-- Expand-only schema M1 for legacy DMS migration master data (AUT-624)

CREATE TYPE "CustomerBlockLevel" AS ENUM ('NONE', 'INVOICING', 'ALL');
CREATE TYPE "CustomerSalutation" AS ENUM ('MR', 'MS', 'NEUTRAL', 'COMPANY');

ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'PART';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'VENDOR';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'STOCK_OPENING_BALANCE';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'OPEN_WORKSHOP_ORDER';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'LEGACY_SERVICE_ORDER';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'LEGACY_INVOICE';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'LEGACY_OPEN_ITEM';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'TYRE_SET';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'VEHICLE_PARTY';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'VEHICLE_DUE_DATE';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'VEHICLE_NOTICE';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'LABOR_STANDARD_TIME';
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'LABOR_PRICE_GROUP';

CREATE TABLE "labor_price_groups" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hourly_rate" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labor_price_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "labor_price_groups_tenant_id_id_key" ON "labor_price_groups"("tenant_id", "id");
CREATE UNIQUE INDEX "labor_price_groups_tenant_id_code_key" ON "labor_price_groups"("tenant_id", "code");
CREATE INDEX "labor_price_groups_tenant_id_idx" ON "labor_price_groups"("tenant_id");

ALTER TABLE "labor_price_groups" ADD CONSTRAINT "labor_price_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customers" ADD COLUMN "legacy_restricted_at" TIMESTAMP(3),
ADD COLUMN "legacy_restricted_reason" TEXT,
ADD COLUMN "block_level" "CustomerBlockLevel" NOT NULL DEFAULT 'NONE',
ADD COLUMN "block_reason" TEXT,
ADD COLUMN "salutation" "CustomerSalutation",
ADD COLUMN "title" TEXT,
ADD COLUMN "title_suffix" TEXT,
ADD COLUMN "letter_salutation" TEXT,
ADD COLUMN "payment_terms_days" INTEGER,
ADD COLUMN "payment_terms_text" TEXT,
ADD COLUMN "default_bill_to_customer_id" TEXT,
ADD COLUMN "labor_price_group_id" UUID;

ALTER TABLE "workshop_orders" ADD COLUMN "bill_to_customer_id" TEXT;

ALTER TABLE "labor_operations" ADD COLUMN "make_brand_id" INTEGER;

ALTER TABLE "labor_fitments" ADD COLUMN "standard_aw" DECIMAL(10,2);

CREATE INDEX "labor_operations_make_brand_id_idx" ON "labor_operations"("make_brand_id");

-- Postgres 15 column-list ON DELETE SET NULL (Prisma onDelete: SetNull cannot emit the column list; SQL is authoritative)
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_default_bill_to_customer_id_fkey" FOREIGN KEY ("tenant_id", "default_bill_to_customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE SET NULL ("default_bill_to_customer_id") ON UPDATE CASCADE;

ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_labor_price_group_id_fkey" FOREIGN KEY ("tenant_id", "labor_price_group_id") REFERENCES "labor_price_groups"("tenant_id", "id") ON DELETE SET NULL ("labor_price_group_id") ON UPDATE CASCADE;

ALTER TABLE "workshop_orders" ADD CONSTRAINT "workshop_orders_tenant_id_bill_to_customer_id_fkey" FOREIGN KEY ("tenant_id", "bill_to_customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "labor_operations" ADD CONSTRAINT "labor_operations_make_brand_id_fkey" FOREIGN KEY ("make_brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
