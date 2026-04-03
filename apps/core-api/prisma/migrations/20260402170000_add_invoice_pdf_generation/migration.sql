-- AlterTable
ALTER TABLE "invoices"
ADD COLUMN "snapshot" JSONB,
ADD COLUMN "pdf_storage_bucket" TEXT,
ADD COLUMN "pdf_storage_key" TEXT,
ADD COLUMN "pdf_generated_at" TIMESTAMP(3),
ADD COLUMN "pdf_generation_error" TEXT;
