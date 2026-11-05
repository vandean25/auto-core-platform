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
2. `explain-queries.sql` — SQL shapes aligned with LF 10a pilots (keyset `ORDER BY sort_col, id`, capped-count `LIMIT 1001` id probe, vehicle filters `tenant_id` + `site_id` + `inventory_role IN (USED,NEW,DEMO)` + `stock_status = IN_STOCK`).

## Caveats

- **Not CI**: GitHub e2e Postgres volume is smaller; this evidence is from an intentional synthetic bulk load on a throwaway DB.
- **Single tenant/site**: no concurrent tenants, no search OR filters, no brand/location inventory filters in these plans (baseline selective tenant scope only).
- **VM-local Postgres**: apt-installed PG 16 on Ubuntu 24.04; planner costs differ from Cloud SQL production, but index choice and scan type are what we record honestly below.

## Plan summary (honest read)

| Query shape | Observed access path (15k catalog / 5k vehicles, single tenant) |
| --- | --- |
| Inventory keyset `ORDER BY sku, id` | **Index Scan** on `catalog_items_tenant_id_sku_id_idx` |
| Inventory keyset `ORDER BY retail_price, id` | **Index Only Scan** on `catalog_items_tenant_id_retail_price_id_idx` |
| Inventory capped-count probe (`LIMIT 1001` ids, tenant filter) | **Seq Scan** on `catalog_items` with tenant filter (planner choice at this row count; not index-backed in this capture) |
| Vehicle keyset `ORDER BY make NULLS LAST, id` | **Index Scan** on `vehicles_tenant_id_site_id_make_id_idx` with stock/role filters as residual |
| Vehicle keyset continuation (`make` tie + `id`) | **Index Scan** on `vehicles_tenant_id_site_id_make_id_idx` |
| Vehicle capped-count probe | **Seq Scan** on `vehicles` with filters (same caveat as inventory probe at this scale) |
| Vehicle keyset `ORDER BY plate NULLS LAST, id` | **Index Scan** on `vehicles_tenant_id_site_id_plate_id_idx` |

Reproduce: `tools/aut888-list-cursor-explain/run-local-explain.sh` (requires local PostgreSQL; Cloud Agent VM: `sudo apt-get install postgresql-16` + `sudo pg_ctlcluster 16 main start`).

## Raw `EXPLAIN (ANALYZE, BUFFERS)` output

```text
AUT-888 list cursor EXPLAIN capture
Database: aut888_explain_synthetic on localhost:5432
Captured at: 2026-11-05T20:12:52Z
Fixture: tools/aut888-list-cursor-explain/seed-synthetic.sql
---
=== Inventory keyset page (sku ASC, id ASC) — index catalog_items_tenant_id_sku_id_idx ===
                                                                            QUERY PLAN                                                                            
------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..12.91 rows=101 width=68) (actual time=0.015..0.035 rows=101 loops=1)
   Buffers: shared hit=7
   ->  Index Scan using catalog_items_tenant_id_sku_id_idx on catalog_items  (cost=0.41..1856.60 rows=15000 width=68) (actual time=0.014..0.028 rows=101 loops=1)
         Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Buffers: shared hit=7
 Planning:
   Buffers: shared hit=278
 Planning Time: 0.435 ms
 Execution Time: 0.050 ms
(9 rows)

=== Inventory capped-count probe (take 1001 ids) ===
                                                      QUERY PLAN                                                       
-----------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.00..33.87 rows=1001 width=37) (actual time=0.003..0.207 rows=1001 loops=1)
   Buffers: shared hit=22
   ->  Seq Scan on catalog_items  (cost=0.00..507.50 rows=15000 width=37) (actual time=0.002..0.150 rows=1001 loops=1)
         Filter: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Buffers: shared hit=22
 Planning:
   Buffers: shared hit=1
 Planning Time: 0.029 ms
 Execution Time: 0.242 ms
(9 rows)

=== Inventory keyset page (retail_price ASC) — index catalog_items_tenant_id_retail_price_id_idx ===
                                                                                   QUERY PLAN                                                                                   
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..14.47 rows=101 width=41) (actual time=0.021..0.128 rows=101 loops=1)
   Buffers: shared hit=105
   ->  Index Only Scan using catalog_items_tenant_id_retail_price_id_idx on catalog_items  (cost=0.41..2088.60 rows=15000 width=41) (actual time=0.021..0.121 rows=101 loops=1)
         Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
         Heap Fetches: 101
         Buffers: shared hit=105
 Planning:
   Buffers: shared hit=9
 Planning Time: 0.036 ms
 Execution Time: 0.135 ms
(10 rows)

=== Vehicle stock keyset page (make ASC NULLS LAST, id ASC) — index vehicles_tenant_id_site_id_make_id_idx ===
                                                                           QUERY PLAN                                                                           
----------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..14.71 rows=51 width=51) (actual time=0.018..0.165 rows=51 loops=1)
   Buffers: shared hit=55
   ->  Index Scan using vehicles_tenant_id_site_id_make_id_idx on vehicles v  (cost=0.41..987.60 rows=3519 width=51) (actual time=0.017..0.160 rows=51 loops=1)
         Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
         Filter: ((stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
         Buffers: shared hit=55
 Planning:
   Buffers: shared hit=511
 Planning Time: 0.548 ms
 Execution Time: 0.172 ms
(10 rows)

=== Vehicle stock keyset continuation (make = Make5, id > sentinel) ===
                                                                                                                          QUERY PLAN                                                                                                                           
---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..121.66 rows=51 width=43) (actual time=1.587..1.610 rows=51 loops=1)
   Buffers: shared hit=4538
   ->  Index Scan using vehicles_tenant_id_site_id_make_id_idx on vehicles v  (cost=0.41..1025.10 rows=431 width=43) (actual time=1.586..1.605 rows=51 loops=1)
         Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
         Filter: ((stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])) AND ((make > 'Make5'::text) OR ((make = 'Make5'::text) AND (id > '00000000-0000-4000-8000-000000000001'::text))))
         Rows Removed by Filter: 4375
         Buffers: shared hit=4538
 Planning:
   Buffers: shared hit=7
 Planning Time: 0.167 ms
 Execution Time: 1.621 ms
(11 rows)

=== Vehicle stock capped-count probe ===
                                                                                                                                QUERY PLAN                                                                                                                                
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.00..72.32 rows=1001 width=37) (actual time=0.003..0.223 rows=1001 loops=1)
   Buffers: shared hit=30
   ->  Seq Scan on vehicles v  (cost=0.00..254.25 rows=3519 width=37) (actual time=0.003..0.165 rows=1001 loops=1)
         Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
         Buffers: shared hit=30
 Planning:
   Buffers: shared hit=1
 Planning Time: 0.076 ms
 Execution Time: 0.258 ms
(9 rows)

=== Vehicle stock plate NULLS LAST (nullable sort pilot) ===
                                                                           QUERY PLAN                                                                            
-----------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.41..14.60 rows=51 width=69) (actual time=0.011..0.034 rows=51 loops=1)
   Buffers: shared hit=55
   ->  Index Scan using vehicles_tenant_id_site_id_plate_id_idx on vehicles v  (cost=0.41..979.60 rows=3519 width=69) (actual time=0.011..0.031 rows=51 loops=1)
         Index Cond: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
         Filter: ((stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
         Buffers: shared hit=55
 Planning:
   Buffers: shared hit=4
 Planning Time: 0.080 ms
 Execution Time: 0.040 ms
(10 rows)
```
