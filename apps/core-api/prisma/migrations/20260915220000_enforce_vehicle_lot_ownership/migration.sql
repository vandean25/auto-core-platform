-- Derive parked dealer vehicle site from its vehicle lot and enforce the
-- tenant/site/location relationship at the database boundary.
ALTER TABLE "vehicles" ADD COLUMN "site_id" TEXT;

UPDATE "vehicles" AS v
SET "site_id" = sl."site_id"
FROM "storage_locations" AS sl
WHERE v."location_id" IS NOT NULL
  AND sl."tenant_id" = v."tenant_id"
  AND sl."id" = v."location_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "vehicles"
    WHERE "stock_status" = 'ON_ORDER'
  ) THEN
    RAISE EXCEPTION 'Cannot enforce vehicle lot ownership while persisted ON_ORDER vehicles exist';
  END IF;
END $$;

DO $$
DECLARE
  parked RECORD;
  main_site_id TEXT;
  lot_id TEXT;
  warehouse_id TEXT;
BEGIN
  FOR parked IN
    SELECT v."id", v."tenant_id"
    FROM "vehicles" AS v
    LEFT JOIN "storage_locations" AS sl
      ON sl."tenant_id" = v."tenant_id" AND sl."id" = v."location_id"
    WHERE v."inventory_role" IN ('USED', 'NEW', 'DEMO')
      AND v."stock_status" IN ('IN_STOCK', 'RESERVED', 'IN_PREP')
      AND (sl."id" IS NULL OR sl."type" <> 'vehicle_lot')
  LOOP
    SELECT s."id"
    INTO main_site_id
    FROM "sites" AS s
    WHERE s."tenant_id" = parked."tenant_id" AND s."code" = 'MAIN'
    LIMIT 1;

    IF main_site_id IS NULL THEN
      RAISE EXCEPTION 'No MAIN site exists for tenant %', parked."tenant_id";
    END IF;

    SELECT sl."id"
    INTO lot_id
    FROM "storage_locations" AS sl
    WHERE sl."tenant_id" = parked."tenant_id"
      AND sl."site_id" = main_site_id
      AND sl."code" = 'LOT'
      AND sl."type" = 'vehicle_lot'
    LIMIT 1;

    IF lot_id IS NULL THEN
      SELECT sl."id"
      INTO warehouse_id
      FROM "storage_locations" AS sl
      WHERE sl."tenant_id" = parked."tenant_id"
        AND sl."site_id" = main_site_id
        AND sl."type" = 'warehouse'
      ORDER BY sl."is_system" ASC, sl."code" ASC
      LIMIT 1;

      IF warehouse_id IS NULL THEN
        RAISE EXCEPTION 'No MAIN warehouse exists for tenant %', parked."tenant_id";
      END IF;

      lot_id := gen_random_uuid()::TEXT;
      INSERT INTO "storage_locations" (
        "id", "tenant_id", "site_id", "code", "name", "type", "parent_id", "is_system", "createdAt", "updatedAt"
      ) VALUES (
        lot_id, parked."tenant_id", main_site_id, 'LOT', 'Vehicle lot', 'vehicle_lot', warehouse_id, false, NOW(), NOW()
      );
    END IF;

    UPDATE "vehicles"
    SET "site_id" = main_site_id, "location_id" = lot_id
    WHERE "id" = parked."id";
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "vehicles" AS v
    LEFT JOIN "storage_locations" AS sl
      ON sl."tenant_id" = v."tenant_id" AND sl."site_id" = v."site_id" AND sl."id" = v."location_id"
    WHERE v."inventory_role" IN ('USED', 'NEW', 'DEMO')
      AND v."stock_status" IN ('IN_STOCK', 'RESERVED', 'IN_PREP')
      AND (v."site_id" IS NULL OR v."location_id" IS NULL OR sl."type" <> 'vehicle_lot')
  ) THEN
    RAISE EXCEPTION 'Invalid parked dealer vehicle lot ownership remains';
  END IF;
END $$;

CREATE INDEX "vehicles_tenant_id_site_id_idx" ON "vehicles"("tenant_id", "site_id");

ALTER TABLE "vehicles"
ADD CONSTRAINT "vehicles_tenant_id_site_id_location_id_fkey"
FOREIGN KEY ("tenant_id", "site_id", "location_id")
REFERENCES "storage_locations"("tenant_id", "site_id", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
