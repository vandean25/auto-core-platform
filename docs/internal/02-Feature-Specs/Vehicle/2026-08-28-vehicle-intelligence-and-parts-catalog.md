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

> Identify a vehicle from VIN (plate adapters later), search fitment-aware parts and labor through provider ports, and materialize a `CatalogItem` only when the advisor adds a part to the job. OEM catalogs (BMW, Mercedes, Stellantis) win by make when configured; aftermarket (TecDoc, HaynesPro, Autodata) is the fallback with an explicit advisor choice when OEM is empty or down. Shortage qty is reserved in slices, grouped on a requisition sheet per vehicle make, then purchased and received into that job’s tote — not into free stock other orders can steal.

This is the inflection from generic ERP to workshop OS. Architecture: [ADR-0021](../../01-ADR/2026-08-28-vehicle-intelligence-catalog-providers.md).

**Out of this project:** Kostenvoranschlag / customer approval ([Customer Communication](https://linear.app/auto-core-platform/project/customer-communication-and-approvals-49b9200f083b)); live wholesaler punchout (M4).

---

## User Stories

- As a **service advisor**, I want to **decode a VIN into a vehicle identity** so that **search is constrained to this car, not typed make/model text**.
- As a **service advisor**, I want to **browse or search parts that fit this vehicle** so that **I do not add incompatible articles**.
- As a **service advisor**, I want **OEM results first when this make is configured** so that **dealer data wins, with an explicit path to aftermarket**.
- As a **service advisor**, I want to **be told when OEM is down or empty** so that **I know aftermarket results are not OEM**.
- As a **service advisor**, I want to **add an external part to the job** so that **ACP creates a catalog SKU without fake stock**.
- As a **service advisor**, I want to **add OEM/Haynes labor with target AW** so that **the job and mechanic tablet show manufacturer time, billed at our Labor Master rate**.
- As a **parts clerk**, I want to **see workshop shortages, one order or all orders** so that **I can build a requisition sheet per vehicle make**.
- As a **parts clerk**, I want **each reserved unit owned by one workshop line** so that **counter sales and other jobs cannot take that incoming or allocated qty**.
- As a **parts clerk**, I want **one workshop line to split across shelf + several POs** so that **partial stock and backorders still reserve the right units**.
- As an **admin**, I want to **configure identity, aftermarket, and per-make OEM adapters** so that **a new brand is a settings row, not a new interface**.

---

## Slices

| Milestone | Scope | Ship when |
|-----------|-------|-----------|
| **M1** Vehicle identity & ephemeral search | VIN decode adapter; `Vehicle` key bag; Catalog Router; OEM-first UI + banners; ephemeral parts/labor search. No JIT, no PO. | Advisor can resolve a VIN and see fitment hits (sandbox/stub adapters acceptable). |
| **M2** JIT parts & labor snapshot | Add to order → `CatalogItem` upsert, line FK + snapshots; labor line AW + Labor Master rate. No ledger write. | Job lines survive reload; pick can resolve `catalog_item_id`; QOH is zero until receipt. |
| **M3** Requisition, PO, reservations | Shortage queue; make-sheets; qty slices; PO link; receive → job tote. | Reserved units are not ATP; receipt does not inflate free warehouse stock. |
| **M4** Wholesaler B2B (later) | Live branch stock, Einkaufspreis, punchout. | Explicit trigger; not in M1–M3. |

Plate-registry adapters (AT/DE) attach to the identity port after a contract; they do not block M1.

---

## Routing (M1)

Parts and labor each run this chain on their own.

| Situation | Behavior |
|-----------|----------|
| Make has no OEM adapter for this concern | Aftermarket automatically. Source chip: aftermarket. |
| OEM returns rows | OEM list primary. Action: **Search other source**. Do not auto-mix lists. |
| OEM returns empty | Ask, then aftermarket. Banner stays. |
| OEM errors (timeout, 401, outage) | Ask: **OEM is currently unavailable.** Confirm → aftermarket. Persistent banner: **OEM broken — showing aftermarket.** Retry OEM remains. |

---

## Database Impact

### `Vehicle` (identity)

| Column | Type | Notes |
|--------|------|-------|
| `hsn` | String? | KBA; indexed with `tsn` |
| `tsn` | String? | KBA |
| `identity_keys` | Json? | Provider key bag, e.g. `{ "TECDOC": { "kType": 12345 }, "HAYNES": { "vehicleId": "…" }, "BMW": { … }, "MERCEDES": { … }, "STELLANTIS": { … } }` |
| `fuel_type` | String? | From decoder |
| `power_kw` | Int? | From decoder |

Existing `make`, `model`, `year`, `engine_code`, `vin`, `plate` stay the display/CRM fields. `@@unique([tenant_id, vin])` unchanged. Re-resolve on VIN/plate change.

### `CatalogItem` (JIT)

| Column | Type | Notes |
|--------|------|-------|
| `source_system` | String? | `INTERNAL` or adapter id (`TECDOC`, `BMW`, …) |
| `external_article_id` | String? | Provider article id |
| `ean` | String? | |
| `oem_numbers` | Json? | String array of OENs |

Unique: `(tenant_id, source_system, external_article_id)` where both external fields are set.

### `WorkshopTaskLineItem`

| Column | Type | Notes |
|--------|------|-------|
| `catalog_item_id` | String? | Required for `PART` after M2; pick uses this FK, not SKU-only |
| `source_system` | String? | Copied from the hit |
| `external_operation_code` | String? | Labor provider code |
| `fitment_notes` | String? | e.g. PR-number, disc diameter |

`standard_aw` already exists; OEM/Haynes writes it. `labor_operation_id` remains null unless an internal Labor Master op is chosen.

### Tenant routing

| Table | Purpose |
|-------|---------|
| `CatalogProviderSettings` | Singleton per tenant: default identity, parts-aftermarket, labor-aftermarket adapter ids + secret refs |
| `CatalogMakeProvider` | Per vehicle-make Brand: optional OEM parts adapter, optional OEM labor adapter |

Credentials follow the voice-translation pattern (encrypted secret on settings, not on `Brand`).

### Reservation and requisition (M3)

```
WorkshopTaskLineItem 1 ── N PartsReservation (qty slice)
PartsRequisition (header, vehicle make)
  └── PartsRequisitionLine ── 1 PartsReservation
PurchaseOrderItem 1 ── N PartsReservation (allocated incoming qty)
```

`PartsReservation`:

| Column | Notes |
|--------|-------|
| `workshop_task_line_item_id` | Owner of the units |
| `quantity` | Slice qty; sum per line ≤ line.quantity |
| `kind` | `ON_HAND` \| `REQUISITION` |
| `status` | `OPEN` \| `ORDERED` \| `RECEIVED` \| `STAGED` \| `CANCELLED` |
| `requisition_line_id` | Set when `kind = REQUISITION` |
| `purchase_order_item_id` | Set when placed on a PO |

`PartsRequisition`: `tenant_id`, `vehicle_make` (job make), `status` (`DRAFT` \| `ORDERED` \| `CANCELLED`). Clerk sheet.

ATP for counter sales and other jobs uses **on-hand minus OPEN/ORDERED `ON_HAND` slices not yet `STAGED`**. Incoming `REQUISITION`/`ORDERED` slices are not free stock when received — they transfer to the job tote.

### Deletion Policy Impact

Add to `docs/deletion-policy.md`:

| Entity | Strategy |
|--------|----------|
| `CatalogProviderSettings` | Forbidden. Singleton; update in place. |
| `CatalogMakeProvider` | Hard delete allowed (turns that make back to automatic aftermarket). |
| `PartsRequisition` | Draft-only delete. After `ORDERED`, cancel. |
| `PartsRequisitionLine` | No direct delete; cancel reservation. |
| `PartsReservation` | Cancel status; no hard delete once `ORDERED`/`RECEIVED`. |
| `CatalogItem` (JIT) | Still no delete; supersede/inactive. |

---

## State machines

### Reservation slice

```
OPEN → ORDERED (on PO sent)
OPEN → STAGED (on-hand pick to tote)
OPEN → CANCELLED
ORDERED → RECEIVED (goods receipt allocated to this slice)
ORDERED → CANCELLED (PO/requisition cancelled before receipt)
RECEIVED → STAGED (transfer to job tote)
```

### Workshop part shortage

A line is on the clerk queue when `quantity - sum(active reservation qty) > 0`. Active = not `CANCELLED`.

---

## API Contract Changes

### Identity and search (M1)

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| POST | `/api/vehicles/:id/resolve-identity` | VIN decode (plate adapter when configured); persist key bag | session, not TECH |
| GET | `/api/catalog/search` | Extended: vehicle-constrained ephemeral parts+labor; router applies OEM-first | session |
| GET | `/api/catalog/assembly-groups` | Provider group tree for the resolved vehicle | session |

Existing `/api/catalog/search` stays; add `source` metadata and routing. Do not persist hits.

### JIT (M2)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/workshop/orders/:id/tasks/:taskId/lines/from-catalog` | JIT upsert + insert line from an ephemeral hit token |

Hit token is a short-lived server-issued payload (or signed DTO), not a client-invented article. TECH cannot add billable catalog lines (ADR-0014).

### Requisition (M3)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/parts-requisitions/shortages` | Queue: one order or all open orders |
| POST | `/api/parts-requisitions` | Create/update make-sheet from selected shortages |
| POST | `/api/parts-requisitions/:id/create-purchase-order` | PO from sheet; link slices to PO items |
| POST | `/api/parts-reservations` | On-hand slice (allocates ATP) |

Goods receipt reuses PO receive; allocation runs inside the same ledger transaction as `RECEIPT` + tote `TRANSFER_*`.

### Settings

| Method | Route | Description |
|--------|-------|-------------|
| GET/PATCH | `/api/settings/catalog-providers` | Defaults + per-make OEM rows |

OWNER/ADMIN only.

### OpenAPI Regeneration

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

### Layout & Actions

- [ ] Page-level actions top-right (`+ Requisition`, **Search other source**, **Notify** is out of scope).
- [ ] Top-left: title / vehicle plate / source banner only.
- [ ] Source banner is persistent on that order/search session; not toast-only.

### Workshop order

- Fitment search modal: assembly groups + free text, constrained by identity bag.
- Header chip: catalog source (`OEM` / `Aftermarket` / `OEM unavailable — aftermarket`).
- Add to order is the only persist action.

### Parts clerk

- Shortage list: filter by order or **all orders**.
- Requisition: one sheet per vehicle make; rows are slices (job + line + qty), not collapsed SKUs.
- Create PO from the sheet (vendor picker). M4 may preselect OEM dealer.

### Settings

- New tab **Vehicle data** on the gear page. Create control: none (singleton). Per-make rows: save-on-blur / Save Changes matching other settings tabs.

### Form Handling

- [ ] Settings: explicit Save (Finance pattern) or save-on-blur for per-make rows.
- [ ] Workshop search is not auto-save; Add to order is explicit.

### Real-Time Sync

- [ ] `PartsRequisition` / `PartsReservation` in `SUPPORTED_ENTITY_TYPES` (M3) so clerk and advisor lists refresh.
- [ ] `CatalogItem` already emits; JIT upsert should invalidate inventory + the open workshop order.
- [ ] Provider settings: no socket (same as other rare settings).

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `VehicleIdentityBanner` | workshop order header | Resolved make/model/keys; re-resolve action |
| `FitmentSearchModal` | workshop task lines | Ephemeral OEM/aftermarket search + source banner |
| `CatalogSourceBanner` | search modal + order | OEM / aftermarket / OEM broken |
| `PartsShortageQueue` | `/workshop/parts-demand` or inventory | Clerk: one order / all orders |
| `MakeRequisitionSheet` | requisition detail | Per-make slices → create PO |
| `VehicleDataSettingsTab` | Settings | Adapter defaults + Stellantis/BMW/Mercedes rows |

---

## Testing Plan

### Backend E2E

- [ ] VIN resolve persists `identity_keys` and does not call providers on a second search without VIN/plate change.
- [ ] Make with OEM: hits come from OEM port; aftermarket only after “other source” or confirmed fallback.
- [ ] Make without OEM: aftermarket, no prompt.
- [ ] OEM 500: ask path; after confirm, aftermarket results flagged `oem_unavailable`.
- [ ] JIT: `CatalogItem` upsert, zero `InventoryTransaction`, no `InventoryStock`.
- [ ] TECH cannot call JIT or requisition endpoints.
- [ ] Two workshop lines, same SKU: two reservations; ATP allows only unreserved on-hand.
- [ ] One line qty 4: on-hand 2 + PO 2; sum ≤ 4; receipt of PO 2 totes only those 2.
- [ ] Counter sales ATP excludes reserved incoming and reserved on-hand.
- [ ] Tenant isolation on identity, JIT, requisition (ADR-0013).

### Frontend

- [ ] Visual QA: source banner, ask dialogs (empty vs broken copy), make-sheet, Settings Vehicle data.

---

## Open Questions

None blocking M1. Plate-registry vendor and live TecAlliance vs sandbox are commercial, not spec forks.

---

## References

- [[2026-08-28-vehicle-intelligence-catalog-providers|ADR-0021]]
- ADR-0002, ADR-0012, ADR-0013, ADR-0014, ADR-0015
- Labor fitment spec (draft) — homemade fitment is **not** this engine
- Linear: [Vehicle Intelligence & Parts Catalog](https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Vehicle Intelligence & Parts Catalog](https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b) |
| Milestone | M1 Vehicle identity & ephemeral search |
| Issues | After spec review |
