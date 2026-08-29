DO $$
DECLARE
  collision RECORD;
BEGIN
  SELECT
    tenant_id,
    upper(btrim(vin)) AS normalized_vin,
    string_agg(id::text, ', ' ORDER BY "createdAt", id) AS vehicle_ids
  INTO collision
  FROM vehicles
  WHERE vin IS NOT NULL
  GROUP BY tenant_id, upper(btrim(vin))
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

DO $$
DECLARE
  collision RECORD;
BEGIN
  SELECT
    tenant_id,
    upper(btrim(name)) AS normalized_name,
    string_agg(id::text, ', ' ORDER BY id) AS brand_ids
  INTO collision
  FROM brands
  GROUP BY tenant_id, upper(btrim(name))
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

UPDATE vehicles
SET vin = upper(btrim(vin))
WHERE vin IS NOT NULL
  AND vin IS DISTINCT FROM upper(btrim(vin));

CREATE UNIQUE INDEX "vehicles_tenant_id_vin_normalized_key"
  ON vehicles (tenant_id, upper(btrim(vin)))
  WHERE vin IS NOT NULL;

CREATE UNIQUE INDEX "brands_tenant_id_normalized_name_key"
  ON brands (tenant_id, upper(btrim(name)));
