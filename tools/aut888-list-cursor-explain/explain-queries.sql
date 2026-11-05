\set tenant_id 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set site_id 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

\echo '=== Inventory keyset page (sku ASC, id ASC) — index catalog_items_tenant_id_sku_id_idx ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, sku, name
FROM catalog_items
WHERE tenant_id = :'tenant_id'
ORDER BY sku ASC, id ASC
LIMIT 101;

\echo '=== Inventory capped-count probe (take 1001 ids) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id
FROM catalog_items
WHERE tenant_id = :'tenant_id'
LIMIT 1001;

\echo '=== Inventory keyset page (retail_price ASC) — index catalog_items_tenant_id_retail_price_id_idx ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, retail_price
FROM catalog_items
WHERE tenant_id = :'tenant_id'
ORDER BY retail_price ASC, id ASC
LIMIT 101;

\echo '=== Vehicle stock keyset page (make ASC NULLS LAST, id ASC) — index vehicles_tenant_id_site_id_make_id_idx ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT v.id, v.make, v.model
FROM vehicles v
WHERE v.tenant_id = :'tenant_id'
  AND v.site_id = :'site_id'
  AND v.inventory_role IN ('USED', 'NEW', 'DEMO')
  AND v.stock_status = 'IN_STOCK'
ORDER BY v.make ASC NULLS LAST, v.id ASC
LIMIT 51;

\echo '=== Vehicle stock keyset continuation (make = Make5, id > sentinel) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT v.id, v.make
FROM vehicles v
WHERE v.tenant_id = :'tenant_id'
  AND v.site_id = :'site_id'
  AND v.inventory_role IN ('USED', 'NEW', 'DEMO')
  AND v.stock_status = 'IN_STOCK'
  AND (
    v.make > 'Make5'
    OR (v.make = 'Make5' AND v.id > '00000000-0000-4000-8000-000000000001')
  )
ORDER BY v.make ASC NULLS LAST, v.id ASC
LIMIT 51;

\echo '=== Vehicle stock capped-count probe ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT v.id
FROM vehicles v
WHERE v.tenant_id = :'tenant_id'
  AND v.site_id = :'site_id'
  AND v.inventory_role IN ('USED', 'NEW', 'DEMO')
  AND v.stock_status = 'IN_STOCK'
LIMIT 1001;

\echo '=== Vehicle stock plate NULLS LAST (nullable sort pilot) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT v.id, v.plate
FROM vehicles v
WHERE v.tenant_id = :'tenant_id'
  AND v.site_id = :'site_id'
  AND v.inventory_role IN ('USED', 'NEW', 'DEMO')
  AND v.stock_status = 'IN_STOCK'
ORDER BY v.plate ASC NULLS LAST, v.id ASC
LIMIT 51;
