---
title: "AUT-956 workshop order cursor list: precision and EXPLAIN evidence"
date: "2026-11-13"
status: draft
tags: [platform, tables, adr-0035, workshop]
---

# AUT-956 workshop order cursor list: precision and EXPLAIN evidence

## Timestamp precision on QA (read-only `information_schema`, 2026-11-13)

```sql
SELECT table_name, column_name, data_type, datetime_precision
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'workshop_orders'
   AND column_name IN ('createdAt', 'id', 'order_number', 'status');
```

| column_name | data_type | datetime_precision |
| --- | --- | --- |
| `createdAt` | timestamp without time zone | 3 |
| `id` | text | |
| `order_number` | text | |
| `status` | USER-DEFINED | |

Precision 3 matches the cursor encoding: `createdAt` travels as UTC ISO with exactly three fractional digits (`Date.toISOString()`); any other form fails the strict round trip with `LIST_CURSOR_INVALID`.

## Plans

Disposable PGlite (Postgres 17 planner), tables and indexes as in `prisma/schema.prisma` on main, synthetic data only (no QA or production data): measured tenant with 80 000 orders on two sites (53 334 on the queried site), four neighbour tenants with 30 000 orders each, 30 000 customers, 45 000 vehicles, `ANALYZE`d. SQL mirrors the Prisma queries of `GET /api/workshop/orders?pagination=cursor` (limit 50 + 1 probe row) and `GET /api/workshop/orders/capped-count` (probe 1 001, no sort). Reproduce with the script in the AUT-956 PR description.

Summary:

| Query | Without new index | With `(tenant_id, site_id, "createdAt", id)` |
| --- | --- | --- |
| DESC first block | top-N heapsort over 53 334 rows, 74 ms | Index Scan Backward, no sort, 0.7 ms |
| DESC next block (keyset) | top-N heapsort over 53 282 rows, 70 ms | Index Scan Backward, 0.2 ms |
| ASC first block | top-N heapsort, 60 ms | Index Scan, 0.3 ms |
| ASC next block (keyset) | 20 ms | 0.4 ms |
| DESC + search, next block | 219 ms (vehicle relation seq scan dominates) | 140 ms, same vehicle seq scan |
| DESC + `customerId` (live statuses) | 17 ms | 25 ms, same plan shape (tenant index + filter) |
| Capped count, no search | 1.9 ms | 1.8 ms |
| Capped count + search | 135 ms (vehicle relation seq scan) | 127 ms |

The search plans are dominated by the existing vehicle relation filter (`make` / `model` ILIKE has no trigram index); the offset list runs the same filter today, so this is unchanged behaviour and not addressed here.

## Without the new index
### list createdAt DESC, first block
```
Limit (actual time=73.951..73.978 rows=51 loops=1)
  Buffers: shared hit=1844
  ->  Sort (actual time=73.947..73.957 rows=51 loops=1)
        Sort Key: "createdAt" DESC, id DESC
        Sort Method: top-N heapsort  Memory: 43kB
        Buffers: shared hit=1844
        ->  Index Scan using workshop_orders_tenant_id_idx on workshop_orders w (actual time=0.037..40.247 rows=53334 loops=1)
              Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
              Filter: (site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
              Rows Removed by Filter: 26666
              Buffers: shared hit=1844
Planning:
  Buffers: shared hit=6
Planning Time: 0.284 ms
Execution Time: 74.080 ms
```

### list createdAt DESC, next block (keyset)
```
Limit (actual time=69.570..69.599 rows=51 loops=1)
  Buffers: shared hit=1844
  ->  Sort (actual time=69.567..69.577 rows=51 loops=1)
        Sort Key: "createdAt" DESC, id DESC
        Sort Method: top-N heapsort  Memory: 43kB
        Buffers: shared hit=1844
        ->  Index Scan using workshop_orders_tenant_id_idx on workshop_orders w (actual time=0.022..38.684 rows=53282 loops=1)
              Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
              Filter: ((site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (("createdAt" < '2025-12-22 12:31:00.002'::timestamp without time zone) OR (("createdAt" = '2025-12-22 12:31:00.002'::timestamp without time zone) AND (id < '17434466-2c3d-da6c-e512-71672776a92d'::text))))
              Rows Removed by Filter: 26718
              Buffers: shared hit=1844
Planning Time: 0.412 ms
Execution Time: 69.641 ms
```

