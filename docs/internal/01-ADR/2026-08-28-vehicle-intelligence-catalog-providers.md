---
title: "ADR-0021: Vehicle Intelligence — Provider Ports, JIT Catalog, Make-Based Routing"
date: "2026-08-28"
status: proposed
deciders: "Product Owner, Architecture Team"
linear-project: "https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b"
linear-milestone: ""
tags:
  - adr
  - vehicle
  - catalog
  - inventory
  - workshop
  - purchase
---

# ADR-0021: Vehicle Intelligence — Provider Ports, JIT Catalog, Make-Based Routing

## Status

**Proposed** — 2026-08-28

## Context

ACP stores vehicles as typed CRM text (`make`, `model`, `year`, `engine_code`, `vin`, `plate`) and parts as a tenant-owned `CatalogItem` SKU list. Fitment is a homemade make/model/year table. Labor operations are hand-maintained. There is no VIN decode, no TecDoc/Haynes/OEM catalog, and no reservation of incoming parts to a workshop line.

A real workshop catalog is ~10^8 aftermarket articles plus OEM dealer catalogs. Copying that into tenant Postgres would violate size, freshness, and ADR-0002 (stock must move only through `InventoryTransaction`).

BMW, Mercedes, and Stellantis OEM APIs do not speak TecDoc `kType`. HaynesPro/Autodata labor is not a parts catalog. One fat “automotive provider” interface would force every adapter to stub half its methods.

## Decision

### 1. Three ports, ACP-owned JIT

External systems implement **ports**. They never write `CatalogItem`, `InventoryStock`, or `InventoryTransaction`.

| Port | Responsibility |
|------|----------------|
| `VehicleIdentityProvider` | Plate/VIN → canonical vehicle identity (key bag) |
| `PartsCatalogProvider` | Identity + query → ephemeral part hits |
| `LaborCatalogProvider` | Identity + query → ephemeral labor ops (AW/hours + description) |

ACP owns the **Catalog Router** and the **JIT pipeline**. JIT runs only when an advisor adds a hit to a workshop order.

Rejected alternatives: one gateway interface (VIN+parts+labor); one full-stack class per brand; pre-populating millions of `CatalogItem` rows; storing part details only as JSON on the workshop line (breaks procurement).

### 2. Canonical identity is a key bag on `Vehicle`

After a successful resolve, persist decoded display fields plus provider keys on the existing VIN master (`Vehicle`). Do not make TecDoc `kType` the only key.

- Dedicated indexed columns where we search: `vin`, `plate`, `hsn`, `tsn`.
- `make_brand_id` FK to a vehicle-make `Brand`. Routing **never** uses free-text `Vehicle.make`.
- `VehicleMakeAlias` maps decoder labels to that Brand. `CatalogOemConcern` + `CatalogOemConcernMake` map many Brands to one OEM (Stellantis ← Peugeot, Citroën, Opel, Fiat, Jeep, …).
- Structured `identity_keys` JSON for adapter ids (`TECDOC.kType`, `HAYNES.vehicleId`, `BMW.*`, `MERCEDES.*`, `STELLANTIS.*`).
- Re-resolve when `vin` or `plate` changes. Search uses the stored bag; it does not call every decoder on every keystroke.

Slice 1 ships VIN decode. Plate-registry adapters (AT Zulassungsevidenz, DE KBA) are additional **identity** adapters on the same port, after a commercial contract exists.

### 3. Make-based routing, OEM first

Parts search and labor search each run this chain independently.

```
OEM adapter configured for this vehicle make + this concern?
  NO  → aftermarket automatically (no prompt). Source chip: aftermarket.
  YES → call OEM
          returns rows → OEM list is primary. Action: “Search other source.”
          empty         → ASK, then aftermarket if confirmed. Banner stays.
          error/outage  → ASK: OEM is currently unavailable. Confirm → aftermarket.
                          Persistent banner: OEM broken — showing aftermarket.
                          Retry OEM remains available.
```

Never silent-merge OEM and aftermarket into one list. Never toast-only the outage.

`STELLANTIS` is an **OEM concern**, not a vehicle make. Member makes share one adapter. Adapters may still call Stellantis/PSA APIs internally. Unknown decoder makes do not inherit Stellantis.

### 4. JIT parts — CatalogItem without ledger

On **Add to order** (part):

1. Upsert `CatalogItem` on `(tenant_id, source_system, external_article_id)`.
2. Derive an **immutable** tenant-unique `sku` only on first insert:
   `{source}-{normalized-brand}-{normalized-article}-{short-hash}`
   where `short-hash` is SHA-256(`tenant_id|source_system|external_article_id`)[:8] (retry with 12 hex chars on unique collision). Upsert key is `(tenant_id, source_system, external_article_id)`, not SKU. Never rewrite SKU when brand labels or descriptions change.
