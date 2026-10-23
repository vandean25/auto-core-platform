-- Expand-only: digits-only phone key for global search (AUT-698).
-- Backfill must equal normalizePhone() in src/customer/customer-phone.util.ts:
-- strip non-digits; 0043/43… -> 0… (AT national); other 00… -> drop 00; empty -> NULL.
ALTER TABLE "customers" ADD COLUMN "phone_digits" TEXT;

WITH extracted AS (
  SELECT
    id,
    NULLIF(REGEXP_REPLACE("phone", '[^0-9]', '', 'g'), '') AS digits
  FROM "customers"
  WHERE "phone" IS NOT NULL
)
UPDATE "customers" AS c
SET "phone_digits" = CASE
  WHEN e.digits IS NULL THEN NULL
  WHEN e.digits LIKE '0043%' THEN '0' || SUBSTRING(e.digits FROM 5)
  WHEN e.digits LIKE '43%' AND LENGTH(e.digits) > 2 THEN '0' || SUBSTRING(e.digits FROM 3)
  WHEN e.digits LIKE '00%' THEN SUBSTRING(e.digits FROM 3)
  ELSE e.digits
END
FROM extracted AS e
WHERE c.id = e.id;

CREATE INDEX "customers_tenant_id_phone_digits_idx" ON "customers"("tenant_id", "phone_digits");
