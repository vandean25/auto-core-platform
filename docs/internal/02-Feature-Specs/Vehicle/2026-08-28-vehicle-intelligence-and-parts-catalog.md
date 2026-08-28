---
title: "Vehicle Intelligence & Parts Catalog"
date: "2026-08-28"
module: "Vehicle"
status: draft
linear-project: "https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b"
linear-milestone: "M1 Vehicle identity & ephemeral search"
tags:
  - feature-spec
  - vehicle
  - catalog
  - inventory
  - workshop
  - purchase
  - labor
---

# Vehicle Intelligence & Parts Catalog

## Summary

> Identify a vehicle from VIN (plate adapters later), search fitment-aware parts and labor through provider ports, and materialize a `CatalogItem` only when the advisor adds a part to the job. OEM catalogs (BMW, Mercedes, Stellantis) win by **OEM concern**, resolved from a canonical vehicle-make `Brand` — not from free-text `Vehicle.make`. Aftermarket is the fallback with an explicit advisor choice when OEM is empty or down. Shortage qty is reserved in slices. **M2 replaces `replaceTaskLineItems` delete-all** with an ID-based diff. Qty types are **`Decimal(10, 3)`**. **Release** returns `quantity_staged` only. Consumed qty stays billable: `CANCELLED` means zero consumed; leftover-release shrinks `line.quantity` to consumed. Receive/consume/release take `SELECT … FOR UPDATE`. `CatalogItem.cost_price` is nullable (unknown ≠ 0). ATP uses parameterized SQL.

Architecture: [ADR-0021](../../01-ADR/2026-08-28-vehicle-intelligence-catalog-providers.md). Spec + ADR are the implementation source of truth for the locks below. ADR status stays **Proposed** until product marks it Accepted.

