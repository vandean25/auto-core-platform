---
title: "AUT-890 search-filter EXPLAIN evidence (synthetic)"
date: "2026-11-06"
status: draft
tags: [platform, adr-0035, aut-890]
---

# AUT-890 search-filter EXPLAIN evidence (synthetic)

The [AUT-888 evidence](./aut888-list-cursor-explain-evidence.md) states that its captures have **no search, brand or location filters**. The pilot lists send the search box to the cursor and capped-count endpoints, so this note adds the search-filtered shapes. AUT-890 adds no migration, index or query: the plans below are for the queries AUT-888 already ships.

## Method and limits

- Disposable local PostgreSQL 16.15 (apt, Ubuntu 24.04 VM), database `aut890_explain_scratch`: `prisma migrate deploy`, then the unchanged AUT-888 fixture `tools/aut888-list-cursor-explain/seed-synthetic.sql` (15 000 `catalog_items`; 5 000 dealer-stock `vehicles`, all `IN_STOCK`, 40 distinct makes), then `ANALYZE`. No QA, production or customer data.
- The SQL is **hand-written to match the service where clauses** (`buildLegacyInventoryWhere`, `buildVehicleListWhere`), not captured from Prisma. The inventory brand-name relation filter is modelled as an `EXISTS` subquery; Prisma may generate a different join. All fixture `brand_id` values are NULL, so that branch never matches.
- Only the first block (`LIMIT 51`) and the capped-count probe (`LIMIT 1001`) are repeated here with a search term. Continuation pages and DESC sorts are covered by AUT-888.
- Synthetic distribution on a VM-local Postgres at 15k/5k rows. This is **not** catalog scale and says nothing about Cloud SQL.

## Plan summary (honest read)

| Query shape | Plan at fixture size | Read |
| --- | --- | --- |
| Inventory first block, selective search (`SKU-0075`), `sku ASC` | Index Scan on `catalog_items_tenant_id_sku_id_idx`, 7 499 rows removed by filter before 51 were found, 8.5 ms | Walks the sort index and filters; the trigram indexes (`catalog_items_name_trgm_idx`, `catalog_items_sku_trgm_idx`) were not chosen for this OR shape. Cost grows with the position of the matches. |
| Inventory first block, common search (`part`) | Index Scan on the sort index, 51 rows, 0.07 ms | Cheap when most rows match. |
| Inventory first block, no match (`zzzzz`) | Index Scan on the sort index, 15 000 rows removed, 15.2 ms | An empty result reads the whole tenant: linear in catalog size. This is the case ADR-0035 §5 warns about. |
| Inventory capped count, common / no match | Seq Scan, stops at 1 001 rows (0.4 ms) / reads all 15 000 rows (14.0 ms) | Bounded output, unbounded work for an unsuccessful search. |
| Vehicle first block, `IN_STOCK` + selective search (`Make7`, 125 matches) | Seq Scan on `vehicles` (4 875 removed), nested loop to `storage_locations`, top-N sort, 4.2 ms | No index serves an OR over five `ILIKE` columns, and the sort index is not used: reads the site's vehicles, then sorts. Linear in site stock. |
| Vehicle first block, `IN_STOCK` + no match | Seq Scan, all 5 000 removed, 3.5 ms | Same. |
| Vehicle capped count, `IN_STOCK` + common search | Hash Join over a Seq Scan, stops at 1 001 rows, 0.6 ms | Cheap when matches are common. |

## Consequences for the pilot

- Browsing without a search uses the AUT-888 sort indexes (see that note). Searching is where the cost moves: parts search has trigram indexes the planner did not use for this OR shape, and vehicle search has none. At dealer-stock sizes (thousands of vehicles per site) the vehicle numbers are small. For the parts catalog at millions of rows, a selective or empty search is the case to re-measure on QA with catalog-sized data before further waves.
- No index change is proposed here: that is a separate decision (ADR-0035 rules out denormalization and relevance truncation without approval).

## Raw output

