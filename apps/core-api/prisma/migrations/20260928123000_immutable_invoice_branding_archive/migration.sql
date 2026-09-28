ALTER TABLE "invoices"
ADD COLUMN "pdf_archive_bucket" TEXT,
ADD COLUMN "pdf_archive_key" TEXT,
ADD COLUMN "pdf_archive_generation" TEXT,
ADD COLUMN "pdf_archive_sha256" TEXT;

CREATE UNIQUE INDEX "invoices_tenant_id_legal_entity_id_id_key"
ON "invoices"("tenant_id", "legal_entity_id", "id");

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_pdf_archive_identity_check"
CHECK (
    (
        "pdf_archive_bucket" IS NULL
        AND "pdf_archive_key" IS NULL
        AND "pdf_archive_generation" IS NULL
        AND "pdf_archive_sha256" IS NULL
    )
    OR (
        "pdf_archive_bucket" IS NOT NULL
        AND length(btrim("pdf_archive_bucket")) > 0
        AND "pdf_archive_key" IS NOT NULL
        AND length(btrim("pdf_archive_key")) > 0
        AND "pdf_archive_generation" IS NOT NULL
        AND length(btrim("pdf_archive_generation")) > 0
        AND "pdf_archive_sha256" ~ '^[a-f0-9]{64}$'
        AND "pdf_generated_at" IS NOT NULL
    )
);

CREATE TABLE "invoice_brand_asset_references" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_brand_asset_references_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ibr_tenant_id_uq"
ON "invoice_brand_asset_references"("tenant_id", "id");

CREATE UNIQUE INDEX "ibr_tenant_invoice_uq"
ON "invoice_brand_asset_references"("tenant_id", "legal_entity_id", "invoice_id");

CREATE INDEX "invoice_brand_asset_references_asset_scope_idx"
ON "invoice_brand_asset_references"("tenant_id", "legal_entity_id", "asset_id");

ALTER TABLE "invoice_brand_asset_references"
ADD CONSTRAINT "ibr_tenant_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_brand_asset_references"
ADD CONSTRAINT "ibr_entity_fkey"
FOREIGN KEY ("tenant_id", "legal_entity_id")
REFERENCES "legal_entities"("tenant_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_brand_asset_references"
ADD CONSTRAINT "ibr_invoice_fkey"
FOREIGN KEY ("tenant_id", "legal_entity_id", "invoice_id")
REFERENCES "invoices"("tenant_id", "legal_entity_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_brand_asset_references"
ADD CONSTRAINT "ibr_asset_fkey"
FOREIGN KEY ("tenant_id", "legal_entity_id", "asset_id")
REFERENCES "document_brand_assets"("tenant_id", "legal_entity_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