**Out of this project:** Kostenvoranschlag / customer approval ([Customer Communication](https://linear.app/auto-core-platform/project/customer-communication-and-approvals-49b9200f083b)); live wholesaler punchout (M4); adding `PurchaseOrderStatus.CANCELLED` (cancel reservations/requisitions, or delete a `DRAFT` PO).

### Review locks (pass 2)

| # | Decision |
|---|---------|
| P1 qty | `Decimal(10, 3)` end-to-end for parts stock, reserved, PO, reservation, and related sales/invoice/workshop line quantities. Do not keep integer stock beside decimal job lines. `VehicleStock.quantity_on_hand` stays `Int` (whole vehicles, ADR-0016). |
| P1 cancel-after-send | `ORDERED → CANCELLED` detaches remaining PO demand. SENT PO stays. Later receipt is free warehouse stock. **Superseded in part by pass 3:** receipt no longer blocks release. |
| P1 labor cost | `LaborCategory.default_internal_cost_rate`. Snapshot to `WorkshopTaskLineItem.internal_cost_rate` when set; otherwise **null**. Never copy the selling rate (unknown margin ≠ zero). |
| P1 SKU | `{source}-{normalized-brand}-{normalized-article}-{short-hash}` assigned once on insert. Upsert by `(tenant_id, source_system, external_article_id)`. Never rewrite SKU. |

### Review locks (pass 3)

| # | Decision |
|---|---------|
| P1 release | Any **active** slice (`OPEN`/`ORDERED`/`STAGED`) can be **released**, including partial `ORDERED` and `STAGED`. Returns tote qty via paired `TRANSFER_OUT`/`TRANSFER_IN`, clears on-hand `quantity_reserved`, detaches remaining PO demand, keeps `purchase_order_item_id` for audit, status `CANCELLED`. Line/order cancel must release every active slice. Line qty PATCH 409 if new qty < sum of active slice qty. **Pass 7:** do not release `FULFILLED`. |
| P1 qty API | Decimal storage is not enough. Replace `@IsInt()` on parts qty write DTOs with `@IsNumber({ maxDecimalPlaces: 3 })` and min `0.001`. Regen OpenAPI + frontend types. Ledger must use Prisma `Decimal`, not `Number(...)`. |
| P2 hit jti | Hit token claims include `taskId` and `jti`. Unique `(tenant_id, workshop_task_id, catalog_hit_jti)`. Same token retry is idempotent; double-click does not duplicate the line. |

### Review locks (pass 4)

| # | Decision |
|---|---------|
| P1 consume vs release | Track `quantity_staged` (returnable tote) and `quantity_consumed` separately from cumulative `quantity_received`. Consume allocates to slices FIFO. Release returns only `quantity_staged`. Never reverse `WORKSHOP_CONSUMPTION`. Soft-cancel the workshop line (`part_execution_status = CANCELLED`); do not hard-delete a line or task after reservation/ledger activity. |
| P1 hit payload | Complete signed `CatalogHitPayload`: every field needed to insert `CatalogItem` + `WorkshopTaskLineItem` is in the HMAC claims. POST body is token + optional `laborCategoryId` only. No unsigned catalog fields; no provider re-query on Add to order. |
| P2 ATP SQL | Reserve/consume ATP with parameterized `UPDATE … WHERE quantity_on_hand - quantity_reserved >= $qty`, not Prisma `updateMany` filters. Count 0 → 409. |
| P3 labor deletion | Labor spec matches ADR-0021 / `docs/deletion-policy.md` (`CatalogProviderSettings.default_labor_category_id`). |

### Review locks (pass 5)

| # | Decision |
|---|---------|
| P1 replace-all | M2 replaces `replaceTaskLineItems()` deleteMany+createMany with ID-based diff/upsert. Update in place; hard-delete only lines with no reservation/ledger; otherwise soft-cancel. Preserve snapshots, `catalog_hit_jti`, `catalog_item_id`, stable ids. |
| P1 demand vs consume | Consumed qty satisfies demand after slice cancel. `line.quantity` cannot go below `sum(quantity_consumed)`. `part_execution_status = CANCELLED` only when consumed is 0. Partially consumed lines stay billable (`CONSUMED`). Leftover-release sets `line.quantity = sum(consumed)`. Invoice PART qty = `line.quantity` (equals consumed after leftover-release). Shortage uses consumed + active remaining commitment. |
| P1 races | Receive, consume, and release take `SELECT … FOR UPDATE` plus conditional counter updates, with `parts_reservation_id` on every `WORKSHOP_CONSUMPTION`. Reconcile tote QOH to `sum(quantity_staged)`. **Pass 6:** collect all ids first, then lock globally sorted — do not lock in payload order. |
| P2 unknown cost | `CatalogItem.cost_price` becomes nullable. JIT writes `cost_price_est` or **null**, never `?? 0`. Same unknown-margin rule as labor. |

### Review locks (pass 6)

| # | Decision |
|---|---------|
| P1 OCC | Collection `PATCH` requires `expectedLineItemsVersion`. `WorkshopTask.line_items_version` increments on every line mutation (including JIT add). Stale payload → 409. IDs must belong to this tenant/task; duplicate IDs → 422. Route is **PATCH**, not PUT. **Pass 7:** compare-and-increment under task `FOR UPDATE` first in the global lock order. |
| P1 task DONE | Task cannot become `DONE` while a PART line is `PENDING_PICK`/`STAGED`, has **active** slices, or `quantity_staged > 0`. Invoice creation repeats that check. `CONSUMED` iff `sum(consumed) >= line.quantity`. Increasing qty past consumed recalculates status and creates shortage. `CANCELLED` lines omitted from invoice. **Pass 7:** active ≠ `status != CANCELLED`; `FULFILLED` slices do not block. |
| P2 batch locks | Receive/consume/release collect all line, reservation, PO-item, and stock IDs first, then `FOR UPDATE` in globally sorted id order. Concurrent reversed-order batch receipt is a required test. **Pass 7:** lock `WorkshopTask` first. |
| P2 null cost E2E | Nullable cost through Prisma, DTOs (`inventory-response.dto.ts` `CatalogItemResponseDto.cost_price`), OpenAPI, frontend types, and projections (`Number(cost)` forbidden). API test: null stays null. **Pass 7:** STOCK_PREP `WORKSHOP_COST` is consumption `cost_basis` + labor snapshot, not live catalog. |

### Review locks (pass 7)

| # | Decision |
|---|---------|
| P1 FULFILLED | Consume auto-sets reservation `FULFILLED` when `remaining_commitment = 0` and `quantity_staged = 0`. **Pass 8:** **Active** requires `status IN (OPEN, ORDERED, STAGED)` — a `CANCELLED` unreceived slice still has numerical remaining commitment. |
| P1 PO unit_cost | Keep `PurchaseOrderItem.unit_cost` required. Create-PO / requisition sheet requires clerk-confirmed cost per slice. Prefill from `cost_price_est` or catalog cost; omit/null → 422, never coerce to 0. **Pass 8:** `>= 0`, max 2 decimals; freeze after any receipt. |
| P1 task lock | Global `FOR UPDATE` order: tasks (sorted) → lines → reservations → PO items → stock. Collection PATCH compare-and-increments `line_items_version` as the first guarded write. JIT, pick, receive, consume, release, qty change, task DONE, and invoice lock/increment the task in the same transaction. |
| P2 STOCK_PREP basis | `WORKSHOP_COST` = Σ `\|WORKSHOP_CONSUMPTION.quantity\| × cost_basis` + Σ labor hours × snapshotted `internal_cost_rate`. **Pass 8:** stamp `tote_cost_basis` when stock enters the tote (pick/receive), copy unchanged to consume — not live PO/`CatalogItem` at consume time. |

### Review locks (pass 8)

| # | Decision |
|---|---------|
| P1 active | **Active** = `status IN (OPEN, ORDERED, STAGED)` AND (`remaining_commitment > 0` OR `quantity_staged > 0`). Do not add `quantity_cancelled`. Release of unreceived ORDERED qty 4 is `CANCELLED` with formula remaining 4, and must not block `DONE` or count as shortage. |
| P1 tote cost | Snapshot cost when qty enters the tote onto `PartsReservation.tote_cost_basis`. PO: this receipt’s `PURCHASE_RECEIPT.cost_basis`. ON_HAND: pick-time last inbound at the **source location**. Consume copies it. Freeze `unit_cost` once received. **Pass 9:** freeze at first tote entry (including null); return `TRANSFER_IN` carries `tote_cost_basis`; atomic `WHERE quantity_received = 0`. |
| P2 unitCost DTO | `unitCost` `>= 0`, max 2 decimals. **Pass 9:** JSON number only — do not `@Type(() => Number)` (`""` → 0). |

### Review locks (pass 9)

| # | Decision |
|---|---------|
| P1 linked PO qty | Reservation-linked PO item `quantity` is not independently mutable (`PATCH` → 409). Qty changes go through the workshop/reservation path and update both rows in one tx under the task-first lock, and only while `DRAFT` and `quantity_received = 0`. After SENT/receipt, PO qty stays frozen. |
| P1 linked PO delete | `DELETE` item / `DELETE` DRAFT PO with linked reservations: DRAFT + unreceived → transactional unlink. **Pass 10:** cancel the reservation (`CANCELLED`) so the line shortage reappears; do not leave it `OPEN`. |
| P1 unitCost empty | `unitCost` must be a JSON number. No `@Type(() => Number)`. `""`, `" "`, string `"0"` → **400** (DTO). Explicit numeric `0` still allowed. |
| P1 freeze atomic | `UPDATE purchase_order_items SET unit_cost = $cost WHERE id = $id AND tenant_id = $tid AND quantity_received = 0`. Count 0 → 409. Receipt and cost update both `FOR UPDATE` the PO item. |
| P1 return cost | Release `TRANSFER_OUT`/`TRANSFER_IN` copy `tote_cost_basis`. **Pass 10:** pick uses the latest eligible inbound **including null** `cost_basis`. |

### Review locks (pass 10)

| # | Decision |
|---|---------|
| P1 DRAFT unlink | DRAFT PO/item delete **cancels** linked unreceived reservations (`CANCELLED`, `purchase_order_item_id = null`). Raw line shortage reappears. Do not leave them `OPEN`. **Pass 11:** `PartsRequisition` `CANCELLED` only when **every** slice is `CANCELLED`; all-`FULFILLED` is `COMPLETED`, not `CANCELLED`. |
| P1 null inbound | ON_HAND pick takes the latest eligible inbound at the source bin, whether `cost_basis` is null or not. **Pass 11:** `ORDER BY created_at DESC, seq DESC` — `created_at` alone is not unique inside a transaction. |
| P1 PO header lock | Global `FOR UPDATE` order adds **`PurchaseOrder` headers** after reservations and before PO items. Required for mark-as-SENT (`OPEN` → `ORDERED`), linked item PATCH/delete, DRAFT PO delete, receive, and release. Today `markAsSent()` updates the header first — that inverts DRAFT-delete (task → header). Race: SENT vs DRAFT delete — one winner, one 409, no deadlock. |
| P2 HTTP 400 vs 422 | Keep the global `ValidationPipe` (Nest default **400** for `@IsNumber` / `@Min` / empty JSON). Do not change it repo-wide. **400** = syntactic DTO failures. **422** = semantic business rules (wrong-task id, missing `returnLocationId` when staged, labor category). OpenAPI matches that split. |

### Review locks (pass 11)

| # | Decision |
|---|---------|
| P1 requisition terminal | `PartsRequisition.status`: `DRAFT` \| `ORDERED` \| `COMPLETED` \| `CANCELLED`. **`CANCELLED`** iff every slice is `CANCELLED`. **`COMPLETED`** iff zero active and at least one `FULFILLED` (includes mixed `FULFILLED`+`CANCELLED`). **`ORDERED`** while any slice is `OPEN`/`ORDERED`/`STAGED` after SENT. Tests: all-`FULFILLED` → `COMPLETED`; mixed → `COMPLETED`; all-`CANCELLED` (DRAFT delete) → `CANCELLED`. |
| P2 inbound tie-break | Add `InventoryTransaction.seq BigInt @default(autoincrement())`. Pick latest inbound with `ORDER BY created_at DESC, seq DESC LIMIT 1`. UUID `id` is not ordered. Test: same-transaction two receipts for one item/bin (€10 then €20) → pick €20. |

---

## User Stories

- As a **service advisor**, I want to **decode a VIN into a vehicle identity bound to a vehicle-make Brand** so that **OEM routing cannot miss Peugeot as Stellantis**.
- As a **service advisor**, I want to **search parts and labor as separate concerns** so that **BMW parts can be OEM while labor is Haynes**.
- As a **service advisor**, I want **OEM results first when this make’s concern is configured** so that **dealer data wins, with an explicit path to aftermarket**.
- As a **service advisor**, I want to **be told when OEM is down or empty** so that **I know aftermarket results are not OEM**.
- As a **service advisor**, I want to **add an external part to the job** so that **ACP creates a catalog SKU without fake stock**.
- As a **service advisor**, I want to **add OEM/Haynes labor with target AW billed at a configured Labor Master rate** so that **the line has a real `quantity` and `unit_price`**.
- As a **parts clerk**, I want to **see workshop shortages, one order or all orders** so that **I can build a requisition sheet per vehicle make**.
- As a **parts clerk**, I want **each reserved unit owned by one workshop line and one PO line** so that **a partial delivery goes to exactly one job tote**.
- As a **parts clerk**, I want **one workshop line to split across shelf + several PO lines** so that **partial stock and backorders still reserve the right units**.
- As an **admin**, I want to **map many vehicle makes to one OEM concern** so that **Citroën and Opel use Stellantis, not silent aftermarket**.

---

## Slices

| Milestone | Scope | Ship when |
|-----------|-------|-----------|
| **M1** Vehicle identity & ephemeral search | VIN decode; `make_brand_id` + aliases + OEM concern; Catalog Router; **per-concern** search API; OEM-first UI + banners. No JIT, no PO. | Advisor resolves a VIN to a Brand/concern and searches parts **or** labor with source/fallback metadata. |
| **M2** JIT parts & labor snapshot | Add to order → `CatalogItem` upsert; ID-diff `PATCH` line-items with **version OCC**; nullable catalog cost E2E. No ledger write. | Stale collection PATCH 409s after a concurrent JIT add. Null cost stays null in API. |
| **M3** Requisition, PO, reservations | `Decimal(10,3)` qty + DTO validators; slices; 1:1 PO item; ATP SQL; `PURCHASE_RECEIPT` + tote; consume-aware **Release** (`quantity_staged`); soft-cancel lines. | Fluids 1.5 L round-trip. Release after consume 1.5 of 4 returns 2.5, does not recreate consumed stock. Line with a reservation cannot be hard-deleted. |
| **M4** Wholesaler B2B (later) | Live branch stock, Einkaufspreis, punchout. | Explicit trigger; not in M1–M3. |

Plate-registry adapters (AT/DE) attach to the identity port after a contract; they do not block M1.

---

## Routing (M1)

Parts and labor each run this chain on their own. The router key is **`oem_concern`** on the vehicle-make `Brand`, not `Vehicle.make` text.

| Situation | Behavior |
|-----------|----------|
| Make Brand has no OEM adapter for this **concern** (`PARTS` or `LABOR`) | Aftermarket automatically. `oemStatus = NOT_CONFIGURED`. Source chip: aftermarket. |
| OEM returns rows | OEM list primary. Client may call again with `source=AFTERMARKET` (**Search other source**). |
| OEM returns empty | Response `fallbackRequired=true`, `oemStatus=EMPTY`, `fallbackReason=EMPTY`. Client **asks**, then retries with `confirmFallback=true`. |
| OEM errors (timeout, 401, outage) | Response `fallbackRequired=true`, `oemStatus=ERROR`, `fallbackReason=ERROR`. Client **asks: OEM is currently unavailable.** Retry with `confirmFallback=true`. `retryOemAvailable=true`. Frontend chooses banner copy from `fallbackReason` — the API does not send `sourceBanner`. |

Never silent-merge OEM and aftermarket into one list. Never toast-only the outage. Never call aftermarket on OEM empty/error unless `confirmFallback=true`.

`STELLANTIS` is an **OEM concern**. Member makes (Peugeot, Citroën, Opel, Fiat, Jeep, …) are vehicle-make Brands that share that concern. Settings configure the concern once.

---

## Database Impact

### `Vehicle` (identity)

| Column | Type | Notes |
|--------|------|-------|
| `make_brand_id` | Int? | FK → `Brand` where `is_vehicle_make`. **Required after a successful resolve.** Routing uses this, never free-text `make` alone. |
| `hsn` | String? | KBA; indexed with `tsn` |
| `tsn` | String? | KBA |
| `identity_keys` | Json? | Provider key bag |
| `identity_input_fingerprint` | String? | Hash of current `vin`+`plate` (normalized) at last successful resolve |
| `identity_resolved_at` | DateTime? | Last successful resolve |
| `fuel_type` | String? | From decoder |
| `power_kw` | Int? | From decoder |

`make` / `model` remain display strings (decoder labels). `@@unique([tenant_id, vin])` unchanged.

**VIN/plate change:** the same update **clears** `identity_keys`, `make_brand_id`, `hsn`, `tsn`, `identity_input_fingerprint`, and `identity_resolved_at` immediately (do not keep the previous car’s keys or fingerprint). External search returns **409** while `make_brand_id` is null or `identity_input_fingerprint` is null or does not match current vin+plate. Re-resolve then fills keys + fingerprint + `identity_resolved_at`. A **failed** re-resolve leaves keys and fingerprint **null** — never restore the old bag.

### Make aliases and OEM concerns

| Table | Purpose |
|-------|---------|
| `VehicleMakeAlias` | Tenant-scoped map: normalized decoder string (`"PEUGEOT"`, `"Peugeot SA"`) → `Brand` (`is_vehicle_make`). Seed Stellantis members, VW/BMW/Mercedes aliases. |
| `CatalogOemConcern` | Named concern (`BMW`, `MERCEDES`, `STELLANTIS`) with optional parts adapter + labor adapter + secret refs. |
| `CatalogOemConcernMake` | Join: many vehicle-make Brands → one concern. |

Decoder flow: normalize make → `VehicleMakeAlias` → `Brand` → set `Vehicle.make_brand_id`. If no alias, create/match Brand by name and leave concern unset (automatic aftermarket). Unknown make must **not** guess Stellantis.

### `CatalogItem` (JIT)

| Column | Type | Notes |
|--------|------|-------|
| `source_system` | String? | `INTERNAL` or adapter id (`TECDOC`, `BMW`, …) |
| `external_article_id` | String? | Provider article id |
| `ean` | String? | |
| `oem_numbers` | Json? | String array of OENs (live catalog; **not** the job snapshot) |
| `cost_price` | Decimal(10,2)? | **Nullable after M2.** JIT: `cost_price_est` or null; never coerce unknown to 0. |

Unique: `(tenant_id, source_system, external_article_id)` where both external fields are set.

**SKU (immutable after insert):** assigned only on first create, never updated when brand labels or descriptions change.

```
{source}-{normalized-brand}-{normalized-article}-{short-hash}
```

- `source` = `source_system` upper snake (`BMW`, `TECDOC`).
- `normalized-brand` / `normalized-article` = uppercase `[A-Z0-9]+` with other chars dropped, truncated to 24 chars each.
- `short-hash` = first 8 hex chars of SHA-256(`tenant_id|source_system|external_article_id`) so BMW vs TecDoc of the same article cannot collide with `@@unique([tenant_id, sku])`.
- If insert hits the unique SKU constraint (astronomical), retry once with 12 hex chars. Do not invent a new algorithm per tenant.
- Upsert match is `(tenant_id, source_system, external_article_id)`, not SKU string. `CatalogItem.sku` is assigned only on insert and is never updated.

### `WorkshopTaskLineItem`

| Column | Type | Notes |
|--------|------|-------|
| `catalog_item_id` | String? | Required for `PART` after M2; pick uses this FK |
| `source_system` | String? | Copied from the hit |
| `external_operation_code` | String? | Labor provider code |
| `fitment_notes` | String? | e.g. PR-number, disc diameter |
| `cost_price_est` | Decimal? | **Snapshot** at Add to order (parts). Not read from live `CatalogItem`. |
| `oem_numbers` | Json? | **Snapshot** OEN list at Add to order (parts). |
| `labor_category_id` | String? | Category used to price external labor. `onDelete: SetNull` — historical rate is snapshotted. |
| `hourly_rate_snapshot` | Decimal? | Selling rate used; `unit_price` equals this for labor |
| `internal_cost_rate` | Decimal? | **Already exists.** Snapshot from `LaborCategory.default_internal_cost_rate` when that column is non-null; otherwise leave null. Never copy `hourly_rate_snapshot` / `default_hourly_rate` into this field. |
| `catalog_hit_jti` | String? | Single-use id from the hit token. Unique with `(tenant_id, workshop_task_id)`. |

`WorkshopTask.line_items_version` `Int @default(0)` — OCC for collection PATCH; increment on every line mutation.

`standard_aw` already exists; provider writes it. `labor_operation_id` remains null unless an internal Labor Master op is chosen.

Add `LaborCategory.default_internal_cost_rate Decimal(10,2)?`. This field does not exist today (`LaborCategory` currently has only `default_hourly_rate`).

Migrate `CatalogItem.cost_price` to **`Decimal(10, 2)?`**. Today it is required. Unknown JIT cost must stay null (same rule as labor `internal_cost_rate`). Existing manual catalog rows keep their values.

**Null cost end-to-end (same migration):**

- Projections must not coerce: `catalog.service.ts` today does `costPrice: Number(item.cost_price)` (null → `0`). Use `item.cost_price == null ? null : item.cost_price`.
- `CatalogItemResponseDto.cost_price` in `inventory-response.dto.ts` is non-null `string` today (`cost_price!: string`); make it `string | null` and mark OpenAPI nullable (`nullable: true`). Regen OpenAPI + frontend types.
- Create-inventory (`create-inventory-item.dto.ts`) may still require cost for **manual** SKUs; JIT-created items may have null.
- API test: JIT without `cost_price_est` → GET catalog/inventory returns JSON `cost_price: null`, not `"0"` / `0`.
- **STOCK_PREP vehicle costing** (pass 7): do **not** multiply `line.quantity` by live `CatalogItem.cost_price` (`vehicle-ledger.service.ts` today). Post `WORKSHOP_COST` from immutable consume/labor snapshots (see Demand / STOCK_PREP valuation).

### Replace-all line API (M2)

Today `WorkshopTaskService.replaceTaskLineItems()` (`apps/core-api/src/workshop/workshop-task.service.ts`) `deleteMany`s every line then `createMany`s the payload. `ReplaceWorkshopTaskLineItemsDto` has **no line `id`**. That wipes `catalog_hit_jti`, snapshots, and `catalog_item_id`, or FK-fails once reservations exist.

M2 **replaces** that method with an ID-based diff (**same `PATCH /orders/:orderId/tasks/:taskId/line-items` route**, not PUT; new DTO fields `id?` and `expectedLineItemsVersion`):

| Payload row | Action |
|-------------|--------|
| `id` matches an existing line **on this tenant+task** | **Update in place.** Qty/description/selling price only, subject to consume/reservation floors. Do **not** clear `catalog_item_id`, `catalog_hit_jti`, `source_system`, `cost_price_est`, `oem_numbers`, `fitment_notes`, `labor_category_id`, rate snapshots. Stable id. |
| `id` omitted | Insert a new line (from-catalog still uses the hit-token route). |
| Existing line omitted from payload | **Hard-delete** only if no `PartsReservation` and no `InventoryTransaction` for that line. Else **soft-cancel** (`part_execution_status = CANCELLED` + Release) when consumed is 0; if consumed > 0, 409 — client must leftover-release (shrink qty) rather than drop the row. |

**Optimistic concurrency:** add `WorkshopTask.line_items_version Int @default(0)`. Increment on **every** line mutation: collection PATCH, `POST .../lines/from-catalog`, leftover-release, consume, qty change. Collection PATCH **must** send `expectedLineItemsVersion` equal to the current version; mismatch → **409** (stale collection cannot hard-delete a JIT line Client B just added). Response returns the new version.

Reject **422** if: any `id` is not a line on this task/tenant; any `id` is duplicated in the payload.

Tests: replace-all after JIT keeps `catalog_hit_jti` and `catalog_item_id`; replace-all after a reservation does not delete the line; Client A stale PATCH after Client B JIT add → 409, B’s line remains; foreign-task id → 422; duplicate ids → 422.

### External labor pricing (M2)

`LaborCategory.default_hourly_rate` is nullable today. External labor **must not** insert a line with a null rate.

| Setting | Rule |
|---------|------|
| `CatalogProviderSettings.default_labor_category_id` | Required before Add to order for external labor. Category must have non-null `default_hourly_rate` (> 0, or 0 if the shop bills $0 — still not null). Else 422. |
| Advisor override | `POST .../lines/from-catalog` may send `laborCategoryId`. Same non-null rate rule. |
| AW → hours | `planned_hours = provider.hours` if the adapter returns hours; else `planned_hours = standard_aw * (aw_minutes / 60)`. |
| `CatalogProviderSettings.aw_minutes` | Tenant integer, default **6** (1 AW = 6 minutes). |
| Line write | `quantity = planned_hours`; `unit_price = hourly_rate_snapshot`; `standard_aw` as provided. `internal_cost_rate` = `LaborCategory.default_internal_cost_rate` when that column is non-null; **else null**. Never copy the selling rate into cost. Reports must treat null cost as **unknown margin**, not zero margin. |

### Tenant routing

| Table | Purpose |
|-------|---------|
| `CatalogProviderSettings` | Singleton: default identity, parts-aftermarket, labor-aftermarket adapter ids; `default_labor_category_id`; `aw_minutes`; secret refs |
| `CatalogOemConcern` | Per-concern OEM adapters (Stellantis, BMW, Mercedes) |

Vehicle-make Brands attach to a concern via `CatalogOemConcernMake`. There is no free-text make routing table.

### Quantity precision (M3 prerequisite)

Today `WorkshopTaskLineItem.quantity` and `InventoryTransaction.quantity` are decimals; `InventoryStock.quantity_on_hand` / `quantity_reserved` and `PurchaseOrderItem.quantity` / `quantity_received` are **Int**. A 1.5 L oil reservation cannot round-trip.

M3 migrates these to **`Decimal(10, 3)`** before any reservation code ships:

- `InventoryStock.quantity_on_hand`, `quantity_reserved`
- `PurchaseOrderItem.quantity`, `quantity_received`, `quantity_invoiced` (invoiced is currently `Decimal(10, 2)`)
- `PurchaseInvoiceLine.quantity`
- `PartsReservation.quantity`, `quantity_received`
- `WorkshopTaskLineItem.quantity` (already decimal; widen scale 2 → 3)
- `SalesOrderItem.quantity`, `InvoiceItem.quantity` (ATP/sales must share the scale)

`InventoryTransaction.quantity` is already `Decimal(10, 3)`. Existing integer rows migrate with scale 3 (1 → 1.000).

**Do not migrate:** `VehicleStock.quantity_on_hand` (`Int`, one vehicle = 1, ADR-0016) or `LocalInventory.quantity_on_hand` (unused by this flow).

### Quantity API boundary (M3, same prerequisite)

Prisma `Decimal(10, 3)` is not sufficient. Today `ReceiveItemDto.quantity` is `@IsInt()` (`apps/core-api/src/purchase/dto/receive-items.dto.ts`), so `1.5` is rejected before it reaches the database. The same integer validators exist on `PurchaseOrderItemDto.quantity`, `UpdatePurchaseOrderItemDto.quantity`, and `PickWorkshopPartsLineDto.quantity` (the pick DTO already has a unit test that `0.5` fails with “must be an integer”).

M3 write DTOs for parts quantities must:

- Use `@Type(() => Number)` + `@IsNumber({ maxDecimalPlaces: 3 })` + `@Min(0.001)`.
- Reject `0`, negatives, and values with more than 3 decimal places (**400**, DTO).
- Accept `1.5` and `0.001`.
- Document the same in OpenAPI (`type: number`, `minimum: 0.001`; `multipleOf: 0.001` is acceptable).

Then regenerate:

- `npm --prefix apps/core-api run openapi:generate`
- `npm --prefix apps/core-web run api:types:generate`

Sales/invoice qty fields already use `@IsNumber()` without a decimal-place cap; add `maxDecimalPlaces: 3` in the same migration so ATP-consuming writes share the scale.

**Prisma Decimal arithmetic:** `ledger.service.ts` currently aggregates and increments with `Number(...)` (comment: “Number is likely safe enough”). After the column migration that truncates `1.5` and `0.001`. All stock-cache updates (`quantity_on_hand`, `quantity_reserved`) and reservation/PO qty math must use `Prisma.Decimal` / `Decimal.js` (`add`, `sub`, `lte`) — never `Number(qty)` on a ledger path.

### Reservation and requisition (M3)

```
WorkshopTaskLineItem 1 ── N PartsReservation (qty slice)
PartsRequisition (header, vehicle-make Brand)
  └── PartsRequisitionLine ── 1 PartsReservation
PartsReservation 1 ── 1 PurchaseOrderItem     // M3 lock: never N reservations on one PO item
```

`PartsReservation`:

| Column | Notes |
|--------|-------|
| `workshop_task_line_item_id` | Owner of the units |
| `quantity` | `Decimal(10,3)` slice qty; sum per line ≤ line.quantity |
| `quantity_received` | `Decimal(10,3)`; **cumulative** qty receipted and tote-transferred. Never used as the current tote balance. |
| `quantity_consumed` | `Decimal(10,3)` default 0; qty issued from this slice’s tote via `WORKSHOP_CONSUMPTION` (ADR-0002 / ADR-0014 `CONSUMED`). |
| `quantity_staged` | `Decimal(10,3)` default 0; **current tote balance** for this slice. ON_HAND pick and PO receive both increment this (and `quantity_received`). Consume decrements it. Release returns this amount. Invariant: `quantity_staged = quantity_received - quantity_consumed - quantity_returned`. |
| `quantity_returned` | `Decimal(10,3)` default 0; qty already transferred tote → warehouse on prior/this release. |
| `kind` | `ON_HAND` \| `REQUISITION` |
| `status` | `OPEN` \| `ORDERED` \| `STAGED` \| `FULFILLED` \| `CANCELLED` — **no `RECEIVED`**. Receipt+tote is one transaction; complete receive sets `STAGED`. Partial receive stays `ORDERED` with `quantity_received` increased. Consume auto-sets **`FULFILLED`** when the slice has no staged qty and no remaining commitment. `CANCELLED` is Release only. |
| `location_id` | Required for `ON_HAND` (bin whose cache was incremented). After stage, the tote is the job’s `stagingLocationId`. |
| `requisition_line_id` | Set when `kind = REQUISITION` |
| `purchase_order_item_id` | Unique 1:1 with the PO item. **Kept after release of a SENT/received allocation** (audit). `onDelete: Restrict`. DRAFT delete **unlinks** (null) instead of keeping a dangling FK. Creating a PO inserts **one PO item per reservation**. |
| `detached_at` | DateTime? Set when remaining vendor qty is no longer job-allocated. Receive of that PO item then follows the detached path. |
| `tote_cost_basis` | `Decimal(10,2)?` Unit cost of qty that entered this slice’s tote. **Frozen at first tote entry**, including when the snapshot is **null**. Consume copies it to `WORKSHOP_CONSUMPTION.cost_basis`. Never re-read live catalog or PO `unit_cost` at consume. |

`PartsRequisition`: `tenant_id`, `vehicle_make_brand_id`, `status` (`DRAFT` \| `ORDERED` \| `COMPLETED` \| `CANCELLED`). Clerk sheet is still **per vehicle make** (Peugeot sheet ≠ Citroën sheet), while OEM *search* uses the shared Stellantis concern.

Same SKU on the printed PO may appear as two lines (job A, job B). That is intentional so a partial delivery cannot be ambiguous.

**Clerk-confirmed PO cost (M3):** `PurchaseOrderItem.unit_cost` stays **required** (`schema.prisma`). Nullable JIT `CatalogItem.cost_price` / `cost_price_est` is not a source that can be written as 0.

`POST /api/parts-requisitions/:id/create-purchase-order` body: one confirmed `unitCost` per reservation/slice. UI prefill: line `cost_price_est` if set, else `CatalogItem.cost_price` if set, else empty. Submit **400** if any slice omits `unitCost`, sends null, or sends `""` (DTO). Do **not** `@Type(() => Number)` (empty string becomes `0`). An explicit JSON-number clerk `0` (warranty/free) is allowed only when the field is a number.

**DTO (create, add-items, update-item, requisition create-PO):** `@IsNumber({ maxDecimalPlaces: 2 })` + `@Min(0)`. **Do not** `@Type(() => Number)` and do not enable `enableImplicitConversion` for this field. Global `ValidationPipe` already has `transform: true` and Nest-default **400** for decorator failures — keep that; do not set `errorHttpStatusCode: 422` globally. `unitCost` must arrive as a JSON number. `""`, `" "`, `"0"`, `"10.50"`, `null`, omitted → **400**. Explicit numeric `0` is allowed. Test `unitCost: ""` → 400.

**Freeze `unit_cost` atomically with receipt:** `updatePurchaseOrderItem` today is read-then-write (no received-qty guard). Do **not** `if (quantity_received > 0) throw` after a separate read.

```sql
UPDATE purchase_order_items
SET unit_cost = $cost
WHERE id = $id
  AND tenant_id = $tenantId
  AND quantity_received = 0
```

Affected row count 0 → **409**. Receipt and cost-update both `SELECT … FOR UPDATE` the PO item in the global lock order (tasks → lines → reservations → **PO headers** → PO items → stock). Race test: concurrent cost PATCH vs receive — one winner; posted `PURCHASE_RECEIPT.cost_basis` is the `unit_cost` that existed at receive; the other 409.

**Linked PO item quantity and delete (`purchase.service.ts` today PATCHes qty and DELETEs unreceived items with no reservation check):**

Invariant: linked `PurchaseOrderItem.quantity` = `PartsReservation.quantity`.

| API | Linked reservation |
|-----|--------------------|
| `PATCH` item `quantity` | **409**. Change demand via workshop line / leftover-release. While PO is `DRAFT` and `quantity_received = 0`, that path updates reservation qty **and** PO qty in one tx under the task-first lock. After `SENT` or any receipt, PO qty is frozen (Release does not change it). |
| `DELETE` item, PO `DRAFT`, `quantity_received = 0`, not staged | Same lock hierarchy as mark-as-SENT (tasks → … → PO header). **Cancel** the reservation: `status = CANCELLED`, `purchase_order_item_id = null`. Workshop line is unchanged, so shortage = remaining line qty. Then delete the item. |
| `DELETE` item otherwise (SENT, received, staged, or `FULFILLED`) | **409**. Release leftover on SENT; keep FK. |
| `DELETE` DRAFT PO | Same cancel+unlink for every linked unreceived item, then delete items + header. Any received/staged item → 409 (existing). |
| Prisma FK | `PartsReservation.purchase_order_item_id` `onDelete: Restrict` (naive delete must not cascade or set-null). |

**`PartsRequisition.status`:**

| Status | When |
|--------|------|
| `DRAFT` | New sheet with no slices yet; or every linked PO is still `DRAFT` **and** at least one slice is `OPEN`. |
| `ORDERED` | Mark-as-SENT succeeded **and** at least one slice is `OPEN` / `ORDERED` / `STAGED`. |
| `COMPLETED` | Zero active slices **and** at least one `FULFILLED` (including mixed `FULFILLED` + `CANCELLED`). Successful procurement is never `CANCELLED`. |
| `CANCELLED` | **Every** slice is `CANCELLED` (zero `FULFILLED`): DRAFT PO delete of the whole sheet, or Release of every remaining slice with none fulfilled. |

Do **not** treat “no active reservations” as `CANCELLED` — that is also the all-`FULFILLED` end state. Recompute the header after every slice terminal transition. Clerk rebuilds from the shortage queue after a full cancel; do not reopen a `CANCELLED` or `COMPLETED` requisition onto a deleted PO.

Unlinked (no reservation) PO items keep today’s PATCH/DELETE rules.

**Release (M3) — unconsumed tote qty only. Does not recreate consumed stock.**

ADR-0014 part-line status includes `CONSUMED`: stock has left the tote through `WORKSHOP_CONSUMPTION`. Prisma `TransactionType` does **not** yet include `WORKSHOP_CONSUMPTION` (ADR-0002 lists it; the enum is `PURCHASE_RECEIPT`, `SALE_ISSUE`, `ADJUSTMENT`, `TRANSFER_IN`, `TRANSFER_OUT`, `INITIAL_BALANCE`). First consume that hits a reserved tote **must** add that enum value. Until then `quantity_consumed` stays 0.

**Consume allocation (deterministic):** when a part line is consumed for qty `C`, allocate `C` across that line’s **active** slices in `created_at` ascending, only from slices with `quantity_staged > 0`. For each slice: `take = min(C remaining, quantity_staged)`; post `WORKSHOP_CONSUMPTION` (negative) against the job tote for `take` with **`parts_reservation_id` set** and **`cost_basis = reservation.tote_cost_basis`** (copy, do not re-derive); increment `quantity_consumed`; decrement `quantity_staged`. Leftover `C` after all slices is 409 (cannot consume more than staged). After each slice update: if `quantity_staged = 0` and `remaining_commitment = 0`, set status **`FULFILLED`** in the same statement. Do not require a Release to close a fully satisfied slice.

**Demand, CANCELLED, and invoicing (line qty 4, consume 1.5, release leftover 2.5):**

- Consumed qty **satisfies demand** even after those slices are `CANCELLED`. It must not reappear as a shortage and must remain billable.
- `line.quantity` **cannot** be reduced below `sum(quantity_consumed)` across all slices (409).
- Leftover-release of remaining demand **sets `line.quantity = sum(quantity_consumed)`** in the same transaction (4 → 1.5). Then `part_execution_status = CONSUMED`.
- **`part_execution_status = CANCELLED` only when `sum(quantity_consumed) = 0`.** A partially consumed line is never `CANCELLED`.
- **Invoice PART quantity = `line.quantity`.** After leftover-release that equals consumed. **`CANCELLED` lines are omitted from invoice projection explicitly** (filter `part_execution_status <> CANCELLED` and skip LABOR-only cancel if any). LABOR still invoices `line.quantity` (hours). Do not invent a second billable-qty column.

**`CONSUMED` requires `sum(quantity_consumed) >= line.quantity`.** If the advisor **increases** quantity above consumed (1.5 → 2.5), the line is **not** `CONSUMED`: recompute `part_execution_status` (`STAGED` if `sum(quantity_staged) > 0`, else `PENDING_PICK`) and the extra qty becomes shortage demand.

**Task `DONE` / order `COMPLETED` / invoice (extends workshop-order-lifecycle.md):**

**Active slice** =

```
status IN ('OPEN', 'ORDERED', 'STAGED')
AND (remaining_commitment > 0 OR quantity_staged > 0)
```

`remaining_commitment(slice)` = `quantity - quantity_consumed - quantity_returned` is a **counter formula only**. Release of an unreceived ORDERED qty 4 sets `CANCELLED` with consumed 0 and returned 0, so the formula still equals 4. Implementations **must** apply the status predicate; do not treat formula remaining as “active”. Do **not** add `quantity_cancelled` / `quantity_detached`. `FULFILLED` and `CANCELLED` are never active and do not block completion.

A `WorkshopTask` cannot become `DONE` while any PART line is `PENDING_PICK` or `STAGED`, has an **active** slice, or `sum(quantity_staged) > 0` on that line. 409 with the blocking line ids. A line whose reservations are all `FULFILLED` (or `CANCELLED`) and whose `part_execution_status` is `CONSUMED` (or `CANCELLED`) does not block.

`WorkshopOrder` → `COMPLETED` already requires all tasks `DONE` (existing invariant). Invoice creation (`COMPLETED` → `INVOICED`, and draft-invoice APIs) **repeats** the part-line check defensively so a tote cannot be billed as if consumed. DONE and invoice take the same `WorkshopTask` `FOR UPDATE` as other line mutations so a receipt cannot sneak in after the check.

**STOCK_PREP valuation (immutable, stamped at tote entry):** `vehicle-ledger.service.ts` today does `line.quantity × CatalogItem.cost_price`. Pass 7 consume-time “last inbound” is also wrong: a pick at €10 then a later receipt at €20 would consume at €20. `updatePurchaseOrderItem` can change `unit_cost` after receipt, so reading PO cost at consume is also mutable.

Stamp **`PartsReservation.tote_cost_basis`** when stock **first enters the tote**. That first write is the freeze — **including null**. A later non-null receipt or catalog cost must not fill it in.

| Event | `tote_cost_basis` |
|-------|-------------------|
| ON_HAND pick to tote | Latest eligible inbound at the **source bin** (not filtered to non-null): `PURCHASE_RECEIPT`, `INITIAL_BALANCE`, positive `ADJUSTMENT`, or `TRANSFER_IN`. `ORDER BY created_at DESC, seq DESC LIMIT 1`. Snapshot that row’s `cost_basis` even when **null**. PostgreSQL `now()` is stable in a transaction, so `created_at` ties; UUID `id` is not ordered. `InventoryTransaction.seq` is `BigInt @default(autoincrement())` (M3, with `WORKSHOP_CONSUMPTION`). A later null `TRANSFER_IN` (higher `seq`) wins over an older €10 receipt. If no eligible inbound exists, stamp **null** and freeze. Not live `CatalogItem.cost_price`. |
| Allocated PO receive + tote transfer | This receipt’s `PURCHASE_RECEIPT.cost_basis` (`poItem.unit_cost` **at receive time**). First tote entry wins and freezes (null or not). |
| Consume | Copy `tote_cost_basis` onto `WORKSHOP_CONSUMPTION.cost_basis` unchanged. |
| Release return | Paired `TRANSFER_OUT` (tote) + `TRANSFER_IN` (return bin) both copy `tote_cost_basis` onto `cost_basis`. Next ON_HAND pick from that bin can see this `TRANSFER_IN`. |

Labor uses the **snapshotted** `WorkshopTaskLineItem.internal_cost_rate` (already frozen at Add to order).

On STOCK_PREP complete, `WORKSHOP_COST` amount =

```
sum(|WORKSHOP_CONSUMPTION.quantity| × cost_basis) for this order
+ sum((actual_hours ?? quantity) × internal_cost_rate) for non-cancelled LABOR lines
```

**409** if any of those `cost_basis` or labor rates is null. Do not post a partial sum. Mutating catalog cost, PO `unit_cost` (blocked after receipt), or a later warehouse receipt must not change a posted `WORKSHOP_COST`. Customer (non-STOCK_PREP) invoices still use selling `unit_price`.

Required test: ON_HAND pick while last inbound at that bin is €10; then a €20 receipt elsewhere; consume → `WORKSHOP_CONSUMPTION.cost_basis = 10`.

**Release** is allowed from `OPEN`, `ORDERED`, and `STAGED` (not `FULFILLED` — already closed). Returnable tote qty is **`quantity_staged`**, never `quantity_received` and never `quantity_consumed`.

In one transaction:

1. **Return tote qty = `quantity_staged` only.** If `quantity_staged > 0`: paired `TRANSFER_OUT` (tote) + `TRANSFER_IN` (`returnLocationId`, not a tote), **both with `cost_basis = tote_cost_basis`**. Increment `quantity_returned`, set `quantity_staged = 0`. **422** if `returnLocationId` missing. Do **not** post inverse `WORKSHOP_CONSUMPTION`. If `quantity_staged = 0` (fully consumed or never staged), skip this step.
2. **Release remaining on-hand reservation:** if `kind = ON_HAND` and status is still `OPEN`, decrement `quantity_reserved` at `location_id` by the unpicked qty via the ATP SQL primitive.
3. **Detach outstanding PO demand:** if `purchase_order_item_id` is set and `detached_at` is null, set `detached_at = now()`. Keep the FK. Do not change `PurchaseOrderItem.quantity`. Later receive of that item is free warehouse stock.
4. **Audit:** reservation row + ADR-0015 log. `quantity_consumed` remains as history.
5. **End state:** `status = CANCELLED`. No hard delete of the reservation.

A fully consumed slice (`quantity_staged = 0` and `quantity_consumed > 0` and `remaining_commitment = 0`) is **`FULFILLED`**, not `CANCELLED`. Release of leftover PO qty on a *partially* consumed slice still ends `CANCELLED`. Do not require Release after a full consume.

**Workshop lines are not hard-deleted after operational history.**

`WorkshopTaskLineItem` today is `onDelete: Cascade` from `WorkshopTask`. `PartsReservation.workshop_task_line_item_id` stays **required** (ownership is the line). Therefore:

- Advisor leftover-release / “cancel remaining” → Release active slices, then `line.quantity = sum(quantity_consumed)`. If consumed is 0, `part_execution_status = CANCELLED`. If consumed > 0, status `CONSUMED` (billable). **Keep the row.**
- Advisor “delete line” with consumed 0 → same as leftover-release to qty 0 (`CANCELLED`).
- Advisor “delete line” with consumed > 0 → 409; must leftover-release (shrink to consumed) instead of dropping the row.
- Line qty PATCH to `Q`: 409 if `Q < sum(quantity_consumed)` or `Q < sum(quantity_consumed) + sum(active remaining commitment)` (release slices first). If `Q > sum(quantity_consumed)`, clear `CONSUMED` and recompute status as above (shortage for the delta).
- Hard-delete `WorkshopTaskLineItem` is forbidden once any `PartsReservation` or `InventoryTransaction` exists for that line’s catalog item on this order’s tote/bins.
- Hard-delete `WorkshopTask` is forbidden once any child line has a `PartsReservation` or inventory activity (in addition to the existing LaborEntry / invoiced-order rules). Planner no-show delete of a `SCHEDULED` order with no reservations stays as today.

Triggers that **must** call Release (same transaction):

- Workshop order cancel path (not hard-delete).
- Workshop part line **soft-cancel** (`CANCELLED`).
- Explicit `POST /api/parts-reservations/:id/release`.

Those APIs must accept `returnLocationId` and forward it. **422** if any slice has `quantity_staged > 0` and `returnLocationId` is missing.

Zero-receipt `ORDERED` release is steps 3–5 only.

### ATP and `quantity_reserved`

`PartsReservation` is the **who/how many** source of truth. `InventoryStock.quantity_reserved` already exists and is exposed by inventory APIs, but today it is only seeded or created as `0` — sales deducts `quantity_on_hand` only (`sales.service.ts`).

**ATP** at a non-tote location is `quantity_on_hand - quantity_reserved`. If that difference is **negative**, fail closed (500 + invariant alert) — do **not** `max(0, …)` and hide corruption.

Staging totes are **never** ATP for sales or other jobs. Today `checkAvailability` already subtracts `quantity_reserved` but sums **all** locations (totes included) and sales deducts raw `quantity_on_hand`. M3 must: (1) exclude `staging_tote`, (2) route sales/pick through `consumeAtp`, (3) fail closed on negative ATP.

Incoming `REQUISITION` / `ORDERED` slices are **not** in `quantity_on_hand` yet, so they are not ATP. On receive, reserved lines tote-transfer in the same transaction; **released** PO items (`detached_at` set, reservation `CANCELLED`) credit the warehouse bin as free stock.

**Enforcement lives in the inventory/reservation service**, not a caller checklist. Sales finalize, pick, new ON_HAND reservation, and `checkAvailability` must go through `reserve` / `consumeAtp` helpers (same transaction as the ledger write). Adding a new stock consumer without those helpers must fail review.

Reconciliation (M3 test + periodic assert): for each `InventoryStock` row, `quantity_reserved` equals the sum of active `ON_HAND` reservations (`OPEN`, and `ORDERED` does not apply to ON_HAND) at that `location_id` + `catalog_item_id`. Mismatch is an invariant error.

`quantity_reserved` must never exceed `quantity_on_hand`. Concurrent two reservations for the last free qty: one succeeds, the other 409.

Prisma `updateMany` **cannot** express `quantity_on_hand - quantity_reserved >= $qty` (sales today uses `quantity_on_hand: { gte }` which ignores reserved). Do **not** read-then-update.

**Locked primitive** — parameterized SQL in the same transaction as the ledger write (`Prisma.$executeRaw` / `Prisma.sql`):

```sql
UPDATE inventory_stocks
SET quantity_reserved = quantity_reserved + $qty
WHERE id = $id
  AND tenant_id = $tenant_id
  AND quantity_on_hand - quantity_reserved >= $qty
```

`$qty` is a `Decimal`. Affected row count 0 → 409. Decrement on release/pick uses the inverse (`quantity_reserved - $qty >= 0`). `SELECT … FOR UPDATE` then update is an allowed equivalent; a filter-only `updateMany` is not.

### Deletion Policy Impact

| Entity | Strategy |
|--------|----------|
| `CatalogProviderSettings` | Forbidden. Singleton; update in place. |
| `CatalogOemConcern` | Conditional hard delete when no make-joins remain. |
| `CatalogOemConcernMake` | Hard delete allowed (make returns to automatic aftermarket). |
| `VehicleMakeAlias` | Hard delete allowed. |
| `PartsRequisition` | Draft-only delete. After `ORDERED`, no hard delete: `COMPLETED` (any `FULFILLED`) or `CANCELLED` (every slice `CANCELLED`). |
| `PartsRequisitionLine` | No direct delete; cancel reservation. |
| `PartsReservation` | Release → `CANCELLED` from `OPEN`, `ORDERED`, or `STAGED`. Consume → `FULFILLED` when remaining commitment and staged are 0. DRAFT PO delete **cancels** the reservation (`CANCELLED`, `purchase_order_item_id` null) so line shortage reappears. Returns `quantity_staged` only on release. No hard delete of the reservation row. |
| `WorkshopTaskLineItem` | No hard delete after reservation/ledger. Consumed 0 → `CANCELLED`. Consumed > 0 leftover-release → qty shrink, status `CONSUMED` (billable). `replaceTaskLineItems` is an ID diff. |
| `WorkshopTask` | Existing rules, plus **blocked** after any child reservation or inventory activity. |
| `CatalogItem` (JIT) | Still no delete; supersede/inactive. |
| `LaborCategory` | Conditional. **Blocked** while it is `CatalogProviderSettings.default_labor_category_id`. `WorkshopTaskLineItem.labor_category_id` is `ON DELETE SET NULL` (rate snapshotted). Still blocked when `LaborOperation` rows or child categories exist. |

**PO cancel:** do **not** add `PurchaseOrderStatus.CANCELLED`. SENT leftover uses Release (keep `purchase_order_item_id`; later receipt is free stock). **DRAFT PO/item delete** cancels linked unreceived reservations (`CANCELLED`, null FK) then deletes the PO rows. `PartsRequisition` becomes `CANCELLED` only when **every** slice is `CANCELLED`; if any slice is `FULFILLED`, it is `COMPLETED`.

---

## State machines

### Reservation slice

```
OPEN → ORDERED (PO SENT; DRAFT PO keeps reservation OPEN)
OPEN → STAGED (on-hand pick to tote; decrement quantity_reserved; increment quantity_staged and quantity_received by pick qty)
OPEN → CANCELLED (release: drop quantity_reserved; quantity_staged is 0)
ORDERED → STAGED (this PO item fully received; PURCHASE_RECEIPT + tote TRANSFER in one tx; increment quantity_received and quantity_staged)
ORDERED → CANCELLED (release: return quantity_staged; set detached_at)
ORDERED → FULFILLED (consume: remaining_commitment = 0 and quantity_staged = 0)
STAGED → CANCELLED (release: return quantity_staged)
STAGED → FULFILLED (consume: remaining_commitment = 0 and quantity_staged = 0)
CONSUME (counter update): decrement quantity_staged, increment quantity_consumed; then FULFILLED or stay ORDERED/STAGED
FULFILLED → * (none)
CANCELLED → * (none)
```

Partial receive: increment `quantity_received` and `quantity_staged`; stay `ORDERED` until `quantity_received >= quantity`, then `STAGED`. No `RECEIVED` status.

**Receive vs released:** look up the reservation by `purchase_order_item_id`. If `status = CANCELLED` or `detached_at` is set → free-stock path (`locationId` required). If still allocated → tote-transfer to the job (`quantity_staged += qty`).

### Requisition header

```
DRAFT → ORDERED (mark-as-SENT; reservations OPEN → ORDERED)
DRAFT → CANCELLED (every slice CANCELLED; typically DRAFT PO delete)
ORDERED → COMPLETED (zero active and at least one FULFILLED)
ORDERED → CANCELLED (every remaining slice CANCELLED; none FULFILLED)
COMPLETED → * (none)
CANCELLED → * (none)
```

Do not skip `ORDERED` to label all-`FULFILLED` as `CANCELLED`. Mixed `FULFILLED` + `CANCELLED` is `COMPLETED`.

### Workshop part shortage

`remaining_commitment(slice)` = `quantity - quantity_consumed - quantity_returned`. **Active** uses the status predicate in the DONE section — **not** the formula alone. A `CANCELLED` unreceived slice still has formula remaining = original qty and must be excluded from shortage and DONE.

A line is on the clerk queue when:

```
line.quantity - sum(quantity_consumed across ALL slices) - sum(remaining_commitment of active slices) > 0
```

Consumed qty is covered even if its reservation is later `CANCELLED`. After leftover-release, `line.quantity = consumed`, so the remainder is not a shortage.

### Receive / consume / release concurrency

Transactions alone do not serialize two reads of `quantity_staged`. Consume and release can both see 2.5 and both deduct; receive can stage onto a reservation that release just cancelled.

**Lock order — collect, sort, then lock.** `line_items_version` lives on `WorkshopTask`. Locking lines first, then incrementing the parent task, deadlocks against collection PATCH (task then line). `receiveItems()` also accepts **multiple** PO items (`purchase.service.ts`).

For collection PATCH, JIT add, pick, receive, consume, release, qty change, task `DONE`, invoice validation, **mark-as-SENT**, **linked PO item PATCH/delete**, and **DRAFT PO delete**:

1. Resolve all affected `WorkshopTask` ids, `WorkshopTaskLineItem` ids, `PartsReservation` ids, `PurchaseOrder` ids, `PurchaseOrderItem` ids, and `InventoryStock` ids.
2. `SELECT … FOR UPDATE` each set **globally sorted by id**, always in this hierarchy — never client/payload order:
   1. `WorkshopTask`
   2. `WorkshopTaskLineItem`
   3. `PartsReservation`
   4. `PurchaseOrder` (headers)
   5. `PurchaseOrderItem`
   6. `InventoryStock`
3. Collection PATCH: **first guarded write** is compare-and-increment:
   `UPDATE workshop_tasks SET line_items_version = line_items_version + 1 WHERE id = $id AND line_items_version = $expected` — count 0 → 409.
   Every other line mutation (JIT, pick, receive, consume, release, qty change) increments `line_items_version` in the same transaction while holding the task lock (`SET line_items_version = line_items_version + 1 WHERE id = $id`).
   Mark-as-SENT (`purchase.service.ts` today updates the PO header first): after the locks above, `UPDATE purchase_orders SET status = SENT WHERE id = $id AND status = DRAFT` (count 0 → 409) **and** `OPEN` → `ORDERED` on linked reservations in the same tx. Never lock the PO header before tasks.
4. Then apply the conditional counter updates (count 0 → 409), never read-then-write:

- Consume: `WHERE status IN ('ORDERED','STAGED') AND detached_at IS NULL AND quantity_staged >= $take` (then `FULFILLED` when remaining commitment and staged are 0)
- Release return: `WHERE status IN ('OPEN','ORDERED','STAGED') AND quantity_staged >= $returnQty` (then set staged 0, status `CANCELLED`)
- Receive onto job: `WHERE status IN ('OPEN','ORDERED') AND detached_at IS NULL`; else free-stock path

Every `WORKSHOP_CONSUMPTION` row sets **`parts_reservation_id`** (nullable FK on `InventoryTransaction`; `reference_id` remains the workshop order number).

Reconciliation (M3 test + periodic assert): for each tote `InventoryStock`, `quantity_on_hand` equals `sum(quantity_staged)` of reservations whose current tote is that location. Mismatch is an invariant error.

Race tests: consume-vs-release, receive-vs-release, double-consume, **two `receiveItems` batches with reversed PO-item order**, collection PATCH vs consume (task locked first), **mark-as-SENT vs DRAFT PO delete** — one winner, one 409, no deadlock, tote QOH matches `sum(quantity_staged)`.

---

## API Contract Changes

### HTTP status (do not change the global pipe)

`createGlobalValidationPipe()` uses Nest defaults (`transform: true`, no `errorHttpStatusCode`). Decorator failures (`@IsNumber`, `@Min`, `@IsInt`, empty/`""` bodies) return **400**. Changing that globally would retarget every endpoint.

| Status | Use |
|--------|-----|
| **400** | Syntactic DTO validation (including `unitCost: ""`, `quantity: 1.5001`, omitted required fields). Document these as 400 in OpenAPI. |
| **422** | Semantic business rules on a syntactically valid body (foreign-task line id, duplicate ids, labor category missing/null rate, `returnLocationId` required because `quantity_staged > 0`). |
| **409** | Concurrency / state conflicts (stale `line_items_version`, `quantity_received = 0` cost freeze lost the race, mark-as-SENT vs DRAFT delete). |

### Identity (M1)

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| POST | `/api/vehicles/:id/resolve-identity` | VIN decode; persist key bag, `make_brand_id`, display make/model | session, not TECH |

### External catalog search (M1) — new routes

Do **not** overload `GET /api/catalog/search`. That endpoint stays local LaborOperation + MasterPart/CatalogItem search (`q` + `workshopOrderId`, both concerns in one body).

| Method | Route | Query | Description |
|--------|-------|-------|-------------|
| GET | `/api/catalog/external/search` | `workshopOrderId` (required), `concern` = `PARTS` \| `LABOR` (required), `q` optional, `source` = `AUTO` \| `OEM` \| `AFTERMARKET` (default `AUTO`), `confirmFallback` boolean (default false) | Router for **one** concern |
| GET | `/api/catalog/external/assembly-groups` | `workshopOrderId`, `concern=PARTS` | Group tree from the **active** parts source |

`source=AUTO` (default): run the OEM-first chain. If OEM empty/error, return **no aftermarket rows**, `fallbackRequired=true`. Client shows the ask dialog, then repeats with `confirmFallback=true` (and `source=AUTO` or `AFTERMARKET`).

`source=AFTERMARKET` with OEM configured is **Search other source** (allowed when OEM already returned hits, or after confirm).

Response (single concern):

```
{
  concern: "PARTS" | "LABOR",
  sourceUsed: "OEM" | "AFTERMARKET",
  oemStatus: "HIT" | "EMPTY" | "ERROR" | "NOT_CONFIGURED",
  fallbackRequired: boolean,
  fallbackReason: "EMPTY" | "ERROR" | null,
  retryOemAvailable: boolean,
  items: [ ... ]
}
```

Frontend maps `fallbackReason` to copy. Do not persist hits. 409 if vehicle identity is stale (`make_brand_id` null, fingerprint null, or fingerprint mismatch).

### JIT (M2)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/workshop/orders/:id/tasks/:taskId/lines/from-catalog` | Body: **hit token** + optional `laborCategoryId` only. JIT upsert + insert line |

No unsigned catalog fields in the body. If a column is required to insert `CatalogItem` or `WorkshopTaskLineItem`, it is a **signed claim**. Do not re-query the provider on Add to order. Do not add a separate hit-store table in M1–M3 (the signed payload is the store).

`CatalogHitPayload` (HMAC, TTL ≤ 15 minutes):

**Binding (all concerns):** `tenantId`, `workshopOrderId`, `vehicleId`, `taskId`, `concern` (`PARTS` \| `LABOR`), `source_system`, `external_id`, `jti`, `exp`.

**PARTS (required to write `CatalogItem` + line — `name`, `sku`/`item_no`, `description` are non-null today):** `name`, `article_number`, `unit_price`. Optional: `brand_label` (Brand match + SKU segment; empty → `UNKNOWN`), `ean`, `unit` (default `pcs`), `fitment_notes`, `cost_price_est`, `oem_numbers` (string array).

JIT mapping: `CatalogItem.name = name`; `CatalogItem.retail_price = unit_price`; **`CatalogItem.cost_price = cost_price_est` when present, else `null`** (never `?? 0`); `CatalogItem.unit = unit ?? pcs`; `CatalogItem.ean = ean`; SKU from `{source}-{normalized(brand_label)}-{normalized(article_number)}-{short-hash}`; line `item_no = sku`; line `description = name`; line `cost_price_est` snapshot matches (null if unknown). Reports treat null catalog/line cost as **unknown margin**, not zero.

**LABOR (required for line `item_no` + `description`):** `name` (line description), `external_operation_code` (line `item_no` and `external_operation_code`). Optional: `standard_aw`, `planned_hours`. Selling `unit_price` is **not** in the token — it comes from `LaborCategory` at write time.

Reject (401/409) on tamper, expiry, tenant mismatch, workshop/vehicle mismatch, **URL `:taskId` ≠ claims.taskId**, concern mismatch, or missing required claims for that concern.

**Single-use:** persist `catalog_hit_jti` on the new `WorkshopTaskLineItem`. Unique `(tenant_id, workshop_task_id, catalog_hit_jti)` in the same transaction as the line insert. Retry/double-click with the same token on the same task returns the **existing** line (idempotent 200). A second distinct `jti` creates a second line. Tests: tamper, cross-tenant replay, wrong-order replay, **wrong-task replay**, expiration, **idempotent retry**, missing `name`/`article_number` 401.

TECH cannot add billable catalog lines (ADR-0014).

### Requisition (M3)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/parts-requisitions/shortages` | Queue: one order or all open orders |
| POST | `/api/parts-requisitions` | Create/update make-sheet from selected shortages |
| POST | `/api/parts-requisitions/:id/create-purchase-order` | **One `PurchaseOrderItem` per reservation.** Body: clerk-confirmed `unitCost` per slice (JSON number `>= 0`, max 2 decimals; **400** if `""` / null / omitted / negative / over-precision; never `@Type(() => Number)`). |
| POST | `/api/parts-reservations` | On-hand slice: allocate location, increment `quantity_reserved` via ATP |
| POST | `/api/parts-reservations/:id/release` | Body: `returnLocationId` required when `quantity_staged > 0`. Returns tote **staged** qty only. |

Goods receipt keeps `ReceiveItemDto` (`itemId` = `purchase_order_item.id`, `quantity` as decimal 0.001–…, optional `locationId`). Allocated item (reservation 1:1, not cancelled, `detached_at` null): ignore `locationId` for the free bin — tote-transfer to the job. Released item (`detached_at` set / status `CANCELLED`): `locationId` **required**, `PURCHASE_RECEIPT` into that warehouse bin as free stock. Ledger type: **`PURCHASE_RECEIPT`**. `quantity` must accept `1.5` (see Quantity API boundary).

### Settings

| Method | Route | Description |
|--------|-------|-------------|
| GET/PATCH | `/api/settings/catalog-providers` | Defaults, `aw_minutes`, default labor category, OEM concerns + member makes |

OWNER/ADMIN only.

### OpenAPI Regeneration

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

### Layout & Actions

- [ ] Page-level actions top-right (`+ Requisition`, **Search other source**).
- [ ] Top-left: title / vehicle plate / source banner only.
- [ ] Source banner is persistent on that order/search session; not toast-only.

### Workshop order

- Fitment search modal: assembly groups + free text; **parts tab and labor tab each call `/external/search` with their `concern`**.
- Header chip: catalog source from the last search per concern.
- Add to order is the only persist action.
- External labor: category selector defaulting to settings default; blocked if no rate.

### Parts clerk

- Shortage list: filter by order or **all orders**.
- Requisition: one sheet per vehicle-make Brand; rows are slices (job + line + qty), not collapsed SKUs.
- Create PO: one vendor document, **one PO line per slice** (duplicate SKUs allowed). Clerk confirms **unit cost per slice** (prefill from estimate/catalog; empty → **400**, not 0).
- **Release** on a slice: return `quantity_staged` (not consumed qty) to a warehouse bin; do not toast-only a failed return.

### Settings

- New tab **Vehicle data**: defaults + OEM concerns. Stellantis concern lists member makes (Peugeot, Citroën, Opel, Fiat, Jeep, …). Save matching other settings tabs.

### Form Handling

- [ ] Settings: explicit Save (Finance pattern) or save-on-blur for concern rows.
- [ ] Workshop search is not auto-save; Add to order is explicit.

### Real-Time Sync

- [ ] `PartsRequisition` / `PartsReservation` in `SUPPORTED_ENTITY_TYPES` (M3).
- [ ] JIT upsert invalidates inventory + the open workshop order.
- [ ] Provider settings: no socket.

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `VehicleIdentityBanner` | workshop order header | Brand/concern, keys, re-resolve |
| `FitmentSearchModal` | workshop task lines | Per-concern external search + ask/fallback |
| `CatalogSourceBanner` | search modal + order | Copy from `fallbackReason` / `sourceUsed` |
| `PartsShortageQueue` | `/workshop/parts-demand` | Clerk: one order / all orders |
| `MakeRequisitionSheet` | requisition detail | Per-make slices → PO (1 line per slice) |
| `VehicleDataSettingsTab` | Settings | Concerns, member makes, default labor category, AW minutes |

---

## Testing Plan

### Backend E2E

- [ ] VIN/plate change clears `identity_keys`, `make_brand_id`, and `identity_input_fingerprint`; external search 409 until re-resolve; failed re-resolve does not restore old keys.
- [ ] Hit token: tamper 401; expired 401; other tenant 409; other workshop order 409; other task 409.
- [ ] Hit token retry same `jti`+`taskId`: 200 same line id, no second row.
- [ ] Distinct `jti` on same task: second line created.
- [ ] Hit token missing `name` or PARTS `article_number`: 401; unsigned body fields ignored.
- [ ] JIT SKU `{source}-{brand}-{article}-{hash}`; second source same article → different SKU; description change does not rewrite SKU.
- [ ] JIT labor: `internal_cost_rate` null when category has no `default_internal_cost_rate`; never equals selling rate unless costs were explicitly set equal.
- [ ] Decimal 1.5 L reservation: stock/PO/reservation all `1.500`; no integer truncation.
- [ ] `POST receive` `quantity: 1.5` → 201; `0.001` → 201; `1.5001` → **400**; `0` → **400**; `-1` → **400**.
- [ ] Ledger cache update of `1.5` does not become `1` (`Number` coercion forbidden).
- [ ] Release ORDERED with `quantity_received = 0`: PO item remains SENT; `detached_at` set; receive with `locationId` increases warehouse ATP, not a tote.
- [ ] Release ORDERED after receive 4, consume 1.5: tote −2.5 (`quantity_staged`), consumed 1.5 stays; no inverse `WORKSHOP_CONSUMPTION`; later remaining PO receipt is free stock.
- [ ] Fully consume a STAGED slice: status `FULFILLED`; release is not required (422 or no-op if called). Leftover-release of a *partially* consumed slice still `CANCELLED`.
- [ ] Consume allocates FIFO across slices; cannot consume more than `sum(quantity_staged)`.
- [ ] Consume all staged qty of a slice: status `FULFILLED` (not `CANCELLED`); task `DONE` 200 without a Release.
- [ ] Release unreceived ORDERED qty 4: status `CANCELLED`, formula remaining still 4; task `DONE` 200; line not on shortage queue.
- [ ] Consume 2 of PO qty 4 (remaining commitment > 0): task `DONE` 409.
- [ ] Task → `DONE` with a `STAGED`/`PENDING_PICK` part line or `quantity_staged > 0` → 409; invoice repeats the check. `FULFILLED` slices do not block.
- [ ] `POST .../create-purchase-order` with null/omitted/`""` `unitCost` → **400**; no PO row; never writes `unit_cost = 0`.
- [ ] `unitCost: ""` (and `"0"`, `"10.50"`) on create-PO / update-item / requisition create-PO → **400**; does not persist `0`.
- [ ] `unitCost: -1` or `10.001` on create-PO / update-item → **400**. Explicit JSON number `0` → 201.
- [ ] Concurrent `PATCH` `unitCost` vs receive: atomic `WHERE quantity_received = 0`; one 409; receipt `cost_basis` is the pre-receive `unit_cost`.
- [ ] `PATCH` linked PO item quantity 4 → 10 → 409; reservation qty stays 4.
- [ ] `DELETE` linked SENT PO item → 409; `purchase_order_item_id` remains.
- [ ] `DELETE` DRAFT PO (and DELETE DRAFT item) with linked OPEN reservations: reservations `CANCELLED`, FK nulled; `PartsRequisition` `CANCELLED` only if **every** slice is `CANCELLED`; shortage queue shows the line demand.
- [ ] All slices `FULFILLED` (receive + consume, no leftover): `PartsRequisition` `COMPLETED`, not `CANCELLED`.
- [ ] Mixed `FULFILLED` + leftover-release `CANCELLED`: `PartsRequisition` `COMPLETED`.
- [ ] Same-transaction two `PURCHASE_RECEIPT` rows for one item/bin (€10 then €20): ON_HAND pick `tote_cost_basis = 20` (`ORDER BY created_at DESC, seq DESC`).
- [ ] Mark-as-SENT vs DRAFT PO delete concurrent: one 200, one 409; no deadlock; reservations are either all `ORDERED` with SENT PO or all `CANCELLED` with PO gone.
- [ ] Prefill create-PO uses `cost_price_est` then catalog cost when present.
- [ ] Collection PATCH vs consume concurrent: both lock `WorkshopTask` first; no deadlock; one 200 and one 409 or both commit serially.
- [ ] JIT / receive / consume increment `line_items_version` in the same transaction as the line mutation.
- [ ] Consume 1.5 of 4 then leftover-release: `line.quantity = 1.5`, status `CONSUMED` (not `CANCELLED`); invoice qty 1.5; shortage 0; `CANCELLED` lines omitted from invoice projection.
- [ ] Line qty PATCH below `sum(quantity_consumed)` → 409.
- [ ] Increase CONSUMED line 1.5 → 2.5: status no longer `CONSUMED` (`PENDING_PICK` or `STAGED`); shortage 1.0.
- [ ] `PATCH` line-items after JIT: same ids, `catalog_hit_jti` and `catalog_item_id` preserved; omitted operational line is soft-cancelled not deleted.
- [ ] Stale `expectedLineItemsVersion` after concurrent JIT add → 409; new line remains. Duplicate / foreign-task ids → 422.
- [ ] Consume vs release concurrent: one 200, one 409; tote QOH = `sum(quantity_staged)`.
- [ ] Receive vs release concurrent: cancelled reservation cannot be restaged; extra qty is free stock.
- [ ] Double-consume of last staged qty: one 200, one 409.
- [ ] Two `receiveItems` batches, reversed PO-item order: no deadlock; each unit attributed once.
- [ ] `WORKSHOP_CONSUMPTION.parts_reservation_id` and `cost_basis` set; tote QOH reconciles to `sum(quantity_staged)`.
- [ ] JIT with no `cost_price_est`: GET catalog/inventory `cost_price` is JSON `null`, not `0` / `"0"`.
- [ ] STOCK_PREP `WORKSHOP_COST` uses Σ consumption `cost_basis` + labor snapshot; 409 if any is null. Changing `CatalogItem.cost_price` after consume does not change the posted amount.
- [ ] ON_HAND pick at €10, then a €20 receipt on the same SKU, then consume: `WORKSHOP_CONSUMPTION.cost_basis = 10` (`tote_cost_basis` unchanged).
- [ ] Stage €25 PO part, release `TRANSFER_IN` to a bin that has older €10 stock, re-pick: new reservation `tote_cost_basis = 25` (return transfer is valuation-bearing).
- [ ] Null-cost return `TRANSFER_IN` into a bin with an older €10 receipt, then re-pick: `tote_cost_basis` stays **null** (latest inbound wins, including null).
- [ ] First tote entry with null cost freezes null; a later receipt does not fill `tote_cost_basis`.
- [ ] Soft-cancel line (consumed 0): `part_execution_status = CANCELLED`, row remains; hard-delete 409 after reservation exists.
- [ ] Hard-delete `WorkshopTask` 409 after a child reservation exists.
- [ ] Receive allocated line: `ORDERED` → `STAGED` (or stay ORDERED if partial); no `RECEIVED` status; tote qty matches `quantity_received`.
- [ ] ATP helper used by sales finalize; direct `quantity_on_hand` deduct in sales is forbidden.
- [ ] Negative `on_hand - reserved` throws; does not clamp to 0.
- [ ] Reconciliation: `quantity_reserved` equals sum of active ON_HAND slices per stock row.
- [ ] VIN resolve sets `make_brand_id` via alias; Peugeot maps to Stellantis concern.
- [ ] `GET /api/catalog/search` unchanged (local, both arrays). External search requires `concern`.
- [ ] `concern=PARTS` + OEM hit: no labor array; `sourceUsed=OEM`.
- [ ] OEM empty without `confirmFallback`: `fallbackRequired=true`, empty items.
- [ ] OEM empty with `confirmFallback=true`: aftermarket items, `fallbackReason=EMPTY`.
- [ ] OEM 500: same ask contract as empty, `oemStatus=ERROR`.
- [ ] `source=AFTERMARKET` after OEM hit: aftermarket list (Search other source).
- [ ] JIT part: snapshots `cost_price_est` and `oem_numbers` on the line; mutating `CatalogItem` later does not change the line.
- [ ] JIT labor: 422 if default category missing or `default_hourly_rate` null; quantity = hours; unit_price = rate.
- [ ] AW conversion: `aw_minutes=6`, `standard_aw=12` → `quantity=1.2` when provider omits hours.
- [ ] JIT: zero `InventoryTransaction`, no `InventoryStock`.
- [ ] TECH cannot call resolve, external search persist, JIT, or requisition endpoints.
- [ ] Two jobs, same SKU, two PO items; receive qty 1 on first item only → first job tote +1, second reservation still `ORDERED`, warehouse ATP unchanged for that unit.
- [ ] One line qty 4: on-hand 2 + PO 2; ATP drops by 2; sales finalize of 3 free units 409 if only 2 ATP.
- [ ] Concurrent `ON_HAND` reservations for last unit: one 201, one 409 (SQL `WHERE quantity_on_hand - quantity_reserved >= $qty`, not `updateMany`).
- [ ] Line qty PATCH below allocated sum → 409; does not mutate PO qty.
- [ ] `checkAvailability` and sales finalize use `quantity_on_hand - quantity_reserved`.
- [ ] Release OPEN ON_HAND: `quantity_reserved` decrements; no TRANSFER; no `PurchaseOrderStatus.CANCELLED`.
- [ ] Ledger rows for receive are `PURCHASE_RECEIPT`, not `RECEIPT`.
- [ ] Tenant isolation (ADR-0013).

### Frontend

- [ ] Visual QA: per-concern tabs, ask dialogs (empty vs broken copy), Stellantis member makes in settings, PO lines not collapsed by SKU.

---

## Open Questions

None blocking after review pass 11 (2026-08-28): `PartsRequisition` `COMPLETED` vs `CANCELLED` is not “no active slices”; inbound pick ties on `InventoryTransaction.seq`. Plate-registry vendor and live TecAlliance vs sandbox remain commercial.

---

## References

- [[2026-08-28-vehicle-intelligence-catalog-providers|ADR-0021]]
- ADR-0002 (Prisma enum: `PURCHASE_RECEIPT`, `SALE_ISSUE`; docs sometimes say RECEIPT/SALE)
- ADR-0012, ADR-0013, ADR-0014 (`CONSUMED` / tote), ADR-0015
- `ReceiveItemDto`: `apps/core-api/src/purchase/dto/receive-items.dto.ts` (`@IsInt()` today; M3 replaces)
- `ledger.service.ts`: `Number(params.quantity)` cache updates (M3: Prisma Decimal)
- Prisma `TransactionType` currently has no `WORKSHOP_CONSUMPTION` (ADR-0002 name) — add before first reserved-tote consume
- Prisma `InventoryTransaction` today: UUID `id`, `createdAt @default(now())`. M3 adds `seq BigInt @default(autoincrement())` for inbound pick ties
- `docs/deletion-policy.md` (LaborCategory default; PartsReservation **release**; WorkshopTask/Line after reservation)
- Linear: [Vehicle Intelligence & Parts Catalog](https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Vehicle Intelligence & Parts Catalog](https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b) |
| Milestone | M1 Vehicle identity & ephemeral search |
| Issues | After spec review |
