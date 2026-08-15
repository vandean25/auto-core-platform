---
title: "ADR-0016: Vehicle Stock Is a Parallel Ledger Domain"
date: "2026-08-15"
status: proposed
deciders: "Product Owner, Engineering Team"
linear-project: "https://linear.app/auto-core-platform/project/used-vehicle-trading-85bd7ec3553f"
linear-milestone: "M1 Used buy-stock-sell"
tags:
  - adr
  - vehicle
  - inventory
  - ledger
  - tax
  - sales
  - purchase
---

# ADR-0016: Vehicle Stock Is a Parallel Ledger Domain

## Status

**Proposed** — 2026-08-15

## Context

Auto Core Platform today treats `Vehicle` as a CRM/workshop identity (VIN, plate, fitment) and treats inventory as **fungible parts** (`CatalogItem` + `InventoryStock` + `InventoryTransaction`, ADR-0002). Purchase orders require a `vendor_id` and `catalog_item_id`. Sales orders optionally reference a vehicle as *the car the parts are for*, not as merchandise.

The product now needs to **buy used vehicles, hold them as VIN stock, capitalize workshop prep cost, and sell them with Differenzbesteuerung (UStG §24 margin scheme)**. Sellers may be vendors or private customers.

Incadea DMS (BC14) treats vehicles as a **parallel inventory domain**: VIN master + stock book + vehicle journal/ledger, with New/Used/Demo statuses, differential tax, and trade-in as a linked purchase. Modeling cars as `CatalogItem` quantity 1 would break VIN uniqueness, margin VAT, private-seller acquisition, and workshop cost capitalization.

Product sequence (only **A** is in scope for implementation now):

| Phase | Capability |
|-------|------------|
| **A (now)** | Used vehicles: buy → VIN stock → workshop prep cost → sell with margin VAT |
| **B** | Trade-in: customer car as (part) payment, into used stock |
| **C** | New vehicles from vendor/importer, standard VAT |
| **D** | Demo / company cars: own use, then sell |

## Decision Drivers

* VIN is a unique physical unit, not a SKU quantity.
* Used-car VAT in Austria is margin scheme, not 20% on the full selling price.
* Private individuals sell cars; parts procurement cannot express a customer as seller.
* Workshop prep on own stock must increase vehicle cost, not raise a customer invoice.
* After sale, the same VIN must become the buyer’s service vehicle without duplicating the row.
* B/C/D must be addable without renaming the domain or introducing a second car table.

## Decision

Vehicles for sale are **not parts**. We extend the existing `Vehicle` row as the **VIN master** and add a **vehicle ledger** plus dedicated purchase/sale documents. Parts inventory (ADR-0002) is unchanged.

### 1. One VIN master

`Vehicle` remains the single physical-car entity (tenant-scoped unique VIN). It gains an inventory axis and an operations axis:

| Field | A (now) | Reserved |
|-------|---------|----------|
| `inventory_role` | `CUSTOMER`, `USED` | `NEW` (C), `DEMO` (D) |
| `stock_status` | `ON_ORDER`, `IN_STOCK`, `RESERVED`, `IN_PREP`, `SOLD` (null when `CUSTOMER`) | dealer hold/allocation later |
| `tax_scheme` | `MARGIN` | `STANDARD` (C, some D) |

v1 APIs **only write** `USED` + `MARGIN`. Enum values for C/D exist so later phases do not break the contract.

On purchase, if the VIN already exists (former customer car), **reuse** the row and flip `inventory_role` to `USED`. Never insert a second vehicle for the same tenant+VIN.

### 2. Vehicle ledger, not `InventoryTransaction`

`VehicleLedgerEntry` is an append-only, tenant-scoped cost/movement ledger (sibling of ADR-0002, not a new `TransactionType` on parts).

Entry types: `PURCHASE`, `WORKSHOP_COST`, `ADJUSTMENT`, `SALE`.

**Cost basis** (named, testable function): sum of `PURCHASE` + `WORKSHOP_COST` + `ADJUSTMENT` until sale. Margin VAT uses this basis. Whether workshop costs legally reduce the UStG §24 assessment base must be confirmed with an accountant; the function is the single place to change the rule.

Fiscal lock date (ADR-0003) applies to ledger posting dates. Direct mutation of a cached cost field without a ledger row is forbidden.

### 3. Dedicated purchase and sale documents

**Do not** add vehicle lines to `PurchaseOrder` or sell stock through `SalesOrder`.

- `VehiclePurchase`: `seller_type` `VENDOR` | `CUSTOMER`; `vendor_id` xor `customer_id`; `acquisition_kind` `DIRECT` | `TRADE_IN` (A always `DIRECT`; B uses `TRADE_IN`).
- `VehicleSale`: one stock VIN + buyer; nullable `trade_in_purchase_id` for B (unpopulated in A).
- Sequential numbering via `FinanceSettings` (`VP-2026-`, `VS-2026-`), singleton-guarded (ADR-0009).

`SalesOrder.vehicle_id` continues to mean “parts sold for this car.”

### 4. Invoice reuse with a tax mode

`VehicleSale` finalization creates the existing `Invoice` (ADR-0004 snapshots, ADR-0009 numbering, ADR-0003 lock date). New parent: `invoice.vehicle_sale_id` (unique, same pattern as `sales_order_id` / `workshop_order_id`).

`Invoice.tax_mode`: `STANDARD` (default, existing invoices) | `MARGIN_SCHEME`.

A uses `MARGIN_SCHEME`: VAT = `(sale_price - cost_basis) * tax_rate / (100 + tax_rate)` when margin > 0, else 0 (gross-margin method). PDF must state Differenzbesteuerung. C will use `STANDARD` on the same invoice path.

