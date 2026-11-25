---
title: "AUT-958 vehicle stock_status cursor EXPLAIN evidence (synthetic)"
date: "2026-11-25"
status: draft
tags: [platform, adr-0035, aut-958]
---

# AUT-958 vehicle `stock_status` cursor EXPLAIN evidence (synthetic)

Captured on a **disposable Docker PostgreSQL 16** instance (`localhost:55432`, database `aut958_explain_synthetic`, container dropped after capture) using `tools/aut888-list-cursor-explain/seed-synthetic.sql` (**5 000** synthetic dealer-stock `vehicles` under tenant `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, site `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`) with migration `20261125120000_aut958_vehicle_stock_status_cursor_index` applied. No QA/prod/customer data.

The fixture has one site and every vehicle is `IN_STOCK`. The continuation cursor is an actual synthetic row selected at offset 2 500 in `id` order: `7e78153e-141d-4650-a7ed-8b6a49b7dce1`.

## Shipped continuation predicate

`buildKeysetAfterClause` emits an enum `IN` branch, the equal-value ID tie-break, and the nullable branch. For `stock_status ASC` after `IN_STOCK`, the SQL shape is:

```sql
AND (
  v.stock_status IN ('RESERVED', 'IN_PREP', 'SOLD')
  OR (v.stock_status = 'IN_STOCK' AND v.id > :'cursor_id')
  OR v.stock_status IS NULL
)
ORDER BY v.stock_status ASC NULLS LAST, v.id ASC
LIMIT 51;
```

For `DESC`, the enum branch is `IN ('ON_ORDER')` and the tie-break is `id < :'cursor_id'`. PostgreSQL displays `IN` as `= ANY (...)` in the plan. Because cursor mode requires a draft-free `stock_status` equality filter, the extra enum and null branches match no rows in this fixture; paging proceeds on the ID tie-break.

## Plan summary

- **First page (`stock_status ASC NULLS LAST, id ASC`)**: `0.074 ms`, `Index Scan using vehicles_tenant_id_id_key`, `54` shared buffer hits, no sort.
- **First page (`stock_status DESC NULLS LAST, id DESC`)**: `0.056 ms`, `Index Scan Backward using vehicles_tenant_id_id_key`, `56` shared buffer hits, no sort.
- **Continuation ASC**: `0.988 ms`, `Index Scan using vehicles_tenant_id_id_key`, `2 501` rows removed by the join/scope/status/keyset filter at mid-table.
- **Continuation DESC**: `0.826 ms`, `Index Scan Backward using vehicles_tenant_id_id_key`, `2 500` rows removed by the join/scope/status/keyset filter at mid-table.
- Additive composite index `vehicles_tenant_id_site_id_stock_status_id_idx` (`("tenant_id", "site_id", "stock_status", "id")`) exists, but PostgreSQL **did not select it** for this single-site, single-status fixture. These plans do not claim a measured benefit from that index; a multi-site or multi-status distribution needs separate evidence.

## Raw `EXPLAIN (ANALYZE, BUFFERS)` output

```text
=== Vehicle stock keyset first page (stock_status ASC NULLS LAST, id ASC) — location.site_id join ===
Limit  (cost=0.28..12.64 rows=51 width=41) (actual time=0.020..0.063 rows=51 loops=1)
  Buffers: shared hit=54
  ->  Nested Loop  (cost=0.28..853.29 rows=3519 width=41) (actual time=0.020..0.060 rows=51 loops=1)
        Join Filter: (sl.id = v.location_id)
        Buffers: shared hit=54
        ->  Index Scan using vehicles_tenant_id_id_key on vehicles v  (cost=0.28..799.47 rows=3519 width=115) (actual time=0.014..0.048 rows=51 loops=1)
              Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
              Filter: ((site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
              Buffers: shared hit=53
        ->  Materialize  (cost=0.00..1.03 rows=1 width=64) (actual time=0.000..0.000 rows=51 loops=1)
              Buffers: shared hit=1
              ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.003..0.003 rows=1 loops=1)
                    Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                    Rows Removed by Filter: 2
                    Buffers: shared hit=1
Planning:
  Buffers: shared hit=5
Planning Time: 0.183 ms
Execution Time: 0.074 ms
=== Vehicle stock keyset continuation (stock_status IN after enum value, id tiebreak) — location.site_id join ===
Limit  (cost=0.28..25.52 rows=51 width=41) (actual time=0.951..0.978 rows=51 loops=1)
  Buffers: shared hit=2583
  ->  Nested Loop  (cost=0.28..870.64 rows=1759 width=41) (actual time=0.951..0.975 rows=51 loops=1)
        Join Filter: (sl.id = v.location_id)
        Buffers: shared hit=2583
        ->  Index Scan using vehicles_tenant_id_id_key on vehicles v  (cost=0.28..843.22 rows=1759 width=115) (actual time=0.945..0.963 rows=51 loops=1)
              Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
              Filter: ((site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])) AND ((stock_status = ANY ('{RESERVED,IN_PREP,SOLD}'::"VehicleStockStatus"[])) OR ((stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (id > '7e78153e-141d-4650-a7ed-8b6a49b7dce1'::text)) OR (stock_status IS NULL)))
              Rows Removed by Filter: 2501
              Buffers: shared hit=2582
        ->  Materialize  (cost=0.00..1.03 rows=1 width=64) (actual time=0.000..0.000 rows=51 loops=1)
              Buffers: shared hit=1
              ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.003..0.003 rows=1 loops=1)
                    Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                    Rows Removed by Filter: 2
                    Buffers: shared hit=1