3. Add `catalog_item_id` on `WorkshopTaskLineItem` (pick today resolves by SKU string only).
4. **No** `InventoryTransaction`. **No** `InventoryStock` row. On-hand is “not stocked” until a real `PURCHASE_RECEIPT` (Prisma `TransactionType`; do not write `RECEIPT` — that name is docs-only in ADR-0002).
5. Snapshot on the **line**: `unit_price`, `cost_price_est`, `oem_numbers`, `fitment_notes`, `source_system`. Live `CatalogItem` is not historical.
6. Match or create `Brand` as a part manufacturer. Do **not** write `MasterPart` / `LocalInventory`.

Same EAN from BMW OEM and TecDoc in v1 is **two** catalog items. Merge-by-EAN is later.

### 5. Labor — snapshot the line, rate from Labor Master

Do **not** JIT `LaborOperation` per Haynes/OEM code. Snapshot description, provider code, and `standard_aw` on the task line. `labor_operation_id` is set only when the advisor picks an internal Labor Master operation. Homegrown `LaborFitment` is not the fitment engine for this project.

Pricing (because `LaborCategory.default_hourly_rate` is nullable):

- `CatalogProviderSettings.default_labor_category_id` is required for external labor and must point at a category with non-null `default_hourly_rate`.
- Advisor may pass `laborCategoryId` on Add to order (same rule).
- `planned_hours = provider.hours` or `standard_aw * (aw_minutes / 60)` with tenant `aw_minutes` default 6.
- Write `quantity = planned_hours`, `unit_price = hourly_rate_snapshot`, plus `labor_category_id` and `hourly_rate_snapshot` on the line.
- Add `LaborCategory.default_internal_cost_rate`. Snapshot onto `internal_cost_rate` when non-null; **otherwise leave `internal_cost_rate` null**. Never copy the selling rate into cost (unknown margin ≠ zero margin).

### 6. Shortage requisition and qty-sliced reservation

A workshop part line is demand for `quantity`. Each **reservation** is a qty slice (`sum(slices) ≤ line.quantity`).

- Clerk queue: lines where needed qty > ATP.
- **ATP** = `quantity_on_hand - quantity_reserved` at non-tote locations. Negative difference is an invariant failure, not `max(0, …)`. Enforcement is in inventory/reservation helpers used by the ledger path, plus a reconciliation assert (`quantity_reserved` = sum of active ON_HAND slices).
- Requisition **sheet per vehicle-make Brand**. OEM *search* uses concern (Stellantis).
- Do not merge two workshop lines into one reservation because the SKU matches.
- One line **may** have N slices (on-hand pick + OEM PO + backorder PO).
- **M3 lock: one `PurchaseOrderItem` per `PartsReservation`.** Linked PO `quantity` is not independently PATCHable (409). Qty changes go through the reservation/line path (DRAFT + unreceived only). DRAFT PO/item delete **cancels** reservations (`CANCELLED`, FK null) so line shortage reappears; `PartsRequisition` → `CANCELLED` when no active slices remain. SENT/received keep the FK (`onDelete: Restrict`). Mark-as-SENT is `OPEN` → `ORDERED` under the same lock order. Qty columns are **`Decimal(10, 3)`** end-to-end (stock, reserved, PO, reservation, workshop/sales lines). `InventoryTransaction.quantity` is already 10,3. Write DTOs (`ReceiveItemDto`, create/update PO item, pick) replace `@IsInt()` with `@IsNumber({ maxDecimalPlaces: 3 })` and min `0.001`. Ledger cache math uses Prisma `Decimal`, not `Number(...)`.
- No `RECEIVED` status: receive + tote transfer is one transaction (`ORDERED` → `STAGED` when complete). Consume auto-sets reservation **`FULFILLED`** when remaining commitment and staged qty are 0. **Active** = `status IN (OPEN, ORDERED, STAGED)` AND (remaining commitment > 0 OR staged > 0). A `CANCELLED` unreceived slice keeps formula remaining > 0 and still does not block `DONE`.
- **Release:** from `OPEN` / `ORDERED` / `STAGED` (not `FULFILLED`). Return **`quantity_staged`**. Consume allocates FIFO. Leftover-release shrinks `line.quantity` to consumed; `CANCELLED` line status only if consumed is 0; invoice PART qty = `line.quantity`; omit `CANCELLED` from invoice. Task cannot become `DONE` (invoice repeats) while PART lines are `PENDING_PICK`/`STAGED`, have **active** slices, or `quantity_staged > 0`. Increasing qty past consumed clears `CONSUMED` and recreates shortage. Add `TransactionType.WORKSHOP_CONSUMPTION` before first reserved-tote consume. Keep `purchase_order_item_id` after SENT/received Release; DRAFT delete cancels the reservation then nulls the FK. Lines with history are not hard-deleted. Collection `PATCH` is an ID diff with `expectedLineItemsVersion` (409 if stale); compare-and-increment is the first guarded write.
- Receive/consume/release/JIT/DONE/invoice/**mark-as-SENT**/linked PO delete: collect all ids, `SELECT … FOR UPDATE` in **globally sorted** order **tasks → lines → reservations → PO headers → PO items → stock**; increment `line_items_version` in the same transaction; conditional counter updates; `parts_reservation_id` + `cost_basis` copied from `tote_cost_basis` on consumption **and** on release `TRANSFER_OUT`/`TRANSFER_IN`; tote QOH = `sum(quantity_staged)`.
- `CatalogItem.cost_price` nullable through DTOs (`CatalogItemResponseDto` in `inventory-response.dto.ts`)/OpenAPI/projections (`Number(cost)` forbidden). Keep `PurchaseOrderItem.unit_cost` required (`>= 0`, max 2 decimals, **JSON number only** — no `@Type(() => Number)`, `""` → **400**). Freeze `unit_cost` with `UPDATE … WHERE quantity_received = 0` (count 0 → 409). Stamp `PartsReservation.tote_cost_basis` at first tote entry (null freezes); consume copies it. ON_HAND pick uses the **latest** eligible inbound including null `cost_basis`. STOCK_PREP `WORKSHOP_COST` = Σ consumption `cost_basis` + snapshotted labor rate; 409 if any is null. Do not use live catalog cost. Decorator DTO failures stay Nest **400**; semantic rules stay **422**. Do not change the global `ValidationPipe`.
- ATP reserve/consume: parameterized `UPDATE inventory_stocks SET quantity_reserved = quantity_reserved + $qty WHERE … AND quantity_on_hand - quantity_reserved >= $qty`. Not Prisma `updateMany` arithmetic.

