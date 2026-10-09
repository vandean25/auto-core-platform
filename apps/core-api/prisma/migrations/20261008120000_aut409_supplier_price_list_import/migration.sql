-- AlterEnum
ALTER TYPE "ImportEntityType" ADD VALUE IF NOT EXISTS 'SUPPLIER_PRICE_LIST';

-- CreateEnum
CREATE TYPE "MarginRoundingStrategy" AS ENUM ('NONE', 'ROUND_90', 'ROUND_99', 'WHOLE_EURO');

-- AlterTable
ALTER TABLE "finance_settings" ADD COLUMN IF NOT EXISTS "price_jump_threshold_percent" DECIMAL(5,2) DEFAULT 20;

-- CreateTable
CREATE TABLE "vendor_articles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "catalog_item_id" TEXT NOT NULL,
    "vendor_article_no" TEXT NOT NULL,
    "last_cost" DECIMAL(10,2),
    "last_rrp" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "margin_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "brand_id" INTEGER,
    "revenue_group_id" INTEGER,
    "cost_min" DECIMAL(10,2),
    "cost_max" DECIMAL(10,2),
    "markup_percent" DECIMAL(5,2),
    "use_supplier_rrp" BOOLEAN NOT NULL DEFAULT false,
    "rounding" "MarginRoundingStrategy" NOT NULL DEFAULT 'NONE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "margin_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_price_histories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "catalog_item_id" TEXT NOT NULL,
    "old_cost" DECIMAL(10,2),
    "new_cost" DECIMAL(10,2),
    "old_retail" DECIMAL(10,2),
    "new_retail" DECIMAL(10,2),
    "import_job_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_price_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_articles_tenant_id_catalog_item_id_idx" ON "vendor_articles"("tenant_id", "catalog_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_articles_tenant_id_vendor_id_vendor_article_no_key" ON "vendor_articles"("tenant_id", "vendor_id", "vendor_article_no");

-- CreateIndex
CREATE INDEX "margin_rules_tenant_id_priority_idx" ON "margin_rules"("tenant_id", "priority");

-- CreateIndex
CREATE INDEX "catalog_price_histories_tenant_id_catalog_item_id_createdAt_idx" ON "catalog_price_histories"("tenant_id", "catalog_item_id", "createdAt");

-- CreateIndex
CREATE INDEX "catalog_price_histories_tenant_id_import_job_id_idx" ON "catalog_price_histories"("tenant_id", "import_job_id");

-- AddForeignKey
ALTER TABLE "vendor_articles" ADD CONSTRAINT "vendor_articles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_articles" ADD CONSTRAINT "vendor_articles_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_articles" ADD CONSTRAINT "vendor_articles_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "margin_rules" ADD CONSTRAINT "margin_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "margin_rules" ADD CONSTRAINT "margin_rules_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "margin_rules" ADD CONSTRAINT "margin_rules_revenue_group_id_fkey" FOREIGN KEY ("revenue_group_id") REFERENCES "revenue_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_price_histories" ADD CONSTRAINT "catalog_price_histories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_price_histories" ADD CONSTRAINT "catalog_price_histories_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "catalog_price_histories" ADD CONSTRAINT "catalog_price_histories_tenant_id_import_job_id_fkey" FOREIGN KEY ("tenant_id", "import_job_id") REFERENCES "import_jobs"("tenant_id", "id") ON DELETE SET NULL ("import_job_id") ON UPDATE CASCADE;
