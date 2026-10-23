-- Expand-only: normalised plate for global search (AUT-662).
-- Backfill must equal normalizePlate() in src/vehicle/vehicle-plate.util.ts:
-- strip space, tab, line breaks, NBSP, BOM, hyphens and dots, upper-case, empty becomes NULL.
ALTER TABLE "vehicles" ADD COLUMN "plate_normalized" TEXT;

UPDATE "vehicles"
SET "plate_normalized" = NULLIF(UPPER(REGEXP_REPLACE("plate", '[ \t\n\r\f\v\u00a0\ufeff.-]+', '', 'g')), '')
WHERE "plate" IS NOT NULL;

-- CreateIndex
CREATE INDEX "vehicles_tenant_id_plate_normalized_idx" ON "vehicles"("tenant_id", "plate_normalized");