Chain: `WorkshopTaskLineItem` → reservation slice → optional `PartsRequisitionLine` → **1:1 `PurchaseOrderItem`** (FK retained after SENT Release; nulled on DRAFT delete after the reservation is `CANCELLED`).

### 7. Tenant settings

OWNER/ADMIN Settings tab **Vehicle data**: default identity / parts-aftermarket / labor-aftermarket adapters, `default_labor_category_id`, `aw_minutes`, plus **OEM concerns** (BMW, Mercedes, Stellantis) each listing member vehicle-make Brands. Credentials in tenant secrets, not on `Brand`.

External search is **not** `GET /api/catalog/search`. New `GET /api/catalog/external/search` requires `concern=PARTS|LABOR` and supports `source` + `confirmFallback`. Response uses `fallbackReason: EMPTY | ERROR | null` (no `sourceBanner`). 409 when identity is stale.

VIN/plate change clears `identity_keys`, `make_brand_id`, and `identity_input_fingerprint` in the same write. Failed re-resolve must not restore the previous key bag. Store `identity_input_fingerprint` + `identity_resolved_at` only after a successful resolve.

Hit tokens are a complete signed `CatalogHitPayload` (HMAC, TTL ≤ 15 minutes): binding (`tenantId`, workshop order, vehicle, **taskId**, concern, provider, **jti**, `exp`) plus every field required to insert `CatalogItem` / `WorkshopTaskLineItem` (`name`, PARTS `article_number` + `unit_price`, LABOR `external_operation_code`, optional brand/EAN/unit/fitment/OENs/cost/AW). POST body is token + optional `laborCategoryId` only. Persist `jti` uniquely per task; retries are idempotent. No unsigned catalog fields; no provider re-query on add.

## Consequences

### Positive

- Aftermarket and OEM share one workshop UX and one JIT/reservation pipeline.
- Ledger stays append-only; catalog search stays ephemeral until Add to order.
- Franchise and independent tenants differ by settings rows, not by forked code.

### Negative

- Adapter licensing (TecAlliance, Haynes, OEM) is a commercial dependency; slice 1 can ship VIN decode with stub/sandbox adapters.
- Plate lookup is delayed until registry contracts exist.
- Two catalog rows for the same physical article (OEM vs TecDoc) until a later merge.

### Neutral