Planning:
  Buffers: shared hit=1
Planning Time: 0.209 ms
Execution Time: 0.988 ms
=== Vehicle stock keyset first page (stock_status DESC NULLS LAST, id DESC) — location.site_id join ===
Limit  (cost=0.28..12.64 rows=51 width=41) (actual time=0.010..0.047 rows=51 loops=1)
  Buffers: shared hit=56
  ->  Nested Loop  (cost=0.28..853.29 rows=3519 width=41) (actual time=0.010..0.045 rows=51 loops=1)
        Join Filter: (sl.id = v.location_id)
        Buffers: shared hit=56
        ->  Index Scan Backward using vehicles_tenant_id_id_key on vehicles v  (cost=0.28..799.47 rows=3519 width=115) (actual time=0.006..0.034 rows=51 loops=1)
              Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
              Filter: ((site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])))
              Buffers: shared hit=55
        ->  Materialize  (cost=0.00..1.03 rows=1 width=64) (actual time=0.000..0.000 rows=51 loops=1)
              Buffers: shared hit=1
              ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.002..0.002 rows=1 loops=1)
                    Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                    Rows Removed by Filter: 2
                    Buffers: shared hit=1
Planning:
  Buffers: shared hit=5
Planning Time: 0.154 ms
Execution Time: 0.056 ms
=== Vehicle stock keyset continuation (stock_status IN before enum value, id tiebreak) — location.site_id join ===
Limit  (cost=0.28..25.34 rows=51 width=41) (actual time=0.790..0.817 rows=51 loops=1)
  Buffers: shared hit=2624
  ->  Nested Loop  (cost=0.28..864.39 rows=1759 width=41) (actual time=0.790..0.814 rows=51 loops=1)
        Join Filter: (sl.id = v.location_id)
        Buffers: shared hit=2624
        ->  Index Scan Backward using vehicles_tenant_id_id_key on vehicles v  (cost=0.28..836.97 rows=1759 width=115) (actual time=0.785..0.803 rows=51 loops=1)
              Index Cond: (tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
              Filter: ((site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text) AND (stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (inventory_role = ANY ('{USED,NEW,DEMO}'::"VehicleInventoryRole"[])) AND ((stock_status = 'ON_ORDER'::"VehicleStockStatus") OR ((stock_status = 'IN_STOCK'::"VehicleStockStatus") AND (id < '7e78153e-141d-4650-a7ed-8b6a49b7dce1'::text)) OR (stock_status IS NULL)))
              Rows Removed by Filter: 2500
              Buffers: shared hit=2623
        ->  Materialize  (cost=0.00..1.03 rows=1 width=64) (actual time=0.000..0.000 rows=51 loops=1)
              Buffers: shared hit=1
              ->  Seq Scan on storage_locations sl  (cost=0.00..1.03 rows=1 width=64) (actual time=0.002..0.002 rows=1 loops=1)
                    Filter: ((tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (site_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text))
                    Rows Removed by Filter: 2
                    Buffers: shared hit=1
Planning:
  Buffers: shared hit=1
Planning Time: 0.175 ms
Execution Time: 0.826 ms
```
