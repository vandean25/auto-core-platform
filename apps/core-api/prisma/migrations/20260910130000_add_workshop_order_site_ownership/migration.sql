-- Add nullable persisted site ownership so legacy orders can remain fail-closed
-- until their site can be proven from an existing staging location.
ALTER TABLE "workshop_orders"
ADD COLUMN "site_id" TEXT;

-- Only infer ownership from the order's persisted staging location within the
-- same tenant. Orders without a resolvable staging location remain NULL.
UPDATE "workshop_orders" AS wo
SET "site_id" = sl."site_id"
FROM "storage_locations" AS sl
WHERE wo."site_id" IS NULL
  AND wo."staging_location_id" IS NOT NULL
  AND sl."tenant_id" = wo."tenant_id"
  AND sl."id" = wo."staging_location_id";

CREATE INDEX "workshop_orders_tenant_id_site_id_idx"
ON "workshop_orders"("tenant_id", "site_id");

ALTER TABLE "workshop_orders"
ADD CONSTRAINT "workshop_orders_tenant_id_site_id_fkey"
FOREIGN KEY ("tenant_id", "site_id")
REFERENCES "sites"("tenant_id", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
