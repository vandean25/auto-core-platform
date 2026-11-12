ALTER TABLE "warranty_claims"
ADD COLUMN IF NOT EXISTS "pdf_source_updated_at" TIMESTAMP(3);
