-- AUT-255: site ownership for cached inventory stock and immutable ledger rows.
-- The site is derived from the referenced storage location; composite foreign
-- keys make a mismatched location/site pair impossible at the database boundary.

BEGIN;

ALTER TABLE "inventory_stocks" ADD COLUMN "site_id" TEXT;
ALTER TABLE "inventory_transactions" ADD COLUMN "site_id" TEXT;

UPDATE "inventory_stocks" AS stock
SET "site_id" = location."site_id"
FROM "storage_locations" AS location
WHERE location."id" = stock."location_id"
  AND location."tenant_id" = stock."tenant_id";

UPDATE "inventory_transactions" AS transaction
SET "site_id" = location."site_id"
FROM "storage_locations" AS location
WHERE location."id" = transaction."location_id"
  AND location."tenant_id" = transaction."tenant_id";

DO $$
DECLARE
  invalid_stock_count INTEGER;
  invalid_transaction_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_stock_count
  FROM "inventory_stocks" AS stock
  WHERE stock."site_id" IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "storage_locations" AS location
      WHERE location."tenant_id" = stock."tenant_id"
        AND location."site_id" = stock."site_id"
        AND location."id" = stock."location_id"
    );

  IF invalid_stock_count <> 0 THEN
    RAISE EXCEPTION
      'AUT-255 validation failed: % inventory stock rows do not resolve to a same-site location.',
      invalid_stock_count;
  END IF;

  SELECT COUNT(*) INTO invalid_transaction_count
  FROM "inventory_transactions" AS transaction
  WHERE transaction."site_id" IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "storage_locations" AS location
      WHERE location."tenant_id" = transaction."tenant_id"
        AND location."site_id" = transaction."site_id"
        AND location."id" = transaction."location_id"
    );

  IF invalid_transaction_count <> 0 THEN
    RAISE EXCEPTION
      'AUT-255 validation failed: % inventory transaction rows do not resolve to a same-site location.',
      invalid_transaction_count;
  END IF;
END $$;

ALTER TABLE "inventory_stocks" ALTER COLUMN "site_id" SET NOT NULL;
ALTER TABLE "inventory_transactions" ALTER COLUMN "site_id" SET NOT NULL;

ALTER TABLE "inventory_stocks"
  DROP CONSTRAINT IF EXISTS "inventory_stocks_location_id_fkey";
ALTER TABLE "inventory_transactions"
  DROP CONSTRAINT IF EXISTS "inventory_transactions_location_id_fkey";

ALTER TABLE "inventory_stocks"
  ADD CONSTRAINT "inventory_stocks_tenant_id_site_id_location_id_fkey"
  FOREIGN KEY ("tenant_id", "site_id", "location_id")
  REFERENCES "storage_locations" ("tenant_id", "site_id", "id")
  ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_tenant_id_site_id_location_id_fkey"
  FOREIGN KEY ("tenant_id", "site_id", "location_id")
  REFERENCES "storage_locations" ("tenant_id", "site_id", "id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

DROP INDEX IF EXISTS "inventory_stocks_tenant_id_catalog_item_id_location_id_key";
CREATE UNIQUE INDEX "inventory_stocks_tenant_id_catalog_item_id_site_id_location_id_key"
  ON "inventory_stocks" ("tenant_id", "catalog_item_id", "site_id", "location_id");
CREATE INDEX "inventory_stocks_tenant_id_site_id_idx"
  ON "inventory_stocks" ("tenant_id", "site_id");
CREATE INDEX "inventory_transactions_tenant_id_site_id_idx"
  ON "inventory_transactions" ("tenant_id", "site_id");

COMMIT;
