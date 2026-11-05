\set tenant_id 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set site_id 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

\echo '=== Inventory keyset first page (sku ASC, id ASC) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, sku, name
FROM catalog_items
WHERE tenant_id = :'tenant_id'
ORDER BY sku ASC, id ASC
LIMIT 101;

\echo '=== Inventory keyset continuation (sku tie + id) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, sku
FROM catalog_items
WHERE tenant_id = :'tenant_id'
  AND (
    sku > 'SKU-007500'
    OR (sku = 'SKU-007500' AND id > '00000000-0000-4000-8000-000000000001')
  )
ORDER BY sku ASC, id ASC
LIMIT 101;

\echo '=== Inventory keyset first page (name ASC, id ASC) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, name
FROM catalog_items
WHERE tenant_id = :'tenant_id'
ORDER BY name ASC, id ASC
LIMIT 101;

\echo '=== Inventory keyset first page (retail_price DESC, id DESC) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, retail_price
FROM catalog_items
WHERE tenant_id = :'tenant_id'
ORDER BY retail_price DESC, id DESC
LIMIT 101;

\echo '=== Inventory capped-count probe (take 1001 ids) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id
FROM catalog_items
WHERE tenant_id = :'tenant_id'
LIMIT 1001;

\echo '=== Vehicle stock keyset first page (make ASC NULLS LAST) — location.site_id join (Prisma list shape) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT v.id, v.make, v.model
FROM vehicles v
INNER JOIN storage_locations sl
  ON sl.id = v.location_id AND sl.tenant_id = v.tenant_id
WHERE v.tenant_id = :'tenant_id'
  AND v.site_id = :'site_id'
  AND sl.site_id = :'site_id'
  AND v.inventory_role IN ('USED', 'NEW', 'DEMO')
  AND v.stock_status = 'IN_STOCK'
ORDER BY v.make ASC NULLS LAST, v.id ASC
LIMIT 51;

\echo '=== Vehicle stock keyset continuation (make tie + id) — location.site_id join ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT v.id, v.make
FROM vehicles v
INNER JOIN storage_locations sl
  ON sl.id = v.location_id AND sl.tenant_id = v.tenant_id
WHERE v.tenant_id = :'tenant_id'
  AND v.site_id = :'site_id'
  AND sl.site_id = :'site_id'
  AND v.inventory_role IN ('USED', 'NEW', 'DEMO')
  AND v.stock_status = 'IN_STOCK'
  AND (
    v.make > 'Make5'
    OR (v.make = 'Make5' AND v.id > '00000000-0000-4000-8000-000000000001')
  )
ORDER BY v.make ASC NULLS LAST, v.id ASC
LIMIT 51;

\echo '=== Vehicle stock keyset first page (updatedAt DESC, id DESC) — location.site_id join ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT v.id, v."updatedAt"
FROM vehicles v
INNER JOIN storage_locations sl
  ON sl.id = v.location_id AND sl.tenant_id = v.tenant_id
WHERE v.tenant_id = :'tenant_id'
  AND v.site_id = :'site_id'
  AND sl.site_id = :'site_id'
  AND v.inventory_role IN ('USED', 'NEW', 'DEMO')
  AND v.stock_status = 'IN_STOCK'
ORDER BY v."updatedAt" DESC, v.id DESC
LIMIT 51;

\echo '=== Vehicle stock capped-count probe — location.site_id join ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT v.id
FROM vehicles v
INNER JOIN storage_locations sl
  ON sl.id = v.location_id AND sl.tenant_id = v.tenant_id
WHERE v.tenant_id = :'tenant_id'
  AND v.site_id = :'site_id'
  AND sl.site_id = :'site_id'
  AND v.inventory_role IN ('USED', 'NEW', 'DEMO')
  AND v.stock_status = 'IN_STOCK'
LIMIT 1001;

\echo '=== Vehicle stock plate NULLS LAST (nullable sort pilot) — location.site_id join ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT v.id, v.plate
FROM vehicles v
INNER JOIN storage_locations sl
  ON sl.id = v.location_id AND sl.tenant_id = v.tenant_id
WHERE v.tenant_id = :'tenant_id'
  AND v.site_id = :'site_id'
  AND sl.site_id = :'site_id'
  AND v.inventory_role IN ('USED', 'NEW', 'DEMO')
  AND v.stock_status = 'IN_STOCK'
ORDER BY v.plate ASC NULLS LAST, v.id ASC
LIMIT 51;