### list createdAt ASC, first block
```
Limit (actual time=59.817..59.844 rows=51 loops=1)
  Buffers: shared hit=1844
  ->  Sort (actual time=59.814..59.824 rows=51 loops=1)
        Sort Key: "createdAt", id
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=1844
        ->  Index Scan using workshop_orders_tenant_id_idx on workshop_orders w (actual time=0.024..35.036 rows=53334 loops=1)
              Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
              Filter: (site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
              Rows Removed by Filter: 26666
              Buffers: shared hit=1844
Planning Time: 0.195 ms
Execution Time: 59.887 ms
```

### list createdAt ASC, next block (keyset)
```
Limit (actual time=20.068..20.095 rows=51 loops=1)
  Buffers: shared hit=1844
  ->  Sort (actual time=20.065..20.075 rows=51 loops=1)
        Sort Key: "createdAt", id
        Sort Method: quicksort  Memory: 30kB
        Buffers: shared hit=1844
        ->  Index Scan using workshop_orders_tenant_id_idx on workshop_orders w (actual time=19.976..20.016 rows=52 loops=1)
              Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
              Filter: ((site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (("createdAt" > '2025-12-22 12:31:00.002'::timestamp without time zone) OR (("createdAt" = '2025-12-22 12:31:00.002'::timestamp without time zone) AND (id > '17434466-2c3d-da6c-e512-71672776a92d'::text))))
              Rows Removed by Filter: 79948
              Buffers: shared hit=1844
Planning Time: 0.443 ms
Execution Time: 20.147 ms
```

### list DESC + search "gruber" (next block)
```
Limit (actual time=218.559..218.590 rows=51 loops=1)
  Buffers: shared hit=3072 read=369 dirtied=1 written=369
  ->  Sort (actual time=218.556..218.570 rows=51 loops=1)
        Sort Key: w."createdAt" DESC, w.id DESC
        Sort Method: top-N heapsort  Memory: 43kB
        Buffers: shared hit=3072 read=369 dirtied=1 written=369
        ->  Index Scan using workshop_orders_tenant_id_idx on workshop_orders w (actual time=115.069..215.248 rows=5328 loops=1)
              Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
              Filter: ((site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (("createdAt" < '2025-12-22 12:31:00.002'::timestamp without time zone) OR (("createdAt" = '2025-12-22 12:31:00.002'::timestamp without time zone) AND (id < '17434466-2c3d-da6c-e512-71672776a92d'::text))) AND ((order_number ~~* '%gruber%'::text) OR (id ~~* '%gruber%'::text) OR (ANY (customer_id = (hashed SubPlan 1).col1)) OR (ANY (vehicle_id = (hashed SubPlan 2).col1))))
              Rows Removed by Filter: 74672
              Buffers: shared hit=3072 read=369 dirtied=1 written=369
              SubPlan 1
                ->  Bitmap Heap Scan on customers c (actual time=17.497..23.001 rows=3000 loops=1)
                      Recheck Cond: ((first_name ~~* '%gruber%'::text) OR (last_name ~~* '%gruber%'::text) OR (company_name ~~* '%gruber%'::text))
                      Heap Blocks: exact=360
                      Buffers: shared hit=702 read=368 written=368
                      ->  BitmapOr (actual time=17.412..17.415 rows=0 loops=1)
                            Buffers: shared hit=342 read=368 written=368
                            ->  Bitmap Index Scan on customers_first_name_trgm_idx (actual time=7.564..7.564 rows=0 loops=1)
                                  Index Cond: (first_name ~~* '%gruber%'::text)
                                  Buffers: shared hit=189 read=104 written=104
                            ->  Bitmap Index Scan on customers_last_name_trgm_idx (actual time=5.853..5.853 rows=3000 loops=1)
                                  Index Cond: (last_name ~~* '%gruber%'::text)
                                  Buffers: shared hit=13 read=196 written=196
                            ->  Bitmap Index Scan on customers_company_name_trgm_idx (actual time=3.985..3.985 rows=0 loops=1)
                                  Index Cond: (company_name ~~* '%gruber%'::text)
                                  Buffers: shared hit=140 read=68 written=68
              SubPlan 2
                ->  Seq Scan on vehicles v (actual time=90.455..90.455 rows=0 loops=1)
                      Filter: ((make ~~* '%gruber%'::text) OR (model ~~* '%gruber%'::text) OR (plate ~~* '%gruber%'::text) OR (vin ~~* '%gruber%'::text))
                      Rows Removed by Filter: 45000
                      Buffers: shared hit=526 read=1 dirtied=1 written=1
Planning:
  Buffers: shared hit=124 read=9 written=9
Planning Time: 2.152 ms
Execution Time: 218.776 ms
```

