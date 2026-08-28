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

> Identify a vehicle from VIN (plate adapters later), search fitment-aware parts and labor through provider ports, and materialize a `CatalogItem` only when the advisor adds a part to the job. OEM catalogs (BMW, Mercedes, Stellantis) win by **OEM concern**, resolved from a canonical vehicle-make `Brand` — not from free-text `Vehicle.make`. Aftermarket is the fallback with an explicit advisor choice when OEM is empty or down. Shortage qty is reserved in slices. **M3: one `PurchaseOrderItem` per reservation** so a partial delivery has a single job tote. Received qty posts `PURCHASE_RECEIPT` then transfers into that job’s tote. `InventoryStock.quantity_reserved` is an eager ATP cache maintained with every slice; sales and pick must use ATP, not `quantity_on_hand` alone.

Architecture: [ADR-0021](../../01-ADR/2026-08-28-vehicle-intelligence-catalog-providers.md).

**Out of this project:** Kostenvoranschlag / customer approval ([Customer Communication](https://linear.app/auto-core-platform/project/customer-communication-and-approvals-49b9200f083b)); live wholesaler punchout (M4); adding `PurchaseOrderStatus.CANCELLED` (cancel reservations/requisitions, or delete a `DRAFT` PO).

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
| **M2** JIT parts & labor snapshot | Add to order → `CatalogItem` upsert; line FK + price/cost/OEN snapshots; labor hours × category rate. No ledger write. | Job lines survive reload; pick uses `catalog_item_id`; QOH is zero until receipt. |
| **M3** Requisition, PO, reservations | Shortage queue; make-sheets; qty slices; **1:1 PO item per reservation**; ATP cache; `PURCHASE_RECEIPT` + tote transfer. | Two jobs, same SKU, partial receive: only the received PO line’s job gets stock. Sales cannot sell reserved units. |
| **M4** Wholesaler B2B (later) | Live branch stock, Einkaufspreis, punchout. | Explicit trigger; not in M1–M3. |

Plate-registry adapters (AT/DE) attach to the identity port after a contract; they do not block M1.

---

## Routing (M1)

Parts and labor each run this chain on their own. The router key is **`oem_concern`** on the vehicle-make `Brand`, not `Vehicle.make` text.

| Situation | Behavior |
|-----------|----------|
| Make Brand has no OEM adapter for this **concern** (`PARTS` or `LABOR`) | Aftermarket automatically. `oemStatus = NOT_CONFIGURED`. Source chip: aftermarket. |
| OEM returns rows | OEM list primary. Client may call again with `source=AFTERMARKET` (**Search other source**). |
| OEM returns empty | Response `fallbackRequired=true`, `oemStatus=EMPTY`. Client **asks**, then retries with `confirmFallback=true`. |
| OEM errors (timeout, 401, outage) | Response `fallbackRequired=true`, `oemStatus=ERROR`. Client **asks: OEM is currently unavailable.** Retry with `confirmFallback=true`. Persistent banner: **OEM broken — showing aftermarket.** `retryOemAvailable=true`. |

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
| `identity_keys` | Json? | Provider key bag, e.g. `{ "TECDOC": { "kType": 12345 }, "HAYNES": { "vehicleId": "…" }, "BMW": { … }, "MERCEDES": { … }, "STELLANTIS": { … } }` |
| `fuel_type` | String? | From decoder |
| `power_kw` | Int? | From decoder |

`make` / `model` remain display strings (decoder labels). `@@unique([tenant_id, vin])` unchanged. Re-resolve on VIN/plate change.

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

Unique: `(tenant_id, source_system, external_article_id)` where both external fields are set.

### `WorkshopTaskLineItem`

| Column | Type | Notes |
|--------|------|-------|
| `catalog_item_id` | String? | Required for `PART` after M2; pick uses this FK |
| `source_system` | String? | Copied from the hit |
| `external_operation_code` | String? | Labor provider code |
| `fitment_notes` | String? | e.g. PR-number, disc diameter |
| `cost_price_est` | Decimal? | **Snapshot** at Add to order (parts). Not read from live `CatalogItem`. |
| `oem_numbers` | Json? | **Snapshot** OEN list at Add to order (parts). |
| `labor_category_id` | String? | Category used to price external labor |
| `hourly_rate_snapshot` | Decimal? | Rate used; `unit_price` equals this for labor |

`standard_aw` already exists; provider writes it. `labor_operation_id` remains null unless an internal Labor Master op is chosen.

### External labor pricing (M2)

`LaborCategory.default_hourly_rate` is nullable today. External labor **must not** insert a line with a null rate.

| Setting | Rule |
|---------|------|
| `CatalogProviderSettings.default_labor_category_id` | Required before Add to order for external labor. Category must have non-null `default_hourly_rate` (> 0, or 0 if the shop bills $0 — still not null). Else 422. |
| Advisor override | `POST .../lines/from-catalog` may send `laborCategoryId`. Same non-null rate rule. |
| AW → hours | `planned_hours = provider.hours` if the adapter returns hours; else `planned_hours = standard_aw * (aw_minutes / 60)`. |
| `CatalogProviderSettings.aw_minutes` | Tenant integer, default **6** (1 AW = 6 minutes). |
| Line write | `quantity = planned_hours`; `unit_price = hourly_rate_snapshot`; `standard_aw` as provided; `internal_cost_rate` from category internal cost if set, else the hourly rate. |

### Tenant routing

| Table | Purpose |
|-------|---------|
| `CatalogProviderSettings` | Singleton: default identity, parts-aftermarket, labor-aftermarket adapter ids; `default_labor_category_id`; `aw_minutes`; secret refs |
| `CatalogOemConcern` | Per-concern OEM adapters (Stellantis, BMW, Mercedes) |

Vehicle-make Brands attach to a concern via `CatalogOemConcernMake`. There is no free-text make routing table.

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
| `quantity` | Slice qty; sum per line ≤ line.quantity |
| `quantity_received` | 0 until `PURCHASE_RECEIPT` against this slice’s PO item |
| `kind` | `ON_HAND` \| `REQUISITION` |
| `status` | `OPEN` \| `ORDERED` \| `RECEIVED` \| `STAGED` \| `CANCELLED` |
| `location_id` | Required for `ON_HAND`: the stock location whose `quantity_reserved` was incremented |
| `requisition_line_id` | Set when `kind = REQUISITION` |
| `purchase_order_item_id` | Unique when set. Creating a PO from a sheet inserts **one PO item per reservation**, even if SKUs repeat. |

`PartsRequisition`: `tenant_id`, `vehicle_make_brand_id`, `status` (`DRAFT` \| `ORDERED` \| `CANCELLED`). Clerk sheet is still **per vehicle make** (Peugeot sheet ≠ Citroën sheet), while OEM *search* uses the shared Stellantis concern.

Same SKU on the printed PO may appear as two lines (job A, job B). That is intentional so a partial delivery cannot be ambiguous.

### ATP and `quantity_reserved`

`PartsReservation` is the **who/how many** source of truth. `InventoryStock.quantity_reserved` already exists and is exposed by inventory APIs, but today it is only seeded or created as `0` — sales deducts `quantity_on_hand` only (`sales.service.ts`).

**Rule:** every `ON_HAND` reservation create/cancel/stage **atomically** maintains `quantity_reserved` in the same transaction (eager cache, same idea as `quantity_on_hand` vs the ledger).

| Location type | ATP |
|---------------|-----|
| Warehouse / bin (not `staging_tote`) | `max(0, quantity_on_hand - quantity_reserved)` |
| `staging_tote` | **Never** ATP for sales or other jobs |

Incoming `REQUISITION` / `ORDERED` slices are **not** in `quantity_on_hand` yet, so they are not ATP. On `PURCHASE_RECEIPT` the qty is received then `TRANSFER_*` into the **reservation’s job tote** in the same transaction; free warehouse `quantity_on_hand` does not keep that qty.

**Every stock consumer must use ATP**, not raw `quantity_on_hand`:

- Sales invoice finalize
- Workshop pick for a line that is not this reservation
- New `ON_HAND` reservation (FIFO / location-priority allocator from ADR-0012; persist `location_id`)
- Counter / availability APIs (`checkAvailability` must sum ATP)

`quantity_reserved` must never exceed `quantity_on_hand`. Concurrent two reservations for the last free unit: one succeeds, the other 409. Use `updateMany` with `quantity_reserved + qty <= quantity_on_hand`.

### Deletion Policy Impact

| Entity | Strategy |
|--------|----------|
| `CatalogProviderSettings` | Forbidden. Singleton; update in place. |
| `CatalogOemConcern` | Conditional hard delete when no make-joins remain. |
| `CatalogOemConcernMake` | Hard delete allowed (make returns to automatic aftermarket). |
| `VehicleMakeAlias` | Hard delete allowed. |
| `PartsRequisition` | Draft-only delete. After `ORDERED`, cancel. |
| `PartsRequisitionLine` | No direct delete; cancel reservation. |
| `PartsReservation` | `CANCELLED` only while `OPEN`, or `ORDERED` **before any `quantity_received`**. No hard delete after receipt. |
| `CatalogItem` (JIT) | Still no delete; supersede/inactive. |

**PO cancel:** do **not** add `PurchaseOrderStatus.CANCELLED` in this project. Cancel the reservation/requisition. Delete remains draft-only on `PurchaseOrder` (existing policy). A `SENT`/`PARTIAL` PO is not cancelled here; leftover unallocated vendor qty is out of scope for M3 because M3 never shares one PO item across jobs.

---

## State machines

### Reservation slice

```
OPEN → ORDERED (PO created and sent; DRAFT PO still OPEN until SENT)
OPEN → STAGED (on-hand pick to tote; decrement quantity_reserved, transfer to tote)
OPEN → CANCELLED
ORDERED → RECEIVED (this PO item fully received: quantity_received >= quantity)
ORDERED → CANCELLED (only if quantity_received = 0; unlink PO item leftover is clerk/manual)
RECEIVED → STAGED (TRANSFER into job tote; same transaction as receive is allowed)
```

Partial receive of a 1:1 PO item: increment `quantity_received`; stay `ORDERED` until complete; received units tote-transfer immediately so they cannot sit in free stock.

### Workshop part shortage

A line is on the clerk queue when `quantity - sum(active reservation qty) > 0`. Active = not `CANCELLED`.

---

## API Contract Changes

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
  retryOemAvailable: boolean,
  sourceBanner: "OEM" | "AFTERMARKET" | "OEM_UNAVAILABLE_AFTERMARKET",
  items: [ ... ]
}
```

Do not persist hits.

### JIT (M2)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/workshop/orders/:id/tasks/:taskId/lines/from-catalog` | Body: hit token + optional `laborCategoryId`. JIT upsert + insert line |

Hit token is a short-lived server-issued payload, not a client-invented article. TECH cannot add billable catalog lines (ADR-0014).

### Requisition (M3)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/parts-requisitions/shortages` | Queue: one order or all open orders |
| POST | `/api/parts-requisitions` | Create/update make-sheet from selected shortages |
| POST | `/api/parts-requisitions/:id/create-purchase-order` | **One `PurchaseOrderItem` per reservation** |
| POST | `/api/parts-reservations` | On-hand slice: allocate location, increment `quantity_reserved` via ATP |

Goods receipt keeps `ReceiveItemDto` (`itemId` = `purchase_order_item.id`, `quantity`, optional `locationId` ignored for reserved lines). Because PO item ↔ reservation is 1:1, allocation is the reservation on that item. Ledger type: **`PURCHASE_RECEIPT`**, then tote `TRANSFER_OUT` / `TRANSFER_IN`.

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
- Create PO: one vendor document, **one PO line per slice** (duplicate SKUs allowed).

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
| `CatalogSourceBanner` | search modal + order | OEM / aftermarket / OEM broken |
| `PartsShortageQueue` | `/workshop/parts-demand` | Clerk: one order / all orders |
| `MakeRequisitionSheet` | requisition detail | Per-make slices → PO (1 line per slice) |
| `VehicleDataSettingsTab` | Settings | Concerns, member makes, default labor category, AW minutes |

---

## Testing Plan

### Backend E2E

- [ ] VIN resolve sets `make_brand_id` via alias; Peugeot maps to Stellantis concern.
- [ ] Unknown decoder make: new/matched Brand, `oemStatus=NOT_CONFIGURED`, no Stellantis guess.
- [ ] `GET /api/catalog/search` unchanged (local, both arrays). External search requires `concern`.
- [ ] `concern=PARTS` + OEM hit: no labor array; `sourceUsed=OEM`.
- [ ] OEM empty without `confirmFallback`: `fallbackRequired=true`, empty items.
- [ ] OEM empty with `confirmFallback=true`: aftermarket items, banner `OEM_UNAVAILABLE_AFTERMARKET`.
- [ ] OEM 500: same ask contract as empty, `oemStatus=ERROR`.
- [ ] `source=AFTERMARKET` after OEM hit: aftermarket list (Search other source).
- [ ] JIT part: snapshots `cost_price_est` and `oem_numbers` on the line; mutating `CatalogItem` later does not change the line.
- [ ] JIT labor: 422 if default category missing or `default_hourly_rate` null; quantity = hours; unit_price = rate.
- [ ] AW conversion: `aw_minutes=6`, `standard_aw=12` → `quantity=1.2` when provider omits hours.
- [ ] JIT: zero `InventoryTransaction`, no `InventoryStock`.
- [ ] TECH cannot call resolve, external search persist, JIT, or requisition endpoints.
- [ ] Two jobs, same SKU, two PO items; receive qty 1 on first item only → first job tote +1, second reservation still `ORDERED`, warehouse ATP unchanged for that unit.
- [ ] One line qty 4: on-hand 2 + PO 2; ATP drops by 2; sales finalize of 3 free units 409 if only 2 ATP.
- [ ] Concurrent `ON_HAND` reservations for last unit: one 201, one 409.
- [ ] `checkAvailability` and sales finalize use `quantity_on_hand - quantity_reserved`.
- [ ] Cancel reservation: `quantity_reserved` decrements; no `PurchaseOrderStatus.CANCELLED`.
- [ ] Ledger rows for receive are `PURCHASE_RECEIPT`, not `RECEIPT`.
- [ ] Tenant isolation (ADR-0013).

### Frontend

- [ ] Visual QA: per-concern tabs, ask dialogs (empty vs broken copy), Stellantis member makes in settings, PO lines not collapsed by SKU.

---

## Open Questions

None blocking M1 after spec review 2026-08-28. Plate-registry vendor and live TecAlliance vs sandbox remain commercial.

---

## References

- [[2026-08-28-vehicle-intelligence-catalog-providers|ADR-0021]]
- ADR-0002 (Prisma enum: `PURCHASE_RECEIPT`, `SALE_ISSUE`; docs sometimes say RECEIPT/SALE)
- ADR-0012, ADR-0013, ADR-0014, ADR-0015
- `ReceiveItemDto`: `apps/core-api/src/purchase/dto/receive-items.dto.ts`
- `InventoryStock.quantity_reserved`: `schema.prisma`
- Sales QOH guard: `apps/core-api/src/sales/sales.service.ts`
- Linear: [Vehicle Intelligence & Parts Catalog](https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Vehicle Intelligence & Parts Catalog](https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b) |
| Milestone | M1 Vehicle identity & ephemeral search |
| Issues | After spec review |
