---
title: "Invoice list query-plan evidence (AUT-891)"
date: "2026-11-06"
status: draft
tags: [platform, tables, adr-0035, database]
---

# Invoice list query-plan evidence (AUT-891)

Evidence for the ADR-0035 invoice cursor list (`GET /api/sales/invoices?pagination=cursor`, sorts `invoice_number` and `date`, unique `id` tiebreaker, `NULLS LAST` in both directions).

**What this is:** hand-written SQL approximating the shape Prisma sends, run on a disposable local PostgreSQL 16 with **synthetic** data: two tenants with 30,000 invoices each (5 % drafts without a number, 40 invoices per day so dates tie). **What this is not:** catalog or production scale, Prisma-emitted SQL, or QA. Re-measure on QA with Prisma-emitted SQL and real data volumes.

Reproduce: `tools/aut891-invoice-list-explain/seed-synthetic.sql` and `explain-queries.sql` against a freshly migrated, disposable database (`prisma migrate deploy`, then `psql -f`).

## Results (tenant A, page size 50 + 1)

| # | Query | Plan | Execution |
| --- | --- | --- | --- |
| 1 | Number ASC, first page | Index scan `invoices_tenant_id_invoice_number_id_idx` | 0.3 ms |
| 2 | Number ASC, continuation mid-list | Index scan on the existing unique `(tenant_id, invoice_number)` index, incremental sort, 14,250 rows removed by filter | 6.6 ms |
| 3 | Number DESC NULLS LAST, first page | Index scan `invoices_tenant_id_invoice_number_desc_nulls_last_id_idx` | 0.06 ms |
| 4 | Date DESC, first page (the default) | Backward index scan `invoices_tenant_id_date_id_idx` | 0.06 ms |
| 5 | Date DESC, continuation mid-list | Backward index scan, 15,361 rows removed by filter | 7.7 ms |
| 6 | Search on the number, date DESC | Bitmap scan on the existing trigram index `invoices_invoice_number_trgm_idx` (0 hits in this fixture) | 0.5 ms |
| 7 | Search on the number without a match | Same trigram bitmap scan | 0.2 ms |
| 8 | Capped count probe (no search) | Seq scan stops after 1,001 rows | 0.4 ms |
| 9 | Combined search (number OR customer name OR status) without a match | Backward date index scan with the whole predicate as a filter: **30,000 rows removed, ~21,000 buffers** | 21.7 ms |

## Findings

1. **Number DESC needs its own index.** Before the raw index was added, query 3 was a bitmap scan of the whole tenant plus a top-N sort (43 ms at 30,000 rows, growing with the tenant's invoice count), because a plain ascending index only serves `DESC NULLS FIRST` backwards. The migration therefore adds `(tenant_id, invoice_number DESC NULLS LAST, id DESC)` as raw SQL; Prisma cannot declare NULLS ordering, so (like the partial indexes of earlier migrations) it is not in `schema.prisma`.
2. **Continuation is not a constant-time seek.** Queries 2 and 5 walk the index from the start and filter (cost grows with page depth), as already documented for AUT-888. Under the 2,000-row product cap this is bounded, and the old list loaded every invoice into the browser.
3. **The combined search is the weak spot.** Query 9 (what the list actually sends once a search term is typed, because the number, customer-name and status branches are `OR`ed) cannot use the trigram index and reads the tenant's invoices in date order; the cost is linear in the tenant's invoice count when nothing matches. It is not a regression against the previous full download, but it is **not** index-served. A follow-up decision (search-specific index or splitting the search) is out of scope here.
4. Query 2's existing unique index already orders `(tenant_id, invoice_number)`, which is why query 1's new index is only chosen for the first page.
