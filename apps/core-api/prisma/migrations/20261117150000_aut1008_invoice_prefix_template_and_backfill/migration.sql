-- Expand-only migration for AUT-1008:
-- 1. Switch FinanceSettings invoice_prefix / next_invoice_number defaults to 'RE-{YYYY}-' / 1.
-- 2. Rewrite legacy fixed-year 'RE-YYYY-' prefixes to 'RE-{YYYY}-'.
-- 3. Backfill next_invoice_number from the current Vienna-year invoice_sequences counter (or 1).

ALTER TABLE "finance_settings"
  ALTER COLUMN "next_invoice_number" SET DEFAULT 1,
  ALTER COLUMN "invoice_prefix" SET DEFAULT 'RE-{YYYY}-';

UPDATE "finance_settings"
SET "invoice_prefix" = 'RE-{YYYY}-'
WHERE "invoice_prefix" ~ '^RE-[0-9]{4}-$';

UPDATE "finance_settings" fs
SET "next_invoice_number" = COALESCE(
  (
    SELECT seq."current" + 1
    FROM "invoice_sequences" seq
    WHERE seq."tenant_id" = fs."tenant_id"
      AND seq."year" = EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Europe/Vienna'))::INTEGER
  ),
  1
);
