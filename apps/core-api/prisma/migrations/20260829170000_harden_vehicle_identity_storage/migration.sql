CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE "brands" ADD COLUMN "normalized_name" TEXT;

DO $$
DECLARE
  collision RECORD;
BEGIN
  SELECT
    tenant_id,
    normalized_name,
    string_agg(id::text, ', ' ORDER BY id) AS brand_ids
  INTO collision
  FROM (
    SELECT
      id,
      tenant_id,
      regexp_replace(public.unaccent(upper(name)), '[^A-Z0-9]', '', 'g') AS normalized_name
    FROM brands
  ) AS normalized_brands
  GROUP BY tenant_id, normalized_name
  HAVING count(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot enforce normalized Brand uniqueness for %. Tenant % has colliding brand ids: %',
      collision.normalized_name,
      collision.tenant_id,
      collision.brand_ids;
  END IF;
END $$;

DO $$
DECLARE
  collision RECORD;
BEGIN
  SELECT
    tenant_id,
    NULLIF(upper(btrim(vin)), '') AS normalized_vin,
    string_agg(id::text, ', ' ORDER BY "createdAt", id) AS vehicle_ids
  INTO collision
  FROM vehicles
  WHERE NULLIF(upper(btrim(vin)), '') IS NOT NULL
  GROUP BY tenant_id, NULLIF(upper(btrim(vin)), '')
  HAVING count(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot canonicalize vehicle VIN %. Tenant % has colliding vehicle ids: %',
      collision.normalized_vin,
      collision.tenant_id,
      collision.vehicle_ids;
  END IF;
END $$;

ALTER TABLE "vehicle_purchases" ALTER COLUMN "vin" DROP NOT NULL;

DROP INDEX IF EXISTS "brands_tenant_id_normalized_name_key";
DROP INDEX IF EXISTS "vehicles_tenant_id_vin_normalized_key";
DROP INDEX IF EXISTS "vehicles_vin_key";
DROP INDEX IF EXISTS "vehicles_tenant_id_vin_key";

UPDATE brands
SET normalized_name = regexp_replace(public.unaccent(upper(name)), '[^A-Z0-9]', '', 'g');

UPDATE vehicles
SET vin = NULLIF(upper(btrim(vin)), '')
WHERE vin IS NOT NULL
  AND vin IS DISTINCT FROM NULLIF(upper(btrim(vin)), '');

UPDATE vehicle_purchases
SET vin = NULLIF(upper(btrim(vin)), '')
WHERE vin IS NOT NULL
  AND vin IS DISTINCT FROM NULLIF(upper(btrim(vin)), '');

ALTER TABLE "brands" ALTER COLUMN "normalized_name" SET NOT NULL;

CREATE UNIQUE INDEX "brands_tenant_id_normalized_name_key"
  ON "brands" (tenant_id, normalized_name);

CREATE INDEX "vehicles_tenant_id_vin_idx"
  ON "vehicles" (tenant_id, vin);

CREATE UNIQUE INDEX "vehicles_tenant_id_vin_normalized_key"
  ON "vehicles" (tenant_id, vin)
  WHERE vin IS NOT NULL;