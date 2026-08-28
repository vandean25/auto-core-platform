-- CreateEnum
CREATE TYPE "CatalogOemConcernCode" AS ENUM ('BMW', 'MERCEDES', 'STELLANTIS');

-- AlterTable
ALTER TABLE "vehicles"
ADD COLUMN "make_brand_id" INTEGER,
ADD COLUMN "hsn" TEXT,
ADD COLUMN "tsn" TEXT,
ADD COLUMN "identity_keys" JSONB,
ADD COLUMN "identity_input_fingerprint" TEXT,
ADD COLUMN "identity_resolved_at" TIMESTAMP(3),
ADD COLUMN "fuel_type" TEXT,
ADD COLUMN "power_kw" INTEGER;

-- CreateTable
CREATE TABLE "catalog_provider_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "default_identity_adapter_id" TEXT,
    "default_parts_aftermarket_adapter_id" TEXT,
    "default_labor_aftermarket_adapter_id" TEXT,
    "default_labor_category_id" UUID,
    "aw_minutes" INTEGER NOT NULL DEFAULT 6,
    "identity_credentials_secret_ref" TEXT,
    "parts_aftermarket_credentials_secret_ref" TEXT,
    "labor_aftermarket_credentials_secret_ref" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_provider_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_oem_concerns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" "CatalogOemConcernCode" NOT NULL,
    "parts_adapter_id" TEXT,
    "labor_adapter_id" TEXT,
    "parts_credentials_secret_ref" TEXT,
    "labor_credentials_secret_ref" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_oem_concerns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_oem_concern_makes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "concern_id" TEXT NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_oem_concern_makes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_make_aliases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "alias_normalized" TEXT NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_make_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalog_provider_settings_tenant_id_key" ON "catalog_provider_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "catalog_provider_settings_tenant_id_idx" ON "catalog_provider_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "catalog_oem_concerns_tenant_id_idx" ON "catalog_oem_concerns"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_oem_concerns_tenant_id_code_key" ON "catalog_oem_concerns"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_oem_concerns_tenant_id_id_key" ON "catalog_oem_concerns"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "catalog_oem_concern_makes_tenant_id_idx" ON "catalog_oem_concern_makes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_oem_concern_makes_tenant_id_brand_id_key" ON "catalog_oem_concern_makes"("tenant_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_oem_concern_makes_tenant_id_id_key" ON "catalog_oem_concern_makes"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "vehicle_make_aliases_tenant_id_idx" ON "vehicle_make_aliases"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_make_aliases_tenant_id_alias_normalized_key" ON "vehicle_make_aliases"("tenant_id", "alias_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_make_aliases_tenant_id_id_key" ON "vehicle_make_aliases"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "vehicles_make_brand_id_idx" ON "vehicles"("make_brand_id");

-- CreateIndex
CREATE INDEX "vehicles_tenant_id_hsn_tsn_idx" ON "vehicles"("tenant_id", "hsn", "tsn");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_make_brand_id_fkey" FOREIGN KEY ("make_brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_provider_settings" ADD CONSTRAINT "catalog_provider_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_provider_settings" ADD CONSTRAINT "catalog_provider_settings_default_labor_category_id_fkey" FOREIGN KEY ("default_labor_category_id") REFERENCES "labor_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_oem_concerns" ADD CONSTRAINT "catalog_oem_concerns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_oem_concern_makes" ADD CONSTRAINT "catalog_oem_concern_makes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_oem_concern_makes" ADD CONSTRAINT "catalog_oem_concern_makes_tenant_id_concern_id_fkey" FOREIGN KEY ("tenant_id", "concern_id") REFERENCES "catalog_oem_concerns"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_oem_concern_makes" ADD CONSTRAINT "catalog_oem_concern_makes_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_make_aliases" ADD CONSTRAINT "vehicle_make_aliases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_make_aliases" ADD CONSTRAINT "vehicle_make_aliases_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
