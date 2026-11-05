---
title: "AUT-888 list cursor EXPLAIN evidence (synthetic)"
date: "2026-11-05"
status: draft
tags: [platform, adr-0035, aut-888]
---

# AUT-888 list cursor EXPLAIN evidence (synthetic)

Captured on a **disposable local PostgreSQL 16** instance on a **local VM** (`localhost:5432`). Database `aut888_explain_synthetic` is created by `tools/aut888-list-cursor-explain/run-local-explain.sh`, migrated with `prisma migrate deploy`, then seeded with **synthetic-only** rows (no QA/prod/customer data).

## Fixture summary

| Table | Rows (tenant `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`) |
| --- | ---: |
| `catalog_items` | 15000 |
| `vehicles` (dealer stock filter) | 5000 |

Pilot indexes under test: migration `20261105120000_aut888_list_cursor_keyset_indexes` (see [list-endpoint-inventory-adr0035](./list-endpoint-inventory-adr0035.md)).

## Method

1. `run-local-explain.sh` — drop/create DB, `prisma migrate deploy`, `seed-synthetic.sql`, `ANALYZE`.
2. `explain-queries.sql` — SQL aligned with list services: inventory tenant scope; vehicle **`vehicles.site_id`** plus **`INNER JOIN storage_locations` on `location_id`** with matching `sl.site_id` (same as `buildVehicleListWhere`), plus dealer-stock role/status filters. Includes first page, continuation, DESC, and capped-count probes.

## Caveats

- **Not CI**: GitHub e2e Postgres volume is smaller; this evidence is from an intentional synthetic bulk load on a throwaway DB.
- **No search/brand/location filters** in these captures (baseline tenant + site scope only).
- **Prisma may differ slightly** in join order or parameter typing; shapes match the list `where` clauses (`vehicles.site_id` and location join).
- **Mid-list continuation** on composite indexes can show sort/keyset predicates as **Filter** with **Rows Removed by Filter** (index walk from the start — cost grows with page depth). First pages often show cleaner index access on the pilot `(tenant_id, site_id, sort_col, id)` indexes.
- **VM-local Postgres**: apt-installed PG 16 on Ubuntu 24.04; planner costs differ from Cloud SQL production.

## Plan summary (honest read)

| Query shape | Notes |
| --- | --- |
| Inventory first page (`sku`, `name`, `retail_price` ASC/DESC) | Usually **Index Scan** / **Index Only Scan** on the matching `(tenant_id, sort_col, id)` index with `tenant_id` as **Index Cond**. |
| Inventory keyset continuation (`sku` tie + `id`) | Often **Index Scan** with keyset as **Filter**; read **Rows Removed by Filter** in raw output. |
| Inventory capped-count (`LIMIT 1001` ids) | **Seq Scan** + tenant filter at this row count in the capture. |
| Vehicle first page (join + `make` / `plate` / `updatedAt`) | **Index Scan** on `vehicles_tenant_id_site_id_<sort>_id_idx` with `(tenant_id, site_id)` as **Index Cond**; role/status as **Filter**; nested loop to `storage_locations` for join shape. |
| Vehicle keyset continuation (`make` tie + `id`) | Frequently **Index Scan** on `vehicles_tenant_id_site_id_make_id_idx` with large **Filter** / **Rows Removed by Filter** (not constant-time seek). |
| Vehicle capped-count (join shape) | **Seq Scan** or nested loop + filter at this scale in the capture. |

Reproduce: `tools/aut888-list-cursor-explain/run-local-explain.sh` (requires local PostgreSQL).

## Raw `EXPLAIN (ANALYZE, BUFFERS)` output