### list DESC + customerId (live statuses)
```
Limit (actual time=17.138..17.148 rows=14 loops=1)
  Buffers: shared hit=1844
  ->  Sort (actual time=17.135..17.139 rows=14 loops=1)
        Sort Key: "createdAt" DESC, id DESC
        Sort Method: quicksort  Memory: 20kB
        Buffers: shared hit=1844
        ->  Index Scan using workshop_orders_tenant_id_idx on workshop_orders w (actual time=0.017..17.106 rows=14 loops=1)
              Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
              Filter: ((site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (customer_id = 'c0-3'::text) AND (status = ANY ('{SCHEDULED,INTAKE,IN_PROGRESS}'::"WorkshopOrderStatus"[])))
              Rows Removed by Filter: 79986
              Buffers: shared hit=1844
Planning:
  Buffers: shared hit=3
Planning Time: 0.302 ms
Execution Time: 17.182 ms
```

### capped count, no search (probe 1001)
```
Limit (actual time=0.032..1.577 rows=1001 loops=1)
  Buffers: shared hit=37
  ->  Index Scan using workshop_orders_tenant_id_idx on workshop_orders w (actual time=0.029..1.027 rows=1001 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Filter: (site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
        Rows Removed by Filter: 500
        Buffers: shared hit=37
Planning Time: 0.217 ms
Execution Time: 1.857 ms
```

### capped count + search "gruber" (probe 1001)
```
Limit (actual time=109.444..135.041 rows=1001 loops=1)
  Buffers: shared hit=1945
  ->  Index Scan using workshop_orders_tenant_id_idx on workshop_orders w (actual time=109.441..134.520 rows=1001 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Filter: ((site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND ((order_number ~~* '%gruber%'::text) OR (id ~~* '%gruber%'::text) OR (ANY (customer_id = (hashed SubPlan 1).col1)) OR (ANY (vehicle_id = (hashed SubPlan 2).col1))))
        Rows Removed by Filter: 14018
        Buffers: shared hit=1945
        SubPlan 1
          ->  Bitmap Heap Scan on customers c (actual time=14.932..20.522 rows=3000 loops=1)
                Recheck Cond: ((first_name ~~* '%gruber%'::text) OR (last_name ~~* '%gruber%'::text) OR (company_name ~~* '%gruber%'::text))
                Heap Blocks: exact=360
                Buffers: shared hit=1070
                ->  BitmapOr (actual time=14.851..14.854 rows=0 loops=1)
                      Buffers: shared hit=710
                      ->  Bitmap Index Scan on customers_first_name_trgm_idx (actual time=6.004..6.004 rows=0 loops=1)
                            Index Cond: (first_name ~~* '%gruber%'::text)
                            Buffers: shared hit=293
                      ->  Bitmap Index Scan on customers_last_name_trgm_idx (actual time=5.053..5.053 rows=3000 loops=1)
                            Index Cond: (last_name ~~* '%gruber%'::text)
                            Buffers: shared hit=209
                      ->  Bitmap Index Scan on customers_company_name_trgm_idx (actual time=3.784..3.785 rows=0 loops=1)
                            Index Cond: (company_name ~~* '%gruber%'::text)
                            Buffers: shared hit=208
        SubPlan 2
          ->  Seq Scan on vehicles v (actual time=86.924..86.924 rows=0 loops=1)
                Filter: ((make ~~* '%gruber%'::text) OR (model ~~* '%gruber%'::text) OR (plate ~~* '%gruber%'::text) OR (vin ~~* '%gruber%'::text))
                Rows Removed by Filter: 45000
                Buffers: shared hit=527
Planning:
  Buffers: shared hit=4
Planning Time: 1.134 ms
Execution Time: 135.379 ms
```