```text
=== INV selective search (SKU-0075), first block sku ASC ===
 Limit (actual rows=51 loops=1)
   Buffers: shared hit=268
   ->  Index Scan using catalog_items_tenant_id_sku_id_idx on catalog_items c (actual rows=51 loops=1)
         Index Cond: (tenant_id = '<tenant>'::text)
         Filter: ((name ~~* '%SKU-0075%'::text) OR (sku ~~* '%SKU-0075%'::text) OR (SubPlan 1))
         Rows Removed by Filter: 7499
         Buffers: shared hit=268
         SubPlan 1
           ->  Seq Scan on brands b (actual rows=0 loops=7499)
                 Filter: ((name ~~* '%SKU-0075%'::text) AND (id = c.brand_id))
 Planning:
   Buffers: shared hit=373
 Planning Time: 1.645 ms
 Execution Time: 8.505 ms
=== INV common search (part, matches most rows), first block sku ASC ===
 Limit (actual rows=51 loops=1)
   Buffers: shared hit=5
   ->  Index Scan using catalog_items_tenant_id_sku_id_idx on catalog_items c (actual rows=51 loops=1)
         Index Cond: (tenant_id = '<tenant>'::text)
         Filter: ((name ~~* '%part%'::text) OR (sku ~~* '%part%'::text) OR (SubPlan 1))
         Buffers: shared hit=5
         SubPlan 1
           ->  Seq Scan on brands b (never executed)
                 Filter: ((name ~~* '%part%'::text) AND (id = c.brand_id))
 Planning:
   Buffers: shared hit=11
 Planning Time: 0.231 ms
 Execution Time: 0.065 ms
=== INV no-match search (zzzzz), first block sku ASC ===
 Limit (actual rows=0 loops=1)
   Buffers: shared hit=531
   ->  Index Scan using catalog_items_tenant_id_sku_id_idx on catalog_items c (actual rows=0 loops=1)
         Index Cond: (tenant_id = '<tenant>'::text)
         Filter: ((name ~~* '%zzzzz%'::text) OR (sku ~~* '%zzzzz%'::text) OR (SubPlan 1))
         Rows Removed by Filter: 15000
         Buffers: shared hit=531
         SubPlan 1
           ->  Seq Scan on brands b (actual rows=0 loops=15000)
                 Filter: ((name ~~* '%zzzzz%'::text) AND (id = c.brand_id))
 Planning:
   Buffers: shared hit=11
 Planning Time: 0.161 ms
 Execution Time: 15.210 ms
=== INV capped count, common search (take 1001 ids) ===
 Limit (actual rows=1001 loops=1)
   Buffers: shared hit=22
   ->  Seq Scan on catalog_items c (actual rows=1001 loops=1)
         Filter: ((tenant_id = '<tenant>'::text) AND ((name ~~* '%part%'::text) OR (sku ~~* '%part%'::text) OR (SubPlan 1)))
         Buffers: shared hit=22
         SubPlan 1
           ->  Seq Scan on brands b (never executed)
                 Filter: ((name ~~* '%part%'::text) AND (id = c.brand_id))
 Planning:
   Buffers: shared hit=11
 Planning Time: 0.176 ms
 Execution Time: 0.437 ms
=== INV capped count, no-match search (zzzzz) ===
 Limit (actual rows=0 loops=1)
   Buffers: shared hit=320
   ->  Seq Scan on catalog_items c (actual rows=0 loops=1)
         Filter: ((tenant_id = '<tenant>'::text) AND ((name ~~* '%zzzzz%'::text) OR (sku ~~* '%zzzzz%'::text) OR (SubPlan 1)))
         Rows Removed by Filter: 15000
         Buffers: shared hit=320
         SubPlan 1
           ->  Seq Scan on brands b (actual rows=0 loops=15000)
                 Filter: ((name ~~* '%zzzzz%'::text) AND (id = c.brand_id))
 Planning:
   Buffers: shared hit=11
 Planning Time: 0.149 ms
 Execution Time: 14.019 ms
=== VEH IN_STOCK + selective search (Make7), first block make ASC ===
 Limit (actual rows=51 loops=1)
   Buffers: shared hit=152
   ->  Sort (actual rows=51 loops=1)
         Sort Key: v.make, v.id
         Sort Method: top-N heapsort  Memory: 31kB
         Buffers: shared hit=152
         ->  Nested Loop (actual rows=125 loops=1)
               Join Filter: (sl.id = v.location_id)
               Buffers: shared hit=149
               ->  Seq Scan on storage_locations sl (actual rows=1 loops=1)
                     Filter: ((tenant_id = '<tenant>'::text) AND (site_id = '<site>'::text))
                     Rows Removed by Filter: 2
                     Buffers: shared hit=1
               ->  Seq Scan on vehicles v (actual rows=125 loops=1)
                     Filter: ((tenant_id = '<tenant>'::text) AND (site_id = '<site>'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])) AND ((vin ~~* '%Make7
                     Rows Removed by Filter: 4875
                     Buffers: shared hit=148
 Planning:
   Buffers: shared hit=664
 Planning Time: 1.317 ms
 Execution Time: 4.237 ms
=== VEH IN_STOCK + no-match search (zzzzz), first block make ASC ===
 Limit (actual rows=0 loops=1)
   Buffers: shared hit=148
   ->  Sort (actual rows=0 loops=1)
         Sort Key: v.make, v.id
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=148
         ->  Nested Loop (actual rows=0 loops=1)
               Join Filter: (sl.id = v.location_id)
               Buffers: shared hit=148
               ->  Seq Scan on vehicles v (actual rows=0 loops=1)
                     Filter: ((tenant_id = '<tenant>'::text) AND (site_id = '<site>'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])) AND ((vin ~~* '%zzzzz
                     Rows Removed by Filter: 5000
                     Buffers: shared hit=148
               ->  Seq Scan on storage_locations sl (never executed)
                     Filter: ((tenant_id = '<tenant>'::text) AND (site_id = '<site>'::text))
 Planning:
   Buffers: shared hit=7
 Planning Time: 0.351 ms
 Execution Time: 3.529 ms
=== VEH capped count IN_STOCK + common search (Make), take 1001 ids ===
 Limit (actual rows=1001 loops=1)
   Buffers: shared hit=31
   ->  Hash Join (actual rows=1001 loops=1)
         Hash Cond: (v.location_id = sl.id)
         Buffers: shared hit=31
         ->  Seq Scan on vehicles v (actual rows=1001 loops=1)
               Filter: ((tenant_id = '<tenant>'::text) AND (site_id = '<site>'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])) AND ((vin ~~* '%Make%'::tex
               Buffers: shared hit=30
         ->  Hash (actual rows=1 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 9kB
               Buffers: shared hit=1
               ->  Seq Scan on storage_locations sl (actual rows=1 loops=1)
                     Filter: ((tenant_id = '<tenant>'::text) AND (site_id = '<site>'::text))
                     Rows Removed by Filter: 2
                     Buffers: shared hit=1
 Planning:
   Buffers: shared hit=7
 Planning Time: 0.351 ms
 Execution Time: 0.604 ms
```
