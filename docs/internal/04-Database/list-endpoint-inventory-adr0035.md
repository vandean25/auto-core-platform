---
title: "List endpoint inventory (ADR-0035 pilot)"
date: "2026-11-05"
status: draft
tags: [platform, tables, adr-0035]
---

# List endpoint inventory (ADR-0035 pilot)

Rollout step 1 from [concept-list-scrolling](../00-Inbox/concept-list-scrolling.md) §7. Cursor mode is **opt-in** (`pagination=cursor` or `cursor` query param). Offset contracts stay default.

## Pilot endpoints (LF 10a)

| Endpoint | Sort field | ASC cursor | DESC cursor | Default limit cap | Capped count |
| --- | --- | --- | --- | --- | --- |
| `GET /api/vehicle-stock` | `make`, `model`, `year`, `vin`, `plate`, `color`, `updatedAt` | yes | yes | 50 | `GET /api/vehicle-stock/capped-count` |
| `GET /api/inventory` | `sku`, `name`, `price` (`retail_price`) | yes | yes | 100 (default page size 10) | `GET /api/inventory/capped-count` |

## Invoice wave (AUT-891)

| Endpoint | Sort field | ASC cursor | DESC cursor | Default / cap | Capped count |
| --- | --- | --- | --- | --- | --- |
| `GET /api/sales/invoices?pagination=cursor` | `invoice_number` (nullable, drafts last), `date` (default, newest first) | yes | yes | 25 / 100 | `GET /api/sales/invoices/capped-count` |

Offset-style (unpaged array) response stays for every request without `pagination=cursor` / `cursor`. Customer name (relation), status and total are **not** approved for cursor paging and keep the unpaged list in the browser. Search (cursor and count): invoice number (contains), customer first/last/company name (all words must match), status. Permission: `invoice.read` (TECH gets 403). The list stays tenant-wide as before; the cursor is additionally bound to the session's active site. Indexes: migration `20261106120000_aut891_invoice_list_cursor_indexes`. Plans: [aut891-invoice-list-explain-evidence.md](./aut891-invoice-list-explain-evidence.md).

Offset removal for invoices: **not yet.** The unpaged array is still the data source of the customer, status and total sorts, so the endpoint keeps it.

**Vehicle stock cursor constraints:** merged ON_ORDER / draft rows stay **offset-only**. Cursor and capped count require a `stock_status` filter that excludes draft merge (any value except unset / `ON_ORDER`).

**Offset-only sorts (unchanged):** relation, computed, and relevance sorts on each view (e.g. inventory status/location columns) remain offset until separately approved.

## Consumers (API)

| Endpoint | Primary consumers | Notes |
| --- | --- | --- |
| `GET /api/vehicle-stock` | `apps/core-web` `vehicleStockKeys` / Vehicle stock list | Infinite list (AUT-890) when a draft-free status is selected and the sort is a cursor sort; "all statuses" and `stock_status` sort stay offset |
| `GET /api/inventory` | `apps/core-web` inventory hooks / Item list | Infinite list (AUT-890) on `sku`, `name`, `price` or no sort; any other sort stays offset |
| `GET /api/sales/invoices` | `apps/core-web` `invoiceKeys` / Invoice list | Infinite list (AUT-891) on `invoice_number`, `date` or no sort; customer, status and total sort stay unpaged |
| MCP `list_catalog_items` | Agent MCP read tools | Separate keyset; not replaced in LF 10a |

## Search / filter fields (server-side)

| Endpoint | Search | Filters |
| --- | --- | --- |
| Vehicle stock | `vin`, `plate`, `make`, `model`, `color` (contains, case-insensitive OR) | `stock_status` |
| Inventory | `name`, `sku`, brand name (contains OR) | `location`, `brand`, `brandId` |

Cursor payload binds a hash of normalized filter context plus tenant and active site id (session-scoped, ADR-0013 / ADR-0022).

## Exports

| Endpoint | Export scope | Cursor pilot impact |
| --- | --- | --- |
| Vehicle stock | Listing export per vehicle (`/listing/export/*`) | none |
| Inventory | No list-wide server export in pilot | none |

## Realtime invalidations

| Entity / domain | Frontend cache keys | Infinite-list note (LF 10b+) |
| --- | --- | --- |
| `Vehicle` (dealer stock) | `vehicleStockKeys` | Mark stale; no retained-page refetch (ADR-0035 §7) |
| `CatalogItem` / stock | `inventoryKeys` (TanStack) | Same explicit refresh contract |
| `Invoice` (new `INVOICE` event, AUT-891) | `invoiceKeys.all` | Cursor lists are marked stale without refetch; "Liste aktualisieren" |

## Index migrations (additive)

See migration `20261105120000_aut888_list_cursor_keyset_indexes`: `(tenant_id, [site_id], sort_col, id)` for each whitelisted pilot sort on `catalog_items` and site-scoped `vehicles`.

## Query plan evidence

LF 10a adds indexes aligned with keyset `ORDER BY`. CI e2e Postgres does not bulk-load catalog-scale rows, so **synthetic EXPLAIN evidence** is captured separately:

- **Doc:** [aut888-list-cursor-explain-evidence.md](./aut888-list-cursor-explain-evidence.md) — disposable local PG 16, **15 000** synthetic `catalog_items` + **5 000** synthetic dealer-stock `vehicles`, raw `EXPLAIN (ANALYZE, BUFFERS)` for pilot sorts and capped-count probes.
- **Reproduce:** `tools/aut888-list-cursor-explain/run-local-explain.sh` (synthetic data only; no QA/prod).

At that fixture size, **first-page** keyset sorts often start from the matching composite index on `(tenant_id, sort_col, id)` (inventory) or `(tenant_id, site_id, sort_col, id)` on `vehicles` when the planner can apply predicates as index conditions. **Mid-list continuation** may still walk the index from the start and apply sort/keyset predicates as **Filter** (cost grows with page depth — see evidence doc). Vehicle list filters set **`vehicles.site_id`** and **`location.site_id`** (equivalent for parked stock under the composite FK). Capped-count id probes may still **seq scan** with filters (documented in the evidence summary).

Under the product list cap (~2 000 visible rows), deep continuation is bounded in practice, but it is **not** a constant-time seek per page; LF 10b UI should still prefer refresh over retaining many stale pages (ADR-0035 §7).

## Pilot UI mode (AUT-890)

The frontend chooses one mode per list state and never mixes cursor and offset inside one query. `isInventoryCursorSort` and `isVehicleStockCursorMode` (`apps/core-web/src/api/`) are the single source of the switch.

| List | Infinite (cursor, blocks of 50, 2 000-row cap) | Offset (pages) |
| --- | --- | --- |
| Parts | no sort, `sku`, `name`, `price` | any other `sortField` (hand-edited link, saved view) |
| Vehicle stock | status filter In stock / Reserved / In prep / Sold, with no sort or `make`, `model`, `year`, `vin`, `plate`, `color`, `updatedAt` | "All statuses" (merges draft purchases), status On order, sort `stock_status` |

Search-filtered plans: [aut890-search-filter-explain-evidence.md](./aut890-search-filter-explain-evidence.md).
