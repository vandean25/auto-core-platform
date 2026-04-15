ALTER TYPE "LocationType" ADD VALUE IF NOT EXISTS 'staging_tote';

ALTER TABLE "workshop_orders"
ADD COLUMN "staging_location_id" TEXT;

ALTER TABLE "workshop_orders"
ADD CONSTRAINT "workshop_orders_staging_location_id_fkey"
FOREIGN KEY ("staging_location_id") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_workshop_orders_staging_location_id" ON "workshop_orders"("staging_location_id");