```text
AUT-888 list cursor EXPLAIN capture
Database: aut888_explain_synthetic on localhost:5432
Captured at: 2026-11-05T22:23:16Z
Fixture: tools/aut888-list-cursor-explain/seed-synthetic.sql
---
=== Inventory keyset first page (sku ASC, id ASC) ===
                                                                            QUERY PLAN                                                                            
------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..12.91 rows=101 width=68) (actual time=0.015..0.036 rows=101 loops=1)
   Buffers: shared hit=7
   ->  Index Scan using catalog_items_tenant_id_sku_id_idx on catalog_items  (cost=0.41..1856.60 rows=15000 width=68) (actual time=0.015..0.029 rows=101 loops=1)
         Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Buffers: shared hit=7
 Planning:
   Buffers: shared hit=278
 Planning Time: 0.437 ms
 Execution Time: 0.051 ms
(9 rows)

=== Inventory keyset continuation (sku tie + id) ===
                                                                              QUERY PLAN                                                                              
----------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..26.92 rows=101 width=48) (actual time=1.518..1.545 rows=101 loops=1)
   Buffers: shared hit=270
   ->  Index Only Scan using catalog_items_tenant_id_sku_id_idx on catalog_items  (cost=0.41..1969.10 rows=7500 width=48) (actual time=1.517..1.538 rows=101 loops=1)
         Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Filter: ((sku > 'SKU-007500'::text) OR ((sku = 'SKU-007500'::text) AND (id > '00000000-0000-4000-8000-000000000001'::text)))
         Rows Removed by Filter: 7499
         Heap Fetches: 7600
         Buffers: shared hit=270
 Planning:
   Buffers: shared hit=16
 Planning Time: 0.402 ms
 Execution Time: 1.560 ms
(12 rows)

=== Inventory keyset first page (name ASC, id ASC) ===
                                                                               QUERY PLAN                                                                               
------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..17.68 rows=101 width=57) (actual time=0.007..0.039 rows=101 loops=1)
   Buffers: shared hit=27
   ->  Index Only Scan using catalog_items_tenant_id_name_id_idx on catalog_items  (cost=0.41..2564.60 rows=15000 width=57) (actual time=0.006..0.032 rows=101 loops=1)
         Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Heap Fetches: 101
         Buffers: shared hit=27
 Planning:
   Buffers: shared hit=1
 Planning Time: 0.050 ms
 Execution Time: 0.048 ms
(10 rows)

=== Inventory keyset first page (retail_price DESC, id DESC) ===
                                                                                       QUERY PLAN                                                                                        
-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..14.47 rows=101 width=41) (actual time=0.015..0.082 rows=101 loops=1)
   Buffers: shared hit=106
   ->  Index Only Scan Backward using catalog_items_tenant_id_retail_price_id_idx on catalog_items  (cost=0.41..2088.60 rows=15000 width=41) (actual time=0.015..0.075 rows=101 loops=1)
         Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Heap Fetches: 101
         Buffers: shared hit=106
 Planning:
   Buffers: shared hit=15
 Planning Time: 0.046 ms
 Execution Time: 0.089 ms
(10 rows)

=== Inventory capped-count probe (take 1001 ids) ===
                                                      QUERY PLAN                                                       
-----------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.00..33.87 rows=1001 width=37) (actual time=0.003..0.172 rows=1001 loops=1)
   Buffers: shared hit=22
   ->  Seq Scan on catalog_items  (cost=0.00..507.50 rows=15000 width=37) (actual time=0.003..0.114 rows=1001 loops=1)
         Filter: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Buffers: shared hit=22
 Planning:
   Buffers: shared hit=1
 Planning Time: 0.020 ms
 Execution Time: 0.206 ms
(9 rows)

=== Vehicle stock keyset first page (make ASC NULLS LAST) — location.site_id join (Prisma list shape) ===
                                                                              QUERY PLAN                                                                               
-----------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..15.55 rows=51 width=51) (actual time=0.026..0.158 rows=51 loops=1)
   Buffers: shared hit=56
   ->  Nested Loop  (cost=0.41..1045.41 rows=3519 width=51) (actual time=0.025..0.154 rows=51 loops=1)
         Join Filter: (sl.id = v.location_id)
         Buffers: shared hit=56
         ->  Index Scan using vehicles_tenant_id_site_id_make_id_idx on vehicles v  (cost=0.41..991.60 rows=3519 width=125) (actual time=0.017..0.136 rows=51 loops=1)
               Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
               Filter: ((stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
               Buffers: shared hit=55
         ->  Materialize  (cost=0.00..1.03 rows=1 width=64) (actual time=0.000..0.000 rows=1 loops=51)
               Buffers: shared hit=1
               ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.005..0.005 rows=1 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                     Rows Removed by Filter: 2
                     Buffers: shared hit=1
 Planning:
   Buffers: shared hit=643
 Planning Time: 0.751 ms
 Execution Time: 0.176 ms
(19 rows)

=== Vehicle stock keyset continuation (make tie + id) — location.site_id join ===
                                                                                                                             QUERY PLAN                                                                                                                              
---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..123.02 rows=51 width=43) (actual time=1.553..1.585 rows=51 loops=1)
   Buffers: shared hit=4542
   ->  Nested Loop  (cost=0.41..1036.59 rows=431 width=43) (actual time=1.552..1.582 rows=51 loops=1)
         Join Filter: (sl.id = v.location_id)
         Buffers: shared hit=4542
         ->  Index Scan using vehicles_tenant_id_site_id_make_id_idx on vehicles v  (cost=0.41..1029.10 rows=431 width=117) (actual time=1.543..1.563 rows=51 loops=1)
               Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
               Filter: ((stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])) AND ((make > 'Make5'::text) OR ((make = 'Make5'::text) AND (id > '00000000-0000-4000-8000-000000000001'::text))))
               Rows Removed by Filter: 4375
               Buffers: shared hit=4541
         ->  Materialize  (cost=0.00..1.03 rows=1 width=64) (actual time=0.000..0.000 rows=1 loops=51)
               Buffers: shared hit=1
               ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.004..0.004 rows=1 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                     Rows Removed by Filter: 2
                     Buffers: shared hit=1
 Planning:
   Buffers: shared hit=4
 Planning Time: 0.196 ms
 Execution Time: 1.600 ms
(20 rows)

=== Vehicle stock keyset first page (updatedAt DESC, id DESC) — location.site_id join ===
                                                                                       QUERY PLAN                                                                                       
----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..18.45 rows=51 width=45) (actual time=0.013..0.042 rows=51 loops=1)
   Buffers: shared hit=10
   ->  Nested Loop  (cost=0.41..1245.41 rows=3519 width=45) (actual time=0.013..0.039 rows=51 loops=1)
         Join Filter: (sl.id = v.location_id)
         Buffers: shared hit=10
         ->  Index Scan Backward using "vehicles_tenant_id_site_id_updatedAt_id_idx" on vehicles v  (cost=0.41..1191.60 rows=3519 width=119) (actual time=0.009..0.026 rows=51 loops=1)
               Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
               Filter: ((stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
               Buffers: shared hit=9
         ->  Materialize  (cost=0.00..1.03 rows=1 width=64) (actual time=0.000..0.000 rows=1 loops=51)
               Buffers: shared hit=1
               ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.002..0.002 rows=1 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                     Rows Removed by Filter: 2
                     Buffers: shared hit=1
 Planning:
   Buffers: shared hit=9
 Planning Time: 0.163 ms
 Execution Time: 0.052 ms
(19 rows)

=== Vehicle stock capped-count probe — location.site_id join ===
                                                                                                                                   QUERY PLAN                                                                                                                                   
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=1.04..81.56 rows=1001 width=37) (actual time=0.021..0.369 rows=1001 loops=1)
   Buffers: shared hit=31
   ->  Hash Join  (cost=1.04..284.11 rows=3519 width=37) (actual time=0.021..0.311 rows=1001 loops=1)
         Hash Cond: (v.location_id = sl.id)
         Buffers: shared hit=31
         ->  Seq Scan on vehicles v  (cost=0.00..254.25 rows=3519 width=111) (actual time=0.005..0.181 rows=1001 loops=1)
               Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
               Buffers: shared hit=30
         ->  Hash  (cost=1.03..1.03 rows=1 width=64) (actual time=0.012..0.012 rows=1 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 9kB
               Buffers: shared hit=1
               ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.002..0.002 rows=1 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                     Rows Removed by Filter: 2
                     Buffers: shared hit=1
 Planning:
   Buffers: shared hit=1
 Planning Time: 0.156 ms
 Execution Time: 0.409 ms
(19 rows)

=== Vehicle stock plate NULLS LAST (nullable sort pilot) — location.site_id join ===
                                                                               QUERY PLAN                                                                               
------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..15.32 rows=51 width=69) (actual time=0.012..0.051 rows=51 loops=1)
   Buffers: shared hit=56
   ->  Nested Loop  (cost=0.41..1029.41 rows=3519 width=69) (actual time=0.012..0.048 rows=51 loops=1)
         Join Filter: (sl.id = v.location_id)
         Buffers: shared hit=56
         ->  Index Scan using vehicles_tenant_id_site_id_plate_id_idx on vehicles v  (cost=0.41..975.60 rows=3519 width=143) (actual time=0.008..0.035 rows=51 loops=1)
               Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
               Filter: ((stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
               Buffers: shared hit=55
         ->  Materialize  (cost=0.00..1.03 rows=1 width=64) (actual time=0.000..0.000 rows=1 loops=51)
               Buffers: shared hit=1
               ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.002..0.002 rows=1 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                     Rows Removed by Filter: 2
                     Buffers: shared hit=1
 Planning:
   Buffers: shared hit=4
 Planning Time: 0.148 ms
 Execution Time: 0.060 ms
(19 rows)
```
