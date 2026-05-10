-- Remove legacy global uniqueness that conflicts with tenant-scoped models.
DROP INDEX IF EXISTS "brands_name_key";
DROP INDEX IF EXISTS "storage_locations_code_key";
DROP INDEX IF EXISTS "customers_email_key";

-- Align invoice_sequences with the current Prisma model.
ALTER TABLE "invoice_sequences"
  ADD COLUMN "id" TEXT;

UPDATE "invoice_sequences"
SET "id" = md5(random()::text || clock_timestamp()::text)
WHERE "id" IS NULL;

ALTER TABLE "invoice_sequences"
  ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "invoice_sequences"
  DROP CONSTRAINT IF EXISTS "invoice_sequences_pkey";

ALTER TABLE "invoice_sequences"
  ADD CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("id");