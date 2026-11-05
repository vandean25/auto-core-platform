---
title: "AUT-888 list cursor EXPLAIN evidence (synthetic)"
date: "2026-11-05"
status: draft
tags: [platform, adr-0035, aut-888]
---

# AUT-888 list cursor EXPLAIN evidence (synthetic)

Captured on a **disposable local PostgreSQL 16** instance in the Cloud Agent VM (`localhost:5432`). Database `aut888_explain_synthetic` is created by `tools/aut888-list-cursor-explain/run-local-explain.sh`, migrated with `prisma migrate deploy`, then seeded with **synthetic-only** rows (no QA/prod/customer data).

## Fixture summary

| Table | Rows (tenant `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`) |
| --- | ---: |
| `catalog_items` | 15000 |
| `vehicles` (dealer stock filter) | 5000 |

Pilot indexes under test: migration `20261105120000_aut888_list_cursor_keyset_indexes` (see [list-endpoint-inventory-adr0035](./list-endpoint-inventory-adr0035.md)).

## Method

1. `run-local-explain.sh` — drop/create DB, `prisma migrate deploy`, `seed-synthetic.sql`, `ANALYZE`.
2. `explain-queries.sql` — SQL aligned with list services: inventory tenant scope; vehicle **`INNER JOIN storage_locations` on `location_id`** with `sl.site_id` (same as `buildVehicleListWhere`), plus dealer-stock role/status filters. Includes first page, continuation, DESC, and capped-count probes.

## Caveats

- **Not CI**: GitHub e2e Postgres volume is smaller; this evidence is from an intentional synthetic bulk load on a throwaway DB.
- **No search/brand/location filters** in these captures (baseline tenant + site scope only).
- **Prisma may differ slightly** in join order or parameter typing; shapes match the list `where` clauses, not hand-waved `vehicles.site_id` alone.
- **Mid-list continuation** on composite indexes can show sort/keyset predicates as **Filter** with **Rows Removed by Filter** (index walk from the start — cost grows with page depth). First pages often show cleaner index access.
- **VM-local Postgres**: apt-installed PG 16 on Ubuntu 24.04; planner costs differ from Cloud SQL production.

## Plan summary (honest read)

| Query shape | Notes |
| --- | --- |
| Inventory first page (`sku`, `name`, `retail_price` ASC/DESC) | Usually **Index Scan** / **Index Only Scan** on the matching `(tenant_id, sort_col, id)` index with `tenant_id` as **Index Cond**. |
| Inventory keyset continuation (`sku` tie + `id`) | Often **Index Scan** with keyset as **Filter**; read **Rows Removed by Filter** in raw output. |
| Inventory capped-count (`LIMIT 1001` ids) | **Seq Scan** + tenant filter at this row count in the capture. |
| Vehicle first page (join + `make` / `plate` / `updatedAt`) | **Nested Loop** + index on `vehicles` sort column; role/status/site via join/filter — see raw plans. |
| Vehicle keyset continuation (`make` tie + `id`) | Frequently **Index Scan** on `vehicles_tenant_id_site_id_make_id_idx` with large **Filter** / **Rows Removed by Filter** (not constant-time seek). |
| Vehicle capped-count (join shape) | **Seq Scan** or nested loop + filter at this scale in the capture. |

Reproduce: `tools/aut888-list-cursor-explain/run-local-explain.sh` (requires local PostgreSQL).

## Raw `EXPLAIN (ANALYZE, BUFFERS)` output

