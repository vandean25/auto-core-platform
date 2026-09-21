-- AUT-302: Credit note aggregate, items, and tenant/year CN sequence.

CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'FINALIZED', 'VOID');

CREATE UNIQUE INDEX "invoices_tenant_id_id_key" ON "invoices"("tenant_id", "id");

CREATE UNIQUE INDEX "invoice_items_tenant_id_id_key" ON "invoice_items"("tenant_id", "id");

CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "original_invoice_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "credit_number" TEXT,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "total_net" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_tax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_gross" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "snapshot" JSONB,
    "idempotency_key" TEXT,
    "request_hash" TEXT,
    "finalized_at" TIMESTAMP(3),
    "pdf_storage_bucket" TEXT,
    "pdf_storage_key" TEXT,
    "pdf_generated_at" TIMESTAMP(3),
    "pdf_generation_error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_note_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "credit_note_id" TEXT NOT NULL,
    "original_invoice_item_id" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_note_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_note_sequences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "credit_note_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_notes_tenant_id_id_key" ON "credit_notes"("tenant_id", "id");
CREATE UNIQUE INDEX "credit_notes_tenant_id_credit_number_key" ON "credit_notes"("tenant_id", "credit_number");
CREATE UNIQUE INDEX "credit_notes_tenant_id_idempotency_key_key" ON "credit_notes"("tenant_id", "idempotency_key");
CREATE INDEX "credit_notes_tenant_id_idx" ON "credit_notes"("tenant_id");
CREATE INDEX "credit_notes_tenant_id_site_id_date_idx" ON "credit_notes"("tenant_id", "site_id", "date");
CREATE INDEX "credit_notes_tenant_id_legal_entity_id_date_idx" ON "credit_notes"("tenant_id", "legal_entity_id", "date");

CREATE UNIQUE INDEX "credit_note_items_credit_note_id_original_invoice_item_id_key" ON "credit_note_items"("credit_note_id", "original_invoice_item_id");
CREATE UNIQUE INDEX "credit_note_items_tenant_id_id_key" ON "credit_note_items"("tenant_id", "id");
CREATE INDEX "credit_note_items_tenant_id_idx" ON "credit_note_items"("tenant_id");

CREATE UNIQUE INDEX "credit_note_sequences_tenant_id_year_key" ON "credit_note_sequences"("tenant_id", "year");
CREATE INDEX "credit_note_sequences_tenant_id_idx" ON "credit_note_sequences"("tenant_id");

ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_original_invoice_id_fkey" FOREIGN KEY ("tenant_id", "original_invoice_id") REFERENCES "invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_tenant_id_original_invoice_item_id_fkey" FOREIGN KEY ("tenant_id", "original_invoice_item_id") REFERENCES "invoice_items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "credit_note_sequences" ADD CONSTRAINT "credit_note_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
