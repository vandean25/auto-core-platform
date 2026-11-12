ALTER TABLE "warranty_claims"
ADD COLUMN "pdf_storage_bucket" TEXT,
ADD COLUMN "pdf_storage_key" TEXT,
ADD COLUMN "pdf_generated_at" TIMESTAMP(3),
ADD COLUMN "pdf_generation_error" TEXT;