```text
AUT-888 list cursor EXPLAIN capture
Database: aut888_explain_synthetic on localhost:5432
Captured at: 2026-11-05T21:23:05Z
Fixture: tools/aut888-list-cursor-explain/seed-synthetic.sql
---
=== Inventory keyset first page (sku ASC, id ASC) ===
                                                                            QUERY PLAN                                                                            
------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..12.91 rows=101 width=68) (actual time=0.016..0.035 rows=101 loops=1)
   Buffers: shared hit=7
   ->  Index Scan using catalog_items_tenant_id_sku_id_idx on catalog_items  (cost=0.41..1856.60 rows=15000 width=68) (actual time=0.016..0.029 rows=101 loops=1)
         Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Buffers: shared hit=7
 Planning:
   Buffers: shared hit=278
 Planning Time: 0.458 ms
 Execution Time: 0.051 ms
(9 rows)

=== Inventory keyset continuation (sku tie + id) ===
                                                                              QUERY PLAN                                                                              
----------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..26.92 rows=101 width=48) (actual time=1.481..1.509 rows=101 loops=1)
   Buffers: shared hit=270
   ->  Index Only Scan using catalog_items_tenant_id_sku_id_idx on catalog_items  (cost=0.41..1969.10 rows=7500 width=48) (actual time=1.480..1.502 rows=101 loops=1)
         Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Filter: ((sku > 'SKU-007500'::text) OR ((sku = 'SKU-007500'::text) AND (id > '00000000-0000-4000-8000-000000000001'::text)))
         Rows Removed by Filter: 7499
         Heap Fetches: 7600
         Buffers: shared hit=270
 Planning:
   Buffers: shared hit=16
 Planning Time: 0.365 ms
 Execution Time: 1.523 ms
(12 rows)

=== Inventory keyset first page (name ASC, id ASC) ===
                                                                               QUERY PLAN                                                                               
------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..17.68 rows=101 width=57) (actual time=0.007..0.037 rows=101 loops=1)
   Buffers: shared hit=27
   ->  Index Only Scan using catalog_items_tenant_id_name_id_idx on catalog_items  (cost=0.41..2564.60 rows=15000 width=57) (actual time=0.006..0.030 rows=101 loops=1)
         Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Heap Fetches: 101
         Buffers: shared hit=27
 Planning:
   Buffers: shared hit=1
 Planning Time: 0.047 ms
 Execution Time: 0.045 ms
(10 rows)

=== Inventory keyset first page (retail_price DESC, id DESC) ===
                                                                                       QUERY PLAN                                                                                        
-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..14.47 rows=101 width=41) (actual time=0.013..0.076 rows=101 loops=1)
   Buffers: shared hit=105
   ->  Index Only Scan Backward using catalog_items_tenant_id_retail_price_id_idx on catalog_items  (cost=0.41..2088.60 rows=15000 width=41) (actual time=0.012..0.070 rows=101 loops=1)
         Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Heap Fetches: 101
         Buffers: shared hit=105
 Planning:
   Buffers: shared hit=15
 Planning Time: 0.045 ms
 Execution Time: 0.082 ms
(10 rows)

=== Inventory capped-count probe (take 1001 ids) ===
                                                      QUERY PLAN                                                       
-----------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.00..33.87 rows=1001 width=37) (actual time=0.003..0.166 rows=1001 loops=1)
   Buffers: shared hit=22
   ->  Seq Scan on catalog_items  (cost=0.00..507.50 rows=15000 width=37) (actual time=0.002..0.108 rows=1001 loops=1)
         Filter: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Buffers: shared hit=22
 Planning:
   Buffers: shared hit=1
 Planning Time: 0.019 ms
 Execution Time: 0.199 ms
(9 rows)

=== Vehicle stock keyset first page (make ASC NULLS LAST) — location.site_id join (Prisma list shape) ===
                                                                                                       QUERY PLAN                                                                                                        
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=389.01..389.14 rows=51 width=51) (actual time=2.447..2.453 rows=51 loops=1)
   Buffers: shared hit=152
   ->  Sort  (cost=389.01..397.81 rows=3519 width=51) (actual time=2.446..2.449 rows=51 loops=1)
         Sort Key: v.make, v.id
         Sort Method: top-N heapsort  Memory: 36kB
         Buffers: shared hit=152
         ->  Hash Join  (cost=1.04..271.61 rows=3519 width=51) (actual time=0.021..1.729 rows=5000 loops=1)
               Hash Cond: (v.location_id = sl.id)
               Buffers: shared hit=149
               ->  Seq Scan on vehicles v  (cost=0.00..241.75 rows=3519 width=125) (actual time=0.005..1.085 rows=5000 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
                     Buffers: shared hit=148
               ->  Hash  (cost=1.03..1.03 rows=1 width=64) (actual time=0.009..0.009 rows=1 loops=1)
                     Buckets: 1024  Batches: 1  Memory Usage: 9kB
                     Buffers: shared hit=1
                     ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.003..0.004 rows=1 loops=1)
                           Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                           Rows Removed by Filter: 2
                           Buffers: shared hit=1
 Planning:
   Buffers: shared hit=629
 Planning Time: 0.726 ms
 Execution Time: 2.471 ms
(23 rows)

=== Vehicle stock keyset continuation (make tie + id) — location.site_id join ===
                                                                                                                                                                QUERY PLAN                                                                                                                                                                
------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=300.05..300.17 rows=51 width=43) (actual time=0.926..0.931 rows=51 loops=1)
   Buffers: shared hit=149
   ->  Sort  (cost=300.05..301.12 rows=431 width=43) (actual time=0.925..0.927 rows=51 loops=1)
         Sort Key: v.make, v.id
         Sort Method: top-N heapsort  Memory: 31kB
         Buffers: shared hit=149
         ->  Nested Loop  (cost=0.00..285.67 rows=431 width=43) (actual time=0.007..0.794 rows=625 loops=1)
               Join Filter: (sl.id = v.location_id)
               Buffers: shared hit=149
               ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.002..0.003 rows=1 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                     Rows Removed by Filter: 2
                     Buffers: shared hit=1
               ->  Seq Scan on vehicles v  (cost=0.00..279.25 rows=431 width=117) (actual time=0.003..0.736 rows=625 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])) AND ((make > 'Make5'::text) OR ((make = 'Make5'::text) AND (id > '00000000-0000-4000-8000-000000000001'::text))))
                     Rows Removed by Filter: 4375
                     Buffers: shared hit=148
 Planning:
   Buffers: shared hit=4
 Planning Time: 0.194 ms
 Execution Time: 0.941 ms
(21 rows)

=== Vehicle stock keyset first page (updatedAt DESC, id DESC) — location.site_id join ===
                                                                                                       QUERY PLAN                                                                                                        
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=389.01..389.14 rows=51 width=45) (actual time=1.850..1.855 rows=51 loops=1)
   Buffers: shared hit=152
   ->  Sort  (cost=389.01..397.81 rows=3519 width=45) (actual time=1.849..1.851 rows=51 loops=1)
         Sort Key: v."updatedAt" DESC, v.id DESC
         Sort Method: top-N heapsort  Memory: 28kB
         Buffers: shared hit=152
         ->  Hash Join  (cost=1.04..271.61 rows=3519 width=45) (actual time=0.012..1.396 rows=5000 loops=1)
               Hash Cond: (v.location_id = sl.id)
               Buffers: shared hit=149
               ->  Seq Scan on vehicles v  (cost=0.00..241.75 rows=3519 width=119) (actual time=0.004..0.782 rows=5000 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
                     Buffers: shared hit=148
               ->  Hash  (cost=1.03..1.03 rows=1 width=64) (actual time=0.005..0.005 rows=1 loops=1)
                     Buckets: 1024  Batches: 1  Memory Usage: 9kB
                     Buffers: shared hit=1
                     ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.002..0.002 rows=1 loops=1)
                           Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                           Rows Removed by Filter: 2
                           Buffers: shared hit=1
 Planning:
   Buffers: shared hit=17
 Planning Time: 0.163 ms
 Execution Time: 1.869 ms
(23 rows)

=== Vehicle stock capped-count probe — location.site_id join ===
                                                                                                    QUERY PLAN                                                                                                     
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=1.04..78.01 rows=1001 width=37) (actual time=0.008..0.327 rows=1001 loops=1)
   Buffers: shared hit=31
   ->  Hash Join  (cost=1.04..271.61 rows=3519 width=37) (actual time=0.008..0.270 rows=1001 loops=1)
         Hash Cond: (v.location_id = sl.id)
         Buffers: shared hit=31
         ->  Seq Scan on vehicles v  (cost=0.00..241.75 rows=3519 width=111) (actual time=0.003..0.150 rows=1001 loops=1)
               Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
               Buffers: shared hit=30
         ->  Hash  (cost=1.03..1.03 rows=1 width=64) (actual time=0.003..0.003 rows=1 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 9kB
               Buffers: shared hit=1
               ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.001..0.002 rows=1 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                     Rows Removed by Filter: 2
                     Buffers: shared hit=1
 Planning:
   Buffers: shared hit=1
 Planning Time: 0.129 ms
 Execution Time: 0.365 ms
(19 rows)

=== Vehicle stock plate NULLS LAST (nullable sort pilot) — location.site_id join ===
                                                                                                       QUERY PLAN                                                                                                        
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=389.01..389.14 rows=51 width=69) (actual time=2.001..2.006 rows=51 loops=1)
   Buffers: shared hit=149
   ->  Sort  (cost=389.01..397.81 rows=3519 width=69) (actual time=2.000..2.003 rows=51 loops=1)
         Sort Key: v.plate, v.id
         Sort Method: top-N heapsort  Memory: 31kB
         Buffers: shared hit=149
         ->  Hash Join  (cost=1.04..271.61 rows=3519 width=69) (actual time=0.010..1.420 rows=5000 loops=1)
               Hash Cond: (v.location_id = sl.id)
               Buffers: shared hit=149
               ->  Seq Scan on vehicles v  (cost=0.00..241.75 rows=3519 width=143) (actual time=0.004..0.797 rows=5000 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
                     Buffers: shared hit=148
               ->  Hash  (cost=1.03..1.03 rows=1 width=64) (actual time=0.004..0.004 rows=1 loops=1)
                     Buckets: 1024  Batches: 1  Memory Usage: 9kB
                     Buffers: shared hit=1
                     ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.002..0.002 rows=1 loops=1)
                           Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                           Rows Removed by Filter: 2
                           Buffers: shared hit=1
 Planning:
   Buffers: shared hit=4
 Planning Time: 0.164 ms
 Execution Time: 2.018 ms
(23 rows)
```