## With the new index
### list createdAt DESC, first block
```
Limit (actual time=0.075..0.220 rows=51 loops=1)
  Buffers: shared hit=8
  ->  Index Scan Backward using "workshop_orders_tenant_id_site_id_createdAt_id_idx" on workshop_orders w (actual time=0.069..0.140 rows=51 loops=1)
        Index Cond: ((tenant_id = '11111111-1111-4111-8111-111111111111'::text) AND (site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text))
        Buffers: shared hit=8
Planning:
  Buffers: shared hit=6
Planning Time: 0.215 ms
Execution Time: 0.704 ms
```

### list createdAt DESC, next block (keyset)
```
Limit (actual time=0.061..0.140 rows=51 loops=1)
  Buffers: shared hit=13
  ->  Index Scan Backward using "workshop_orders_tenant_id_site_id_createdAt_id_idx" on workshop_orders w (actual time=0.058..0.101 rows=51 loops=1)
        Index Cond: ((tenant_id = '11111111-1111-4111-8111-111111111111'::text) AND (site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text))
        Filter: (("createdAt" < '2025-12-22 12:31:00.002'::timestamp without time zone) OR (("createdAt" = '2025-12-22 12:31:00.002'::timestamp without time zone) AND (id < '17434466-2c3d-da6c-e512-71672776a92d'::text)))
        Rows Removed by Filter: 52
        Buffers: shared hit=13
Planning Time: 0.518 ms
Execution Time: 0.183 ms
```

### list createdAt ASC, first block
```
Limit (actual time=0.036..0.264 rows=51 loops=1)
  Buffers: shared hit=6
  ->  Index Scan using "workshop_orders_tenant_id_site_id_createdAt_id_idx" on workshop_orders w (actual time=0.032..0.213 rows=51 loops=1)
        Index Cond: ((tenant_id = '11111111-1111-4111-8111-111111111111'::text) AND (site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text))
        Buffers: shared hit=6
Planning Time: 0.197 ms
Execution Time: 0.309 ms
```

