-- AUT-354: Kostenvoranschlag (workshop estimates), KV-YYYY-XXXX numbering, immutable version snapshots,
-- PDF archive columns and the tenant overrun threshold. Expand-only: new tables and enum, plus one
-- finance_settings column with a constant default. No existing column is changed or dropped.
-- CreateEnum
CREATE TYPE "WorkshopEstimateStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'EXPIRED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "finance_settings" ADD COLUMN     "estimate_overrun_threshold_pct" DECIMAL(5,2) NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "workshop_estimate_sequences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "workshop_estimate_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_estimates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "workshop_order_id" TEXT NOT NULL,
    "estimate_number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_estimate_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "estimate_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "WorkshopEstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "legal_entity_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "total_net" DECIMAL(10,2),
    "total_tax" DECIMAL(10,2),
    "total_gross" DECIMAL(10,2),
    "snapshot" JSONB,
    "snapshot_sha256" TEXT,
    "legal_text_version" TEXT,
    "legal_text_sha256" TEXT,
    "retain_until" TIMESTAMP(3),
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "pdf_storage_bucket" TEXT,
    "pdf_storage_key" TEXT,
    "pdf_archive_generation" TEXT,
    "pdf_sha256" TEXT,
    "pdf_generated_at" TIMESTAMP(3),
    "pdf_generation_error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_estimate_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_estimate_brand_asset_references" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "workshop_estimate_version_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workshop_estimate_brand_asset_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workshop_estimate_sequences_tenant_id_idx" ON "workshop_estimate_sequences"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_estimate_sequences_tenant_id_year_key" ON "workshop_estimate_sequences"("tenant_id", "year");

-- CreateIndex
CREATE INDEX "workshop_estimates_tenant_id_idx" ON "workshop_estimates"("tenant_id");

-- CreateIndex
CREATE INDEX "workshop_estimates_tenant_id_site_id_idx" ON "workshop_estimates"("tenant_id", "site_id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_estimates_tenant_id_id_key" ON "workshop_estimates"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_estimates_tenant_id_estimate_number_key" ON "workshop_estimates"("tenant_id", "estimate_number");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_estimates_tenant_id_workshop_order_id_key" ON "workshop_estimates"("tenant_id", "workshop_order_id");

-- CreateIndex
CREATE INDEX "workshop_estimate_versions_tenant_id_idx" ON "workshop_estimate_versions"("tenant_id");

-- CreateIndex
CREATE INDEX "workshop_estimate_versions_tenant_id_estimate_id_status_idx" ON "workshop_estimate_versions"("tenant_id", "estimate_id", "status");

-- CreateIndex
CREATE INDEX "wev_entity_sent_idx" ON "workshop_estimate_versions"("tenant_id", "legal_entity_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_estimate_versions_tenant_id_id_key" ON "workshop_estimate_versions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_estimate_versions_tenant_id_estimate_id_version_key" ON "workshop_estimate_versions"("tenant_id", "estimate_id", "version");

-- CreateIndex
CREATE INDEX "workshop_estimate_brand_asset_references_tenant_id_idx" ON "workshop_estimate_brand_asset_references"("tenant_id");

-- CreateIndex
CREATE INDEX "weba_asset_scope_idx" ON "workshop_estimate_brand_asset_references"("tenant_id", "legal_entity_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "weba_tenant_id_uq" ON "workshop_estimate_brand_asset_references"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "weba_tenant_version_uq" ON "workshop_estimate_brand_asset_references"("tenant_id", "workshop_estimate_version_id");

-- AddForeignKey
ALTER TABLE "workshop_estimate_sequences" ADD CONSTRAINT "workshop_estimate_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimates" ADD CONSTRAINT "workshop_estimates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimates" ADD CONSTRAINT "workshop_estimates_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimates" ADD CONSTRAINT "workshop_estimates_tenant_id_workshop_order_id_fkey" FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_versions" ADD CONSTRAINT "workshop_estimate_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_versions" ADD CONSTRAINT "workshop_estimate_versions_tenant_id_estimate_id_fkey" FOREIGN KEY ("tenant_id", "estimate_id") REFERENCES "workshop_estimates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_versions" ADD CONSTRAINT "workshop_estimate_versions_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_brand_asset_references" ADD CONSTRAINT "weba_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_brand_asset_references" ADD CONSTRAINT "weba_entity_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_brand_asset_references" ADD CONSTRAINT "weba_version_fkey" FOREIGN KEY ("tenant_id", "workshop_estimate_version_id") REFERENCES "workshop_estimate_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_brand_asset_references" ADD CONSTRAINT "weba_asset_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id", "asset_id") REFERENCES "document_brand_assets"("tenant_id", "legal_entity_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