### 5. Workshop prep on stock

`WorkshopOrder.purpose`: `CUSTOMER_REPAIR` (default) | `STOCK_PREP`.

`STOCK_PREP`: `customer_id` optional; **must not** create a customer invoice. On complete, post parts + internal labor cost as `WORKSHOP_COST`. `stock_status` is `IN_PREP` while open, then `IN_STOCK`. Do not invent a fake house customer.

### 6. Location

Add `LocationType.vehicle_lot` on `StorageLocation`. Stock vehicles optionally reference `location_id`. Do not store cars in `InventoryStock`.

**Architectural components affected:** Vehicle, Purchase (new module, not parts PO), Sales/Invoice, Workshop, Finance settings/numbering, StorageLocation, real-time entity map, deletion policy.

**Interface changes:** New `/api/vehicle-purchases`, `/api/vehicle-sales`, `/api/vehicle-stock` routes; Invoice DTO gains `tax_mode` and `vehicle_sale_id`; WorkshopOrder DTO gains `purpose` and optional `customer_id`; OpenAPI regeneration required.

## Consequences

### Positive

- VIN uniqueness, service history, and stock share one identity.
- Parts ledger invariants stay intact.
- Margin tax and private-seller purchase are first-class.
- B/C/D can attach to the same documents and enums.

### Negative

- A second ledger and two new document types to operate and test.
- Invoice now has a fourth parent path (`VehicleSale`), so ADR-0004 mapping grows.
- Workshop `customer_id` is no longer universally required.

### Neutral

- Incadea cost portions, option configurator, OEM allocation, and consignment remain deferred.
- `ADJUSTMENT` exists so write-down journals can land later without a new entry-type debate.

## Implementation Strategy

### Blast Radius

**Impact Scope:** Wrong tax math or selling a VIN twice is a fiscal/legal defect. Reversal is a new migration plus data repair, not a config flag.

**Affected Components:**

- `apps/core-api` Vehicle, new `vehicle-stock` module, Workshop, Invoices, Prisma schema
- `apps/core-web` stock list/purchase/sale pages, StatusBadge, query keys, nav
- Invoice PDF renderer

**User Impact:** New Vehicle Trading UI. Existing parts/workshop/CRM vehicle list remains for customer cars.

**Risk Mitigation:**

- TDD e2e per vertical slice before UI.
- Atomic `updateMany` guards on purchase receive, sale finalize, and stock_status (ADR-0011).
- Tenant `tenant_id` on every query (ADR-0013).
- Isolate margin math in one function with unit tests.

### Reversibility

**Reversibility Level:** Medium (schema additive; selling/invoicing is not casually undone).

**Rollback Feasibility:** Unused tables can be dropped if no posted documents exist. Posted invoices cannot be deleted (ADR-0005).

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| A — Vehicles as `CatalogItem` qty 1 | Reuses PO/SO/invoice | Fights ADR-0002; no VIN unit; no margin VAT; private seller does not fit Vendor PO |
| B — Separate vehicle invoice engine | Clean isolation | Duplicates numbering, PDF, lock date, snapshots |
| C — VIN master + vehicle ledger; reuse Invoice (this ADR) | Matches Incadea; reuses fiscal stack; extends existing Vehicle | Two ledgers; workshop customer optional |

## Validation

- Purchase from vendor and from private customer both create one `USED` vehicle and one `PURCHASE` ledger row.
- Duplicate VIN on purchase reuses the existing vehicle.
- `STOCK_PREP` completion does not create an `Invoice`; it posts `WORKSHOP_COST`.
- Sale finalize computes margin VAT from the cost-basis function, writes `SALE`, sets `inventory_role = CUSTOMER` and `customer_id = buyer`.
- Parts `InventoryStock` is never written for a vehicle VIN.

## Pragmatic Enforcer Analysis

Pragmatic mode is **enabled** (balanced).

| Score | Value | Notes |
|-------|-------|-------|
| Current need | 9/10 | A cannot ship on parts inventory |
| Future need | 8/10 | B/C/D are an explicit product sequence |
| Cost of waiting | High | A wrong model would force a rewrite |
| Added complexity | 7/10 | New ledger + documents + tax mode |
| Ratio | ~1.3 | Under 1.5 target if B/C/D **APIs/UI are not built now** |

**Simpler alternative rejected:** Catalog-item cars. **Simplification accepted:** one cost pool (no Incadea portions); simple `reserved_for_customer_id`; enum hooks for B/C/D without flows.

**Recommendation:** Approve with simplifications (A only; unused enum/FK hooks allowed; no trade-in/new/demo UI).

## References

- Feature Spec: `docs/internal/02-Feature-Specs/Vehicle/vehicle-stock-trading.md`
- ADR-0002: Ledger-Based Inventory (parts — do not extend for VINs)
- ADR-0003: Fiscal Lock Date
- ADR-0004: Invoice Snapshotting (amended: `VehicleSale` is a valid invoice parent)
- ADR-0005: Deletion Policy
- ADR-0009: Sequential Document Numbering
- ADR-0011: Atomic Status Transition Guards
- ADR-0013: Row-Level Multi-Tenancy
- Incadea DMS symbols: `C:\Git\autoscan\autoscan-incadea.dms-n721\symbols` (Vehicle 5025400, Vehicle Ledger Entry 5025405, Sales Trade-In 5025442)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Used Vehicle Trading](https://linear.app/auto-core-platform/project/used-vehicle-trading-85bd7ec3553f) |
| Milestone | M1 Used buy-stock-sell |
| Issues | AUT-119, AUT-120, AUT-121, AUT-122, AUT-123, AUT-124, AUT-125, AUT-126 |