### list createdAt ASC, next block (keyset)
```
Limit (actual time=0.233..0.351 rows=51 loops=1)
  Buffers: shared hit=10
  ->  Sort (actual time=0.229..0.270 rows=51 loops=1)
        Sort Key: "createdAt", id
        Sort Method: quicksort  Memory: 30kB
        Buffers: shared hit=10
        ->  Bitmap Heap Scan on workshop_orders w (actual time=0.066..0.133 rows=52 loops=1)
              Recheck Cond: (((tenant_id = '11111111-1111-4111-8111-111111111111'::text) AND (site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND ("createdAt" > '2025-12-22 12:31:00.002'::timestamp without time zone)) OR ((tenant_id = '11111111-1111-4111-8111-111111111111'::text) AND (site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND ("createdAt" = '2025-12-22 12:31:00.002'::timestamp without time zone) AND (id > '17434466-2c3d-da6c-e512-71672776a92d'::text)))
              Heap Blocks: exact=3
              Buffers: shared hit=10
              ->  BitmapOr (actual time=0.052..0.056 rows=0 loops=1)
                    Buffers: shared hit=7
                    ->  Bitmap Index Scan on "workshop_orders_tenant_id_site_id_createdAt_id_idx" (actual time=0.041..0.042 rows=52 loops=1)
                          Index Cond: ((tenant_id = '11111111-1111-4111-8111-111111111111'::text) AND (site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND ("createdAt" > '2025-12-22 12:31:00.002'::timestamp without time zone))
                          Buffers: shared hit=4
                    ->  Bitmap Index Scan on "workshop_orders_tenant_id_site_id_createdAt_id_idx" (actual time=0.007..0.008 rows=0 loops=1)
                          Index Cond: ((tenant_id = '11111111-1111-4111-8111-111111111111'::text) AND (site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND ("createdAt" = '2025-12-22 12:31:00.002'::timestamp without time zone) AND (id > '17434466-2c3d-da6c-e512-71672776a92d'::text))
                          Buffers: shared hit=3
Planning Time: 0.625 ms
Execution Time: 0.443 ms
```

### list DESC + search "gruber" (next block)
```
Limit (actual time=138.793..140.088 rows=51 loops=1)
  Buffers: shared hit=371 read=1286 dirtied=590 written=1286
  ->  Index Scan Backward using "workshop_orders_tenant_id_site_id_createdAt_id_idx" on workshop_orders w (actual time=138.790..140.052 rows=51 loops=1)
        Index Cond: ((tenant_id = '11111111-1111-4111-8111-111111111111'::text) AND (site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text))
        Filter: ((("createdAt" < '2025-12-22 12:31:00.002'::timestamp without time zone) OR (("createdAt" = '2025-12-22 12:31:00.002'::timestamp without time zone) AND (id < '17434466-2c3d-da6c-e512-71672776a92d'::text))) AND ((order_number ~~* '%gruber%'::text) OR (id ~~* '%gruber%'::text) OR (ANY (customer_id = (hashed SubPlan 1).col1)) OR (ANY (vehicle_id = (hashed SubPlan 2).col1))))
        Rows Removed by Filter: 504
        Buffers: shared hit=371 read=1286 dirtied=590 written=1286
        SubPlan 1
          ->  Bitmap Heap Scan on customers c (actual time=20.563..29.606 rows=3000 loops=1)
                Recheck Cond: ((first_name ~~* '%gruber%'::text) OR (last_name ~~* '%gruber%'::text) OR (company_name ~~* '%gruber%'::text))
                Heap Blocks: exact=360
                Buffers: shared hit=14 read=1056 dirtied=360 written=1056
                ->  BitmapOr (actual time=20.461..20.464 rows=0 loops=1)
                      Buffers: shared hit=14 read=696 written=696
                      ->  Bitmap Index Scan on customers_first_name_trgm_idx (actual time=7.958..7.958 rows=0 loops=1)
                            Index Cond: (first_name ~~* '%gruber%'::text)
                            Buffers: shared hit=6 read=287 written=287
                      ->  Bitmap Index Scan on customers_last_name_trgm_idx (actual time=6.456..6.457 rows=3000 loops=1)
                            Index Cond: (last_name ~~* '%gruber%'::text)
                            Buffers: shared hit=4 read=205 written=205
                      ->  Bitmap Index Scan on customers_company_name_trgm_idx (actual time=6.019..6.020 rows=0 loops=1)
                            Index Cond: (company_name ~~* '%gruber%'::text)
                            Buffers: shared hit=4 read=204 written=204
        SubPlan 2
          ->  Seq Scan on vehicles v (actual time=106.453..106.467 rows=0 loops=1)
                Filter: ((make ~~* '%gruber%'::text) OR (model ~~* '%gruber%'::text) OR (plate ~~* '%gruber%'::text) OR (vin ~~* '%gruber%'::text))
                Rows Removed by Filter: 45000
                Buffers: shared hit=297 read=230 dirtied=230 written=230
Planning:
  Buffers: shared hit=120 read=13 written=13
Planning Time: 2.353 ms
Execution Time: 140.277 ms
```

### list DESC + customerId (live statuses)
```
Limit (actual time=25.339..25.371 rows=14 loops=1)
  Buffers: shared hit=1835 read=9 written=9
  ->  Sort (actual time=25.334..25.341 rows=14 loops=1)
        Sort Key: "createdAt" DESC, id DESC
        Sort Method: quicksort  Memory: 20kB
        Buffers: shared hit=1835 read=9 written=9
        ->  Index Scan using workshop_orders_tenant_id_idx on workshop_orders w (actual time=0.030..25.231 rows=14 loops=1)
              Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
              Filter: ((site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND (customer_id = 'c0-3'::text) AND (status = ANY ('{SCHEDULED,INTAKE,IN_PROGRESS}'::"WorkshopOrderStatus"[])))
              Rows Removed by Filter: 79986
              Buffers: shared hit=1835 read=9 written=9
Planning:
  Buffers: shared hit=3
Planning Time: 0.487 ms
Execution Time: 25.452 ms
```

### capped count, no search (probe 1001)
```
Limit (actual time=0.030..1.468 rows=1001 loops=1)
  Buffers: shared hit=37
  ->  Index Scan using workshop_orders_tenant_id_idx on workshop_orders w (actual time=0.028..0.936 rows=1001 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Filter: (site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text)
        Rows Removed by Filter: 500
        Buffers: shared hit=37
Planning Time: 0.191 ms
Execution Time: 1.764 ms
```

### capped count + search "gruber" (probe 1001)
```
Limit (actual time=106.671..126.414 rows=1001 loops=1)
  Buffers: shared hit=1945
  ->  Index Scan using workshop_orders_tenant_id_idx on workshop_orders w (actual time=106.668..125.939 rows=1001 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Filter: ((site_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::text) AND ((order_number ~~* '%gruber%'::text) OR (id ~~* '%gruber%'::text) OR (ANY (customer_id = (hashed SubPlan 1).col1)) OR (ANY (vehicle_id = (hashed SubPlan 2).col1))))
        Rows Removed by Filter: 14018
        Buffers: shared hit=1945
        SubPlan 1
          ->  Bitmap Heap Scan on customers c (actual time=15.204..21.438 rows=3000 loops=1)
                Recheck Cond: ((first_name ~~* '%gruber%'::text) OR (last_name ~~* '%gruber%'::text) OR (company_name ~~* '%gruber%'::text))
                Heap Blocks: exact=360
                Buffers: shared hit=1070
                ->  BitmapOr (actual time=15.111..15.114 rows=0 loops=1)
                      Buffers: shared hit=710
                      ->  Bitmap Index Scan on customers_first_name_trgm_idx (actual time=6.040..6.040 rows=0 loops=1)
                            Index Cond: (first_name ~~* '%gruber%'::text)
                            Buffers: shared hit=293
                      ->  Bitmap Index Scan on customers_last_name_trgm_idx (actual time=4.411..4.412 rows=3000 loops=1)
                            Index Cond: (last_name ~~* '%gruber%'::text)
                            Buffers: shared hit=209
                      ->  Bitmap Index Scan on customers_company_name_trgm_idx (actual time=4.645..4.646 rows=0 loops=1)
                            Index Cond: (company_name ~~* '%gruber%'::text)
                            Buffers: shared hit=208
        SubPlan 2
          ->  Seq Scan on vehicles v (actual time=83.373..83.373 rows=0 loops=1)
                Filter: ((make ~~* '%gruber%'::text) OR (model ~~* '%gruber%'::text) OR (plate ~~* '%gruber%'::text) OR (vin ~~* '%gruber%'::text))
                Rows Removed by Filter: 45000
                Buffers: shared hit=527
Planning:
  Buffers: shared hit=4
Planning Time: 1.161 ms
Execution Time: 126.727 ms
```

