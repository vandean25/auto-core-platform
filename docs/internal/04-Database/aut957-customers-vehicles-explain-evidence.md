---
title: "AUT-957 customers and customer vehicles cursor lists: EXPLAIN evidence"
date: "2026-11-26"
status: draft
tags: [platform, tables, adr-0035, customers, vehicles]
---

# AUT-957 customers and customer vehicles cursor lists: EXPLAIN evidence

## Timestamp precision

`customers."createdAt"` and `vehicles."createdAt"` are `timestamp(3) without time zone` in `prisma/schema.prisma`, matching the cursor encoding (`Date.toISOString()`, UTC ISO with milliseconds).

## Plans

Disposable PostgreSQL 16 (`postgres:16-alpine`), schema and indexes from `prisma/schema.prisma` including migration `20261126120000_aut957_customers_vehicles_cursor_indexes`, synthetic data only (50,000 customers and 50,000 vehicles across two tenants: 35,000 in the queried tenant and 15,000 in the neighbour tenant, `ANALYZE`d).

Summary:

| Query | Customers (`customers_tenant_id_createdAt_id_idx`) | Customer vehicles (`vehicles_tenant_id_createdAt_id_idx`) |
| --- | --- | --- |
| `createdAt DESC` first block (limit 51) | Index Only Scan Backward, no sort, 0.176 ms | Index Only Scan Backward, no sort, 0.094 ms |
| `createdAt DESC` next block (keyset) | Index Only Scan Backward, no sort, 0.948 ms | Index Only Scan Backward, no sort, 0.944 ms |
| `createdAt ASC` first block (limit 51) | Index Only Scan, no sort, 0.127 ms | Index Only Scan, no sort, 0.113 ms |
| `createdAt ASC` next block (keyset) | Index Only Scan, no sort, 1.939 ms | Index Only Scan, no sort, 1.297 ms |
| `createdAt DESC` + search | Index Scan Backward, no sort, 2.017 ms | Index Scan Backward, no sort, 2.503 ms |
| Capped count probe (limit 1,001) | Index Scan (`customers_tenant_id_idx`), 0.435 ms | Index Scan (`vehicles_tenant_id_idx`), 0.356 ms |

## Customers

### list createdAt DESC, first block
```
Limit  (cost=0.41..7.98 rows=51 width=45) (actual time=0.109..0.136 rows=51 loops=1)
  Buffers: shared hit=5 read=1
  ->  Index Only Scan Backward using "customers_tenant_id_createdAt_id_idx" on customers  (cost=0.41..5214.80 rows=35147 width=45) (actual time=0.108..0.130 rows=51 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Heap Fetches: 51
        Buffers: shared hit=5 read=1
Planning Time: 1.319 ms
Execution Time: 0.176 ms
```

### list createdAt DESC, next block (keyset)
```
Limit  (cost=0.41..12.64 rows=51 width=45) (actual time=0.895..0.912 rows=51 loops=1)
  Buffers: shared hit=106
  ->  Index Only Scan Backward using "customers_tenant_id_createdAt_id_idx" on customers  (cost=0.41..5478.40 rows=22852 width=45) (actual time=0.894..0.906 rows=51 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Filter: (("createdAt" < '2026-01-01 09:00:00'::timestamp without time zone) OR (("createdAt" = '2026-01-01 09:00:00'::timestamp without time zone) AND (id < '88888888-8888-4888-8888-888888888888'::text)))
        Rows Removed by Filter: 2600
        Heap Fetches: 2651
        Buffers: shared hit=106
Planning Time: 0.165 ms
Execution Time: 0.948 ms
```

### list createdAt ASC, first block
```
Limit  (cost=0.41..7.98 rows=51 width=45) (actual time=0.072..0.093 rows=51 loops=1)
  Buffers: shared hit=1 read=4
  ->  Index Only Scan using "customers_tenant_id_createdAt_id_idx" on customers  (cost=0.41..5214.80 rows=35147 width=45) (actual time=0.072..0.088 rows=51 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Heap Fetches: 51
        Buffers: shared hit=1 read=4
Planning Time: 0.091 ms
Execution Time: 0.127 ms
```

### list createdAt ASC, next block (keyset)
```
Limit  (cost=0.41..8.97 rows=51 width=45) (actual time=1.869..1.907 rows=51 loops=1)
  Buffers: shared hit=5 read=137
  ->  Index Only Scan using "customers_tenant_id_createdAt_id_idx" on customers  (cost=0.41..5478.40 rows=32643 width=45) (actual time=1.868..1.902 rows=51 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Filter: (("createdAt" > '2026-01-01 01:00:00'::timestamp without time zone) OR (("createdAt" = '2026-01-01 01:00:00'::timestamp without time zone) AND (id > '88888888-8888-4888-8888-888888888888'::text)))
        Rows Removed by Filter: 3599
        Heap Fetches: 3650
        Buffers: shared hit=5 read=137
Planning Time: 0.126 ms
Execution Time: 1.939 ms
```

