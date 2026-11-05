-- Synthetic AUT-888 explain fixture (disposable DB only). No production/QA data.
\set tenant_id 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set site_id 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
\set legal_entity_id 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
\set location_id 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
\set catalog_rows 15000
\set vehicle_rows 5000

INSERT INTO tenants (
  id, name, slug, created_at, updated_at, is_active, is_landing_demo_tenant,
  api_rate_limit_per_minute, default_locale, format_locale
) VALUES (
  :'tenant_id',
  'AUT888 EXPLAIN synthetic',
  'aut888-explain-synthetic-local',
  NOW(),
  NOW(),
  true,
  false,
  60,
  'de',
  'de-AT'
);

INSERT INTO legal_entities (
  id, tenant_id, name, country_iso, is_active, rksv_mode, "createdAt", "updatedAt"
) VALUES (
  :'legal_entity_id',
  :'tenant_id',
  'AUT888 Synthetic Legal Entity',
  'AT',
  true,
  'OFF',
  NOW(),
  NOW()
);

INSERT INTO sites (
  id, tenant_id, legal_entity_id, code, name, is_active, timezone, holiday_country_iso, slot_minutes,
  "createdAt", "updatedAt"
) VALUES (
  :'site_id',
  :'tenant_id',
  :'legal_entity_id',
  'SYN',
  'Synthetic site',
  true,
  'Europe/Vienna',
  'AT',
  30,
  NOW(),
  NOW()
);

INSERT INTO storage_locations (
  id, tenant_id, site_id, code, name, type, is_system, "createdAt", "updatedAt"
) VALUES (
  :'location_id',
  :'tenant_id',
  :'site_id',
  'LOT-1',
  'Synthetic lot',
  'vehicle_lot',
  true,
  NOW(),
  NOW()
);

INSERT INTO catalog_items (
  id, tenant_id, sku, name, retail_price, unit, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  :'tenant_id',
  'SKU-' || lpad(gs::text, 6, '0'),
  'Synthetic part ' || gs,
  (gs % 500)::numeric(10, 2),
  'pcs',
  NOW(),
  NOW()
FROM generate_series(1, :catalog_rows) AS gs;

INSERT INTO vehicles (
  id, tenant_id, site_id, location_id, make, model, year,
  inventory_role, stock_status, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  :'tenant_id',
  :'site_id'::uuid,
  :'location_id'::uuid,
  'Make' || (gs % 40),
  'Model' || (gs % 120),
  2010 + (gs % 15),
  (ARRAY['USED', 'NEW', 'DEMO'])[1 + (gs % 3)]::"VehicleInventoryRole",
  'IN_STOCK'::"VehicleStockStatus",
  NOW() - (gs || ' minutes')::interval,
  NOW() - (gs || ' minutes')::interval
FROM generate_series(1, :vehicle_rows) AS gs;

ANALYZE catalog_items;
ANALYZE vehicles;

SELECT 'catalog_items' AS rel, count(*)::bigint AS rows FROM catalog_items WHERE tenant_id = :'tenant_id'
UNION ALL
SELECT 'vehicles', count(*) FROM vehicles WHERE tenant_id = :'tenant_id';
