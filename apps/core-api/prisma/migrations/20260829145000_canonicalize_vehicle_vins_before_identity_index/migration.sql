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

DROP INDEX IF EXISTS "vehicles_vin_key";
DROP INDEX IF EXISTS "vehicles_tenant_id_vin_key";

ALTER TABLE "vehicle_purchases" ALTER COLUMN "vin" DROP NOT NULL;

UPDATE vehicles
SET vin = NULLIF(upper(btrim(vin)), '')
WHERE vin IS NOT NULL
  AND vin IS DISTINCT FROM NULLIF(upper(btrim(vin)), '');

UPDATE vehicle_purchases
SET vin = NULLIF(upper(btrim(vin)), '')
WHERE vin IS NOT NULL
  AND vin IS DISTINCT FROM NULLIF(upper(btrim(vin)), '');