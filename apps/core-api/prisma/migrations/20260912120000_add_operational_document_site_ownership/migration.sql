-- Add nullable persisted site ownership to operational documents:
-- sales_orders, purchase_orders, vehicle_purchases, vehicle_sales.

ALTER TABLE "sales_orders" ADD COLUMN "site_id" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "site_id" TEXT;
ALTER TABLE "vehicle_purchases" ADD COLUMN "site_id" TEXT;
ALTER TABLE "vehicle_sales" ADD COLUMN "site_id" TEXT;

-- Backfill site_id for existing rows from tenant MAIN site
UPDATE "sales_orders" AS so
SET "site_id" = s."id"
FROM "sites" AS s
WHERE so."site_id" IS NULL
  AND s."tenant_id" = so."tenant_id"
  AND s."code" = 'MAIN';

UPDATE "purchase_orders" AS po
SET "site_id" = s."id"
FROM "sites" AS s
WHERE po."site_id" IS NULL
  AND s."tenant_id" = po."tenant_id"
  AND s."code" = 'MAIN';

-- For vehicle purchases with an existing lot location, prefer that location's site, else MAIN
UPDATE "vehicle_purchases" AS vp
SET "site_id" = sl."site_id"
FROM "storage_locations" AS sl
WHERE vp."site_id" IS NULL
  AND vp."location_id" IS NOT NULL
  AND sl."tenant_id" = vp."tenant_id"
  AND sl."id" = vp."location_id";

UPDATE "vehicle_purchases" AS vp
SET "site_id" = s."id"
FROM "sites" AS s
WHERE vp."site_id" IS NULL
  AND s."tenant_id" = vp."tenant_id"
  AND s."code" = 'MAIN';

-- For vehicle sales, if vehicle has a lot location, prefer that location's site, else MAIN
UPDATE "vehicle_sales" AS vs
SET "site_id" = sl."site_id"
FROM "vehicles" AS v
JOIN "storage_locations" AS sl ON sl."id" = v."location_id" AND sl."tenant_id" = v."tenant_id"
WHERE vs."site_id" IS NULL
  AND v."id" = vs."vehicle_id"
  AND v."tenant_id" = vs."tenant_id";

UPDATE "vehicle_sales" AS vs
SET "site_id" = s."id"
FROM "sites" AS s
WHERE vs."site_id" IS NULL
  AND s."tenant_id" = vs."tenant_id"
  AND s."code" = 'MAIN';

-- In case any workshop orders still have null site_id, backfill to MAIN
UPDATE "workshop_orders" AS wo
SET "site_id" = s."id"
FROM "sites" AS s
WHERE wo."site_id" IS NULL
  AND s."tenant_id" = wo."tenant_id"
  AND s."code" = 'MAIN';

-- Create indexes
CREATE INDEX "sales_orders_tenant_id_site_id_idx" ON "sales_orders"("tenant_id", "site_id");
CREATE INDEX "purchase_orders_tenant_id_site_id_idx" ON "purchase_orders"("tenant_id", "site_id");
CREATE INDEX "vehicle_purchases_tenant_id_site_id_idx" ON "vehicle_purchases"("tenant_id", "site_id");
CREATE INDEX "vehicle_sales_tenant_id_site_id_idx" ON "vehicle_sales"("tenant_id", "site_id");

-- Foreign key constraints
ALTER TABLE "sales_orders"
ADD CONSTRAINT "sales_orders_tenant_id_site_id_fkey"
FOREIGN KEY ("tenant_id", "site_id")
REFERENCES "sites"("tenant_id", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "purchase_orders"
ADD CONSTRAINT "purchase_orders_tenant_id_site_id_fkey"
FOREIGN KEY ("tenant_id", "site_id")
REFERENCES "sites"("tenant_id", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "vehicle_purchases"
ADD CONSTRAINT "vehicle_purchases_tenant_id_site_id_fkey"
FOREIGN KEY ("tenant_id", "site_id")
REFERENCES "sites"("tenant_id", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "vehicle_sales"
ADD CONSTRAINT "vehicle_sales_tenant_id_site_id_fkey"
FOREIGN KEY ("tenant_id", "site_id")
REFERENCES "sites"("tenant_id", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
