DO $$
BEGIN
  CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FLAT_AMOUNT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "invoices"
ADD COLUMN IF NOT EXISTS "global_discount_type" "DiscountType";

ALTER TABLE "invoices"
ADD COLUMN IF NOT EXISTS "global_discount_value" DECIMAL(10,2);

ALTER TABLE "invoice_items"
ADD COLUMN IF NOT EXISTS "line_discount_type" "DiscountType";

ALTER TABLE "invoice_items"
ADD COLUMN IF NOT EXISTS "line_discount_value" DECIMAL(10,2);

ALTER TABLE "invoice_items"
ADD COLUMN IF NOT EXISTS "line_total" DECIMAL(10,2);

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_global_discount_pair"
CHECK (
  ("global_discount_type" IS NULL AND "global_discount_value" IS NULL)
  OR ("global_discount_type" IS NOT NULL AND "global_discount_value" IS NOT NULL)
);

ALTER TABLE "invoice_items"
ADD CONSTRAINT "invoice_items_line_discount_pair"
CHECK (
  ("line_discount_type" IS NULL AND "line_discount_value" IS NULL)
  OR ("line_discount_type" IS NOT NULL AND "line_discount_value" IS NOT NULL)
);
