-- Expand-only: normalised plate for global search (AUT-662).
-- Backfill must equal normalizePlate() in src/vehicle/vehicle-plate.util.ts:
-- strip whitespace, hyphens and dots, upper-case, empty becomes NULL.
ALTER TABLE "vehicles" ADD COLUMN "plate_normalized" TEXT;

UPDATE "vehicles"
SET "plate_normalized" = NULLIF(UPPER(REGEXP_REPLACE("plate", '[[:space:].-]+', '', 'g')), '')
WHERE "plate" IS NOT NULL;

-- CreateIndex
CREATE INDEX "vehicles_tenant_id_plate_normalized_idx" ON "vehicles"("tenant_id", "plate_normalized");