### list createdAt DESC + search
```
Limit  (cost=0.41..199.33 rows=51 width=45) (actual time=0.026..1.982 rows=51 loops=1)
  Buffers: shared hit=56
  ->  Index Scan Backward using "customers_tenant_id_createdAt_id_idx" on customers  (cost=0.41..5566.27 rows=1427 width=45) (actual time=0.025..1.976 rows=51 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Filter: ((first_name ~~* '%smith%'::text) OR (last_name ~~* '%smith%'::text) OR (company_name ~~* '%smith%'::text) OR (email ~~* '%smith%'::text))
        Rows Removed by Filter: 950
        Buffers: shared hit=56
Planning Time: 0.802 ms
Execution Time: 2.017 ms
```

### capped count probe (1001)
```
Limit  (cost=0.29..45.86 rows=1001 width=37) (actual time=0.064..0.325 rows=1001 loops=1)
  Buffers: shared hit=25 read=2
  ->  Index Scan using customers_tenant_id_idx on customers  (cost=0.29..1600.36 rows=35147 width=37) (actual time=0.063..0.249 rows=1001 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Buffers: shared hit=25 read=2
Planning Time: 0.083 ms
Execution Time: 0.435 ms
```

## Customer vehicles

### list createdAt DESC, first block
```
Limit  (cost=0.41..7.98 rows=51 width=45) (actual time=0.040..0.066 rows=51 loops=1)
  Buffers: shared hit=6
  ->  Index Only Scan Backward using "vehicles_tenant_id_createdAt_id_idx" on vehicles  (cost=0.41..5206.84 rows=35085 width=45) (actual time=0.039..0.061 rows=51 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Heap Fetches: 51
        Buffers: shared hit=6
Planning Time: 2.542 ms
Execution Time: 0.094 ms
```

### list createdAt DESC, next block (keyset)
```
Limit  (cost=0.41..12.65 rows=51 width=45) (actual time=0.894..0.911 rows=51 loops=1)
  Buffers: shared hit=106
  ->  Index Only Scan Backward using "vehicles_tenant_id_createdAt_id_idx" on vehicles  (cost=0.41..5469.98 rows=22807 width=45) (actual time=0.893..0.906 rows=51 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Filter: (("createdAt" < '2026-01-01 09:00:00'::timestamp without time zone) OR (("createdAt" = '2026-01-01 09:00:00'::timestamp without time zone) AND (id < '88888888-8888-4888-8888-888888888888'::text)))
        Rows Removed by Filter: 2601
        Heap Fetches: 2652
        Buffers: shared hit=106
Planning Time: 0.320 ms
Execution Time: 0.944 ms
```

### list createdAt ASC, first block
```
Limit  (cost=0.41..7.98 rows=51 width=45) (actual time=0.057..0.073 rows=51 loops=1)
  Buffers: shared hit=5
  ->  Index Only Scan using "vehicles_tenant_id_createdAt_id_idx" on vehicles  (cost=0.41..5206.84 rows=35085 width=45) (actual time=0.056..0.068 rows=51 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Heap Fetches: 51
        Buffers: shared hit=5
Planning Time: 0.247 ms
Execution Time: 0.113 ms
```

### list createdAt ASC, next block (keyset)
```
Limit  (cost=0.41..8.99 rows=51 width=45) (actual time=1.247..1.264 rows=51 loops=1)
  Buffers: shared hit=141
  ->  Index Only Scan using "vehicles_tenant_id_createdAt_id_idx" on vehicles  (cost=0.41..5469.98 rows=32529 width=45) (actual time=1.247..1.259 rows=51 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Filter: (("createdAt" > '2026-01-01 01:00:00'::timestamp without time zone) OR (("createdAt" = '2026-01-01 01:00:00'::timestamp without time zone) AND (id > '88888888-8888-4888-8888-888888888888'::text)))
        Rows Removed by Filter: 3600
        Heap Fetches: 3651
        Buffers: shared hit=141
Planning Time: 0.230 ms
Execution Time: 1.297 ms
```

### list createdAt DESC + search
```
Limit  (cost=0.41..162.24 rows=51 width=45) (actual time=0.028..2.471 rows=51 loops=1)
  Buffers: shared hit=56
  ->  Index Scan Backward using "vehicles_tenant_id_createdAt_id_idx" on vehicles  (cost=0.41..5645.40 rows=1779 width=45) (actual time=0.028..2.464 rows=51 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Filter: ((make ~~* '%octavia%'::text) OR (model ~~* '%octavia%'::text) OR (plate ~~* '%octavia%'::text) OR (vin ~~* '%octavia%'::text) OR (engine_code ~~* '%octavia%'::text))
        Rows Removed by Filter: 950
        Buffers: shared hit=56
Planning Time: 0.571 ms
Execution Time: 2.503 ms
```

### capped count probe (1001)
```
Limit  (cost=0.29..45.85 rows=1001 width=37) (actual time=0.030..0.295 rows=1001 loops=1)
  Buffers: shared hit=26
  ->  Index Scan using vehicles_tenant_id_idx on vehicles  (cost=0.29..1597.28 rows=35085 width=37) (actual time=0.030..0.220 rows=1001 loops=1)
        Index Cond: (tenant_id = '11111111-1111-4111-8111-111111111111'::text)
        Buffers: shared hit=26
Planning Time: 0.144 ms
Execution Time: 0.356 ms
```
