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
