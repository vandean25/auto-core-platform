-- Align deployed schema with current Prisma models.
ALTER TABLE "finance_settings"
  ALTER COLUMN "id" DROP DEFAULT;

ALTER TABLE "finance_settings"
  ALTER COLUMN "id" TYPE TEXT USING "id"::text;

ALTER TABLE "purchase_invoice_lines"
  ADD COLUMN "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 20;