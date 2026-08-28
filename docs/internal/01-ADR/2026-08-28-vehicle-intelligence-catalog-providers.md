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

Stellantis is the make/config name (not “PSA”). Adapters may still call Stellantis/PSA APIs internally.

### 4. JIT parts — CatalogItem without ledger

On **Add to order** (part):

1. Upsert `CatalogItem` on `(tenant_id, source_system, external_article_id)`.
2. Derive a tenant-unique `sku` (brand + article). Set workshop line `item_no` to that SKU.
3. Add `catalog_item_id` on `WorkshopTaskLineItem` (pick today resolves by SKU string only).
4. **No** `InventoryTransaction`. **No** `InventoryStock` row. On-hand is “not stocked” until a real `RECEIPT`.
5. Snapshot unit price, estimated cost, fitment notes, OENs, `source_system` on the line.
6. Match or create `Brand` as a part manufacturer. Do **not** write `MasterPart` / `LocalInventory`.

Same EAN from BMW OEM and TecDoc in v1 is **two** catalog items. Merge-by-EAN is later.

### 5. Labor — snapshot the line, rate from Labor Master

Do **not** JIT `LaborOperation` per Haynes/OEM code. Snapshot description, provider code, and `standard_aw` on the task line. Hourly rate comes from tenant `LaborCategory`. `labor_operation_id` is set only when the advisor picks an internal Labor Master operation. Homegrown `LaborFitment` is not the fitment engine for this project.

### 6. Shortage requisition and qty-sliced reservation

A workshop part line is demand for `quantity`. Each **reservation** is a qty slice (`sum(slices) ≤ line.quantity`).

- Clerk queue: lines where needed qty > ATP.
- ATP (free stock) = `quantity_on_hand` minus on-hand slices not yet in the job tote.
- Incoming reserved qty is not ATP for other jobs or counter sales.
- Requisition **sheet per vehicle make** (job’s make, not pad brand). Clerk can open one order or sweep all open orders.
- Do not merge two workshop lines into one reservation because the SKU matches.
- One line **may** have N slices (on-hand pick + OEM PO + backorder PO).

Chain: `WorkshopTaskLineItem` → reservation slice → optional `PartsRequisitionLine` → optional `PurchaseOrderItem`.

On goods receipt: post `RECEIPT` (ADR-0002), then `TRANSFER_OUT`/`TRANSFER_IN` of the allocated qty into **that job’s staging tote** (ADR-0012). Free warehouse stock does not increase for reserved qty.

Cancel requisition line or PO before receipt: reservation dies; shortage returns to the queue.

### 7. Tenant settings

OWNER/ADMIN Settings tab **Vehicle data**: default identity / parts-aftermarket / labor-aftermarket adapters, plus per-make OEM parts and OEM labor adapters (BMW, Mercedes, Stellantis, or off). Credentials in tenant secrets, not on `Brand`.

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
