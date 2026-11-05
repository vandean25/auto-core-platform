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
| `GET /api/vehicle-stock` | `make`, `model`, `year`, `vin`, `plate`, `color`, `stock_status`, `updatedAt` | yes | yes | 50 | `GET /api/vehicle-stock/capped-count` |
| `GET /api/inventory` | `sku`, `name`, `price` (`retail_price`) | yes | yes | 100 (default page size 10) | `GET /api/inventory/capped-count` |

**Vehicle stock cursor constraints:** merged ON_ORDER / draft rows stay **offset-only**. Cursor and capped count require a `stock_status` filter that excludes draft merge (any value except unset / `ON_ORDER`).

**Offset-only sorts (unchanged):** relation, computed, and relevance sorts on each view (e.g. inventory status/location columns) remain offset until separately approved.

## Consumers (API)

| Endpoint | Primary consumers | Notes |
| --- | --- | --- |
| `GET /api/vehicle-stock` | `apps/core-web` `vehicleStockKeys` / Vehicle stock pages | Offset DataTable today; cursor additive |
| `GET /api/inventory` | `apps/core-web` inventory hooks / Item list | Offset today |
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

## Index migrations (additive)

See migration `20261105120000_aut888_list_cursor_keyset_indexes`: `(tenant_id, [site_id], sort_col, id)` for each whitelisted pilot sort on `catalog_items` and site-scoped `vehicles`.

## Query plan evidence

LF 10a adds indexes aligned with keyset `ORDER BY`. CI e2e Postgres does not bulk-load catalog-scale rows, so **synthetic EXPLAIN evidence** is captured separately:

- **Doc:** [aut888-list-cursor-explain-evidence.md](./aut888-list-cursor-explain-evidence.md) — disposable local PG 16, **15 000** synthetic `catalog_items` + **5 000** synthetic dealer-stock `vehicles`, raw `EXPLAIN (ANALYZE, BUFFERS)` for pilot sorts and capped-count probes.
- **Reproduce:** `tools/aut888-list-cursor-explain/run-local-explain.sh` (synthetic data only; no QA/prod).

At that fixture size, keyset list sorts use the new composite indexes; capped-count id probes may still **seq scan** with a tenant filter (documented in the evidence summary — not hidden).