- `MasterPart` / `LocalInventory` remain unused by this flow.
- Customer-facing Kostenvoranschlag stays on the Customer Communication project; it will later read snapshotted OEM numbers and AW from the task line.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Single VIN+parts+labor gateway | Simple tenant setting | Breaks mixed Haynes labor + TecDoc parts + BMW OEM |
| Full-stack class per brand | Fits one franchise | Fights independents and mixed used-car makes |
| Pre-load TecDoc into `CatalogItem` | Local SQL | Size, stale price, ADR-0002 pollution |
| Line JSON only, no `CatalogItem` | Zero catalog growth | Cannot PO, pick, or reserve |
| 1:1 reservation per workshop line | Simple | Cannot split shelf + OEM PO + backorder |
| N reservations on one PO item + qty-only receive | Fewer vendor lines | Partial delivery cannot choose a job tote |
| Route on `Vehicle.make` text | No new FKs | Peugeot ≠ Stellantis; typos skip OEM |
| Overload `/api/catalog/search` | One endpoint | Cannot express per-concern fallback |
| Integer stock + decimal job lines | No migration | 1.5 L oil cannot reserve/receive faithfully |
| Copy selling rate into labor cost | Always have a cost | Fake zero margin |
| Brand+article SKU | Short | Collides across BMW vs TecDoc |
| Keep RECEIVED status | Matches physical receive | Transient if tote is same transaction |
| Block cancel after any receipt | Protects staged tote | Strands tote stock and leftover PO qty when the job is cancelled |
| Null PO FK on detach | Receive cannot find a job | Loses allocation audit |
| @IsInt qty after Decimal columns | Schema accepts 1.5 | Receive DTO still 400s 1.5 |
| Release tote = quantity_received | Simple | Overdraws tote after CONSUMED |
| Hard-delete part line after Release | Cleaner UI | Orphans reservation FK / ledger |
| Keep replaceTaskLineItems delete-all | No DTO change | Wipes JIT snapshots / breaks reservations |
| Collection PATCH without version | Simpler client | Stale payload deletes concurrent JIT add |
| DONE = all tasks DONE only | Existing lifecycle | Invoices STAGED tote qty as if consumed |
| Active = status != CANCELLED | Simple | Fully consumed STAGED slice blocks DONE |
| Null PO unit_cost | Matches nullable catalog | Cannot insert required `PurchaseOrderItem.unit_cost`; 0 fakes a price |
| Lock lines before tasks | Matches consume hotspot | OCC PATCH vs consume deadlock |
| Active = remaining_commitment > 0 only | Avoids extra status check | Unreceived CANCELLED qty 4 still looks active |
| Consume-time last inbound cost | One query at consume | Pick €10 then receipt €20 consumes at €20 |
| Mutable PO unit_cost after receipt | Clerk can correct typos | Tote/consume cost silently changes |
| Independent PATCH of linked PO qty | Existing updatePurchaseOrderItem | Stages 10 against a reservation of 4 |
| Keep reservation OPEN after DRAFT unlink | Avoids a cancel | Shortage formula still covers the line |
| Skip null inbound when picking | Prefer a known price | Null return into €10 bin re-picks at €10 |
| markAsSent updates PO header first | Matches today’s service | Deadlocks DRAFT delete (task → header) |
| Global errorHttpStatusCode 422 | Matches some specs | Changes every endpoint’s decorator errors |
| @Type(() => Number) on unitCost | Matches qty DTOs | `""` becomes 0 (warranty/free) |
| Read-then-throw if quantity_received > 0 | Simple | Cost PATCH races receipt and overwrites |
| ON_HAND basis = receipts/adjustments only | Matches inbound types | Returned €25 restaged at €10 |
| Freeze tote_cost_basis after first non-null | Allows filling unknown | Later receipt mutates a null snapshot |
| Lock in payload order | Matches receiveItems array | Deadlock on reversed batch receipts |
| CatalogItem.cost_price ?? 0 | Column stays NOT NULL | Unknown cost looks like zero margin |
| Number(null cost) in projections | One-line map | API returns 0; STOCK_PREP understates vehicle cost |
| Unsigned JIT fields + token | Smaller HMAC | Client can mint name/price |
| Prisma updateMany ATP filter | Familiar | Cannot express on_hand - reserved >= qty |
| max(0, ATP) | No crashes | Hides quantity_reserved corruption |

## References

- Feature spec: `docs/internal/02-Feature-Specs/Vehicle/2026-08-28-vehicle-intelligence-and-parts-catalog.md`
- ADR-0002 Ledger-Based Inventory
- ADR-0012 Parts Kitting and Tote Staging
- ADR-0013 Row-Level Multi-Tenancy
- ADR-0014 Mechanic tablet (target AW on the line; TECH cannot invoice)
- ADR-0015 Audit tracing
- Labor Master project (internal rates/categories; this project consumes them)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Vehicle Intelligence & Parts Catalog](https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b) |
| Milestone | M1–M3 in-scope; M4 wholesaler later |
| Issues | Cut after spec review |
