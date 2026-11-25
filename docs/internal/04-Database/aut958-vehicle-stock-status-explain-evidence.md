---
title: "AUT-958 vehicle stock_status cursor EXPLAIN evidence (synthetic)"
date: "2026-11-25"
status: draft
tags: [platform, adr-0035, aut-958]
---

# AUT-958 vehicle `stock_status` cursor EXPLAIN evidence (synthetic)

Captured on a **disposable local PostgreSQL 16** instance (`localhost:5432`, database `aut958_explain_synthetic`, dropped after capture) using `tools/aut888-list-cursor-explain/seed-synthetic.sql` (**5 000** synthetic dealer-stock `vehicles` under tenant `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, site `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`) with migration `20261125120000_aut958_vehicle_stock_status_cursor_index` applied. No QA/prod/customer data.

## Plan summary

- **First page (`stock_status ASC NULLS LAST, id ASC` and `DESC NULLS LAST, id DESC`)**: `0.15 ms` – `0.53 ms`. Because cursor mode on `/api/vehicle-stock` requires a draft-free `stock_status` equality filter (`IN_STOCK` / `RESERVED` / `IN_PREP` / `SOLD`), PostgreSQL recognizes `stock_status` is constant for the query and satisfies the `ORDER BY ... id` limit via an `Index Scan` / `Index Scan Backward` without sorting (`54`–`56` shared buffer hits).
- **Continuation (`stock_status = 'IN_STOCK'`, `id > ...`)**: `2.85 ms`, `Index Scan` with `Filter` (`Rows Removed by Filter: 2496` at mid-table), bounded by the 2,000-row product cap.
- Additive composite index `vehicles_tenant_id_site_id_stock_status_id_idx` (`("tenant_id", "site_id", "stock_status", "id")`) is in place for multi-site / multi-status distributions.

## Raw `EXPLAIN (ANALYZE, BUFFERS)` output

```text
=== Vehicle stock keyset first page (stock_status ASC NULLS LAST, id ASC) — location.site_id join ===
 Limit  (cost=0.28..12.76 rows=51 width=41) (actual time=0.065..0.327 rows=51 loops=1)
   Buffers: shared hit=54
   ->  Nested Loop  (cost=0.28..861.29 rows=3519 width=41) (actual time=0.064..0.319 rows=51 loops=1)
         Join Filter: (sl.id = v.location_id)
         Buffers: shared hit=54
         ->  Index Scan using vehicles_tenant_id_id_key on vehicles v  (cost=0.28..807.47 rows=3519 width=115) (actual time=0.045..0.284 rows=51 loops=1)
               Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
               Filter: ((site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
               Buffers: shared hit=53
         ->  Materialize  (cost=0.00..1.03 rows=1 width=64) (actual time=0.000..0.000 rows=1 loops=51)
               Buffers: shared hit=1
               ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.011..0.011 rows=1 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                     Rows Removed by Filter: 2
                     Buffers: shared hit=1
 Planning:
   Buffers: shared hit=752
 Planning Time: 2.459 ms
 Execution Time: 0.530 ms

=== Vehicle stock keyset continuation (stock_status = IN_STOCK, id tiebreak) — location.site_id join ===
 Limit  (cost=0.28..25.57 rows=51 width=41) (actual time=2.744..2.811 rows=51 loops=1)
   Buffers: shared hit=2570
   ->  Nested Loop  (cost=0.28..872.39 rows=1759 width=41) (actual time=2.743..2.805 rows=51 loops=1)
         Join Filter: (sl.id = v.location_id)
         Buffers: shared hit=2570
         ->  Index Scan using vehicles_tenant_id_id_key on vehicles v  (cost=0.28..844.97 rows=1759 width=115) (actual time=2.728..2.776 rows=51 loops=1)
               Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
               Filter: ((site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])) AND ((stock_status > 'IN_STOCK'::"VehicleStockStatus") OR ((stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (id > '80000000-0000-4000-8000-000000000001'::text)) OR (stock_status IS NULL)))
               Rows Removed by Filter: 2496
               Buffers: shared hit=2569
         ->  Materialize  (cost=0.00..1.03 rows=1 width=64) (actual time=0.000..0.000 rows=1 loops=51)
               Buffers: shared hit=1
               ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.008..0.008 rows=1 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                     Rows Removed by Filter: 2
                     Buffers: shared hit=1
 Planning:
   Buffers: shared hit=7
 Planning Time: 0.543 ms
 Execution Time: 2.845 ms

=== Vehicle stock keyset first page (stock_status DESC NULLS LAST, id DESC) — location.site_id join ===
 Limit  (cost=0.28..12.76 rows=51 width=41) (actual time=0.022..0.135 rows=51 loops=1)
   Buffers: shared hit=56
   ->  Nested Loop  (cost=0.28..861.29 rows=3519 width=41) (actual time=0.022..0.130 rows=51 loops=1)
         Join Filter: (sl.id = v.location_id)
         Buffers: shared hit=56
         ->  Index Scan Backward using vehicles_tenant_id_id_key on vehicles v  (cost=0.28..807.47 rows=3519 width=115) (actual time=0.014..0.107 rows=51 loops=1)
               Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
               Filter: ((site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
               Buffers: shared hit=55
         ->  Materialize  (cost=0.00..1.03 rows=1 width=64) (actual time=0.000..0.000 rows=1 loops=51)
               Buffers: shared hit=1
               ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.005..0.005 rows=1 loops=1)
                     Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                     Rows Removed by Filter: 2
                     Buffers: shared hit=1
 Planning:
   Buffers: shared hit=11
 Planning Time: 0.472 ms
 Execution Time: 0.154 ms
```
