---
title: "Vehicle Stock Trading (Used Cars)"
date: "2026-08-15"
module: "Vehicle"
status: draft
linear-project: "https://linear.app/auto-core-platform/project/used-vehicle-trading-85bd7ec3553f"
linear-milestone: "M1 Used buy-stock-sell"
tags:
  - feature-spec
  - vehicle
  - inventory
  - purchase
  - sales
  - tax
---

# Vehicle Stock Trading (Used Cars)

## Summary

> Phase A lets a dealer **buy a used vehicle** (from a vendor or a private customer), **hold it as VIN stock**, run **workshop prep whose cost attaches to the vehicle**, and **sell it** on an existing tax invoice using **Differenzbesteuerung** (VAT on the margin). Vehicles are not catalog parts. The existing `Vehicle` row is the VIN master (ADR-0016). Trade-in (B), new cars (C), and demo/company cars (D) are extension hooks only — no UI or APIs for those flows in this spec.

---

## User Stories

- As a **dealer**, I want to **purchase a used car from a vendor or a private person** so that **it appears in VIN stock at that cost**.
- As a **dealer**, I want to **see all cars I own for sale** (VIN, plate, status, cost, location) so that **I know what I can sell**.
- As a **service advisor**, I want to **open a stock-prep workshop order on a stock car** so that **repairs and TÜV are done before sale and the cost is capitalized**.
- As a **dealer**, I want to **reserve a stock car for a customer** so that **nobody else sells that VIN**.
- As a **dealer**, I want to **sell a stock car and issue an invoice with Differenzbesteuerung** so that **VAT is only due on the profit**.
- As a **service advisor**, I want the **sold car to become the buyer’s vehicle** so that **future workshop orders use the same VIN history**.

---

## Database Impact

### New enums

```prisma
enum VehicleInventoryRole {
  CUSTOMER
  USED
  NEW    // C — do not write in A
  DEMO   // D — do not write in A
}

enum VehicleStockStatus {
  ON_ORDER
  IN_STOCK
  RESERVED
  IN_PREP
  SOLD
}

enum VehicleTaxScheme {
  MARGIN
  STANDARD // C — do not write in A
}

enum VehiclePurchaseSellerType {
  VENDOR
  CUSTOMER
}

enum VehicleAcquisitionKind {
  DIRECT
  TRADE_IN // B — do not write in A
}

enum VehiclePurchaseStatus {
  DRAFT
  RECEIVED
  CANCELLED
}

enum VehicleSaleStatus {
  DRAFT
  INVOICED
  CANCELLED
}

enum VehicleLedgerEntryType {
  PURCHASE
  WORKSHOP_COST
  ADJUSTMENT
  SALE
}

enum InvoiceTaxMode {
  STANDARD
  MARGIN_SCHEME
}

enum WorkshopOrderPurpose {
  CUSTOMER_REPAIR
  STOCK_PREP
}
```

Add `vehicle_lot` to `LocationType`.

### Modified tables

| Table | Change | Migration Required? |
|-------|--------|---------------------|
| `vehicles` | Add `inventory_role` (default `CUSTOMER`), `stock_status`, `tax_scheme`, `mileage`, `color`, `key_number`, `registration_certificate_no`, `location_id`, `reserved_for_customer_id` | Yes |
| `workshop_orders` | Add `purpose` (default `CUSTOMER_REPAIR`); `customer_id` nullable | Yes |
| `invoices` | Add `tax_mode` (default `STANDARD`), `vehicle_sale_id` unique per tenant | Yes |
| `finance_settings` | Add `next_vehicle_purchase_number`, `vehicle_purchase_prefix` (`VP-2026-`), `next_vehicle_sale_number`, `vehicle_sale_prefix` (`VS-2026-`) | Yes |
| `storage_locations` | New type value `vehicle_lot` only | Yes (enum) |

### New tables

#### `vehicle_purchases`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | UUID | No | PK |
| `tenant_id` | String | No | Tenant isolation |
| `purchase_number` | String | No | Unique per tenant; assigned on create |
| `status` | VehiclePurchaseStatus | No | Default `DRAFT` |
| `seller_type` | VehiclePurchaseSellerType | No | |
| `vendor_id` | UUID | Yes | Required if `VENDOR` |
| `customer_id` | UUID | Yes | Required if `CUSTOMER` |
| `acquisition_kind` | VehicleAcquisitionKind | No | A: always `DIRECT` |
| `vehicle_id` | UUID | Yes | Set on receive (created or reused) |
| `vin` | String | No | 17-char VIN, stored uppercase |
| `make` / `model` / `year` | String/String/Int | No | Snapshot for receive |
| `engine_code` / `plate` / `color` | String | Yes | |
| `mileage` | Int | Yes | |
| `key_number` | String | Yes | |
| `registration_certificate_no` | String | Yes | |
| `purchase_price` | Decimal(12,2) | No | Gross cost basis seed |
| `location_id` | UUID | Yes | `vehicle_lot` |
| `received_at` | DateTime | Yes | |

#### `vehicle_sales`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | UUID | No | PK |
| `tenant_id` | String | No | |
| `sale_number` | String | No | Unique per tenant |
| `status` | VehicleSaleStatus | No | Default `DRAFT` |
| `vehicle_id` | UUID | No | Must be `USED` and sellable |
| `customer_id` | UUID | No | Buyer |
| `sale_price` | Decimal(12,2) | No | Gross selling price |
| `cost_basis_snapshot` | Decimal(12,2) | Yes | Frozen at finalize |
| `margin_vat_snapshot` | Decimal(12,2) | Yes | Frozen at finalize |
| `trade_in_purchase_id` | UUID | Yes | B only; null in A |
| `invoice_id` | UUID | Yes | Set on finalize |

#### `vehicle_ledger_entries`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | UUID | No | PK |
| `tenant_id` | String | No | |
| `vehicle_id` | UUID | No | |
| `entry_type` | VehicleLedgerEntryType | No | |
| `amount` | Decimal(12,2) | No | Signed: costs positive, `SALE` negative (sale price) or 0 if SALE is informational — **use positive cost amounts for PURCHASE/WORKSHOP_COST/ADJUSTMENT; SALE stores sale_price as negative** |
| `posting_date` | DateTime | No | Lock-date checked |
| `vehicle_purchase_id` | UUID | Yes | |
| `vehicle_sale_id` | UUID | Yes | |
| `workshop_order_id` | UUID | Yes | |
| `notes` | String | Yes | |

Never update or delete ledger rows. No cached `vehicle.cost` without deriving from SUM of ledger (optional eager cache is allowed only if updated in the same transaction as the insert, same rule as ADR-0002).

### Deletion Policy Impact

See `docs/deletion-policy.md`. New entities:

| Entity | Strategy |
|--------|----------|
| `VehiclePurchase` | Draft-only delete if not `RECEIVED` and no ledger rows |
| `VehicleSale` | Draft-only delete if not `INVOICED` and no invoice |
| `VehicleLedgerEntry` | Forbidden (immutable) |

`Vehicle` delete remains blocked if any workshop/sales/invoice **or** any vehicle purchase/sale/ledger exists.

---

## API Contract Changes

All routes under `/api`, tenant from context. Query-key factory on the frontend (e.g. `vehicleStockKeys`).

### New Endpoints

| Method | Route | Request Body | Response | Auth |
|--------|-------|-------------|----------|------|
| GET | `/vehicle-stock` | query: `search`, `stock_status`, `page`, `limit` | `{ data, meta }` of stock vehicles (`inventory_role` in `USED`/`NEW`/`DEMO`; A data is `USED` only) | session |
| GET | `/vehicle-stock/:vehicleId` | — | Vehicle + ledger + open workshop + purchase/sale links | session |
| PATCH | `/vehicle-stock/:vehicleId` | `location_id`, `reserved_for_customer_id` (null to unreserve), mileage/color/keys/papers | Vehicle | session |
| POST | `/vehicle-purchases` | see DTO below | VehiclePurchase `DRAFT` | session |
| GET | `/vehicle-purchases` | `search`, `page`, `limit` | `{ data, meta }` | session |
| GET | `/vehicle-purchases/:id` | — | VehiclePurchase | session |
| POST | `/vehicle-purchases/:id/receive` | — | VehiclePurchase `RECEIVED` + Vehicle + ledger | session |
| POST | `/vehicle-purchases/:id/cancel` | — | `CANCELLED` if `DRAFT` | session |
| POST | `/vehicle-sales` | `vehicle_id`, `customer_id`, `sale_price` | VehicleSale `DRAFT` | session |
| GET | `/vehicle-sales/:id` | — | VehicleSale + cost basis preview | session |
| POST | `/vehicle-sales/:id/finalize` | — | VehicleSale `INVOICED` + Invoice | session |

### CreateVehiclePurchaseDto

```ts
{
  seller_type: 'VENDOR' | 'CUSTOMER'
  vendor_id?: string  // required if VENDOR
  customer_id?: string // required if CUSTOMER
  vin: string
  make: string
  model: string
  year: number
  engine_code?: string
  plate?: string
  color?: string
  mileage?: number
  key_number?: string
  registration_certificate_no?: string
  purchase_price: number // > 0
  location_id?: string
}
```

Reject `acquisition_kind` other than `DIRECT` in A (do not even accept the field, default in DB).

### Receive behavior

Inside `prisma.$transaction`:

1. Guard `updateMany` where `id` + `status: DRAFT`.
2. Find `Vehicle` by `tenant_id` + VIN (uppercase). If exists, require it is not currently `USED` with `stock_status` in `ON_ORDER|IN_STOCK|RESERVED|IN_PREP` (cannot double-stock). Reuse row. If missing, create.
3. Set `inventory_role=USED`, `stock_status=IN_STOCK`, `tax_scheme=MARGIN`, copy identity fields, `customer_id=null` (dealer-owned).
4. Insert ledger `PURCHASE` with `amount = purchase_price`.
5. Set purchase `vehicle_id`, `received_at`, `status=RECEIVED`.

### Finalize sale behavior

1. Guard vehicle `USED` and `stock_status` in `IN_STOCK|RESERVED`. If `RESERVED`, `reserved_for_customer_id` must equal buyer (or allow override only if unset).
2. Reject if an open `STOCK_PREP` workshop order exists for the VIN.
3. `cost_basis = sumLedger(vehicleId)` (PURCHASE + WORKSHOP_COST + ADJUSTMENT).
4. `marginVat = marginVatGross(sale_price, cost_basis, tax_rate)` — default tax_rate 20.
5. Create `Invoice` `DRAFT` then transition to `FINALIZED` per existing invoice service (number, snapshot, lock date): `tax_mode=MARGIN_SCHEME`, `vehicle_id`, `customer_id`, `vehicle_sale_id`. One `InvoiceItem`: description `{year} {make} {model} VIN {vin}`, `quantity=1`, `unit_price=sale_price`, `tax_rate=20`, `line_total=sale_price`, snapshot `revenue_group_name` (use a dedicated revenue group name string `"Vehicle used (margin)"` or existing group if present).
6. `total_gross = sale_price`, `total_tax = marginVat`, `total_net = sale_price - marginVat`.
7. Ledger `SALE` amount `-(sale_price)` (or 0 + notes — **must be consistent**; prefer recording sale price as negative amount).
8. Vehicle: `stock_status=SOLD`, then `inventory_role=CUSTOMER`, `customer_id=buyer`, `reserved_for_customer_id=null`, `stock_status=null`.
9. Guard sale `DRAFT` → `INVOICED` with `updateMany`.

### Cost basis and margin VAT (single module)

`apps/core-api/src/vehicle-stock/vehicle-cost.ts`:

```ts
export function costBasis(entries: { entry_type: string; amount: Prisma.Decimal }[]): Prisma.Decimal
export function marginVatGross(salePrice: Prisma.Decimal, costBasis: Prisma.Decimal, taxRatePercent: Prisma.Decimal): Prisma.Decimal
// VAT = max(sale - cost, 0) * rate / (100 + rate), rounded to 2 decimals (same rounding as invoices)
```

### Modified Endpoints

| Method | Route | Change |
|--------|-------|--------|
| Workshop create | existing workshop create | Accept `purpose`. If `STOCK_PREP`, `customer_id` optional; vehicle must be `USED` in `IN_STOCK` or `RESERVED`; set vehicle `stock_status=IN_PREP`. |
| Workshop complete | existing complete | If `STOCK_PREP`, **do not** create invoice. Sum task line costs (parts cost + labor internal cost) → ledger `WORKSHOP_COST`. Set vehicle `stock_status` back to `IN_STOCK` (or `RESERVED` if still reserved). |

### OpenAPI Regeneration

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## State machines

### VehiclePurchase

`DRAFT → RECEIVED` (receive). `DRAFT → CANCELLED`. No other transitions. `RECEIVED` is terminal.

### VehicleSale

`DRAFT → INVOICED` (finalize). `DRAFT → CANCELLED`. `INVOICED` is terminal (invoice cancellation does not auto-restock in A — document as out of scope).

### Vehicle stock_status (USED)

`ON_ORDER` unused in A receive-immediate path (reserved for C). A receive goes straight to `IN_STOCK`.

`IN_STOCK → RESERVED` (patch reserve). `RESERVED → IN_STOCK` (clear reserve). `IN_STOCK|RESERVED → IN_PREP` (stock-prep start). `IN_PREP → IN_STOCK|RESERVED` (stock-prep complete). `IN_STOCK|RESERVED → SOLD` (sale finalize, then role becomes CUSTOMER).

Atomic `updateMany` on `id + stock_status + tenant_id` for every transition (ADR-0011).

### WorkshopOrder STOCK_PREP

Same operational states as customer repair through `COMPLETED`. **`COMPLETED` is terminal** — no `INVOICED` transition.

---

## UX Compliance

### Layout & Actions

- [ ] Page-level actions top-right.
- [ ] Top-left: title / badges only.
- [ ] Header `text-2xl font-semibold tracking-tight`, subtitle `text-slate-500`.

### List Pages

- [ ] Stock list create button: `+ Vehicle` (starts purchase).
- [ ] Search VIN, plate, make, model, color.
- [ ] Sortable DataTable headers.
- [ ] `StatusBadge` for `stock_status` (add `ON_ORDER`, `RESERVED`, `IN_PREP`, `SOLD` to `statusClassMap` if missing; `IN_STOCK` already exists).
- [ ] Row click → stock detail.
- [ ] Right-click Delete only on draft purchases, not on received stock cars.

### Form Handling

- [ ] Purchase and sale documents: debounced 750ms auto-save while `DRAFT`.
- [ ] Stock detail isolated fields (mileage, notes, reserve): save-on-blur `InlineEdit`.

### Real-Time Sync

- [ ] Add `VEHICLE_PURCHASE` and `VEHICLE_SALE` to `SUPPORTED_ENTITY_TYPES` and `DashboardEntityType`.
- [ ] Frontend `dashboard-entity-map.ts`: those types + existing `VEHICLE` invalidate `vehicleStockKeys`.
- [ ] Do **not** broadcast every `VehicleLedgerEntry` (invalidate via parent vehicle/purchase/sale).

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `VehicleStockList` | `apps/core-web/src/pages/vehicle-stock/` | Operational stock list |
| `VehicleStockDetail` | `apps/core-web/src/pages/vehicle-stock/` | Ledger, reserve, location, prep, sell |
| `VehiclePurchasePage` | `apps/core-web/src/pages/vehicle-stock/` | Draft/receive purchase (vendor or customer seller) |
| `VehicleSalePage` | `apps/core-web/src/pages/vehicle-stock/` | Buyer, price, live margin/VAT, finalize |
| `vehicleStockKeys` | `apps/core-web/src/api/vehicle-stock.ts` | Query key factory |
| Nav group | `App.tsx` / `AppSidebar.tsx` | “Vehicle Stock” under Workshop or own group |

Existing `/vehicles` list stays the CRM/service registry. Stock cars may show a badge there; operational work happens on `/vehicle-stock`.

Invoice PDF: if `tax_mode === MARGIN_SCHEME`, print legal line: `Differenzbesteuerung gemäß § 24 UStG (Gebrauchtgegenstände).` Do not imply the buyer can deduct input VAT on the full price.

---

## Testing Plan

### Backend E2E (`apps/core-api/test/vehicle-stock.e2e-spec.ts`)

- [ ] Vendor purchase receive → vehicle `USED`/`IN_STOCK`, one `PURCHASE` ledger row, tenant isolation.
- [ ] Private customer purchase receive → same, `seller_type=CUSTOMER`.
- [ ] VIN reuse: existing `CUSTOMER` vehicle with same VIN is reused, not duplicated.
- [ ] Double-stock same VIN while `IN_STOCK` → 409.
- [ ] `STOCK_PREP` complete → `WORKSHOP_COST` ledger, no invoice, status back to `IN_STOCK`.
- [ ] Sale blocked while `STOCK_PREP` open.
- [ ] Sale finalize: invoice `MARGIN_SCHEME`, `total_tax` matches `marginVatGross`, vehicle becomes buyer `CUSTOMER`, ledger `SALE`.
- [ ] Margin zero or negative cost>price → `total_tax = 0`.
- [ ] Cross-tenant vehicle id → 404.
- [ ] Receive/finalize against `lock_date` → 400.
- [ ] A API rejects creating `NEW`/`DEMO`/`TRADE_IN`/`STANDARD` if those fields are exposed.

### Unit

- [ ] `marginVatGross` table: sale 12000, cost 10000, 20% → VAT = 20000/120 = 333.33 (document expected rounding).
- [ ] `costBasis` ignores `SALE` rows.

### Frontend

- [ ] Visual QA stock list, purchase, sale margin preview, PDF legal text.

---

## Appendix: B / C / D hooks (do not implement)

**B Trade-in:** `VehicleSale.trade_in_purchase_id` + `VehiclePurchase.acquisition_kind=TRADE_IN` with `seller_type=CUSTOMER`. Receive flips buyer’s existing VIN to `USED`. Invoice nets sale minus allowance.

**C New:** purchase `inventory_role=NEW`, `tax_scheme=STANDARD`; sale `Invoice.tax_mode=STANDARD`. `ON_ORDER` used when ordered but not received.

**D Demo:** `inventory_role=DEMO`; own-use via `STOCK_PREP` (or later `OWN_USE`); sale typically `STANDARD` VAT (accountant confirm).

---

## Open Questions

1. **§24 cost basis:** Does capitalized workshop cost reduce the margin VAT base, or only the original purchase price? Implementation uses the named `costBasis()` function so the rule can change.
2. **Revenue group:** Create a seed `RevenueGroup` for used-vehicle margin sales, or snapshot a fixed string?
3. **Invoice cancellation / restock:** Out of scope for A. Confirm before building credit notes for vehicle sales.
4. **VIN length/checksum:** Enforce ISO 3779 17-character VIN in the DTO?

---

## References

- ADR-0016: `docs/internal/01-ADR/2026-08-15-vehicle-stock-not-parts-inventory.md`
- ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0009, ADR-0011, ADR-0013
- CRM Vehicle spec: `vehicle-management.md` (identity; not stock)
- `docs/deletion-policy.md`
- Incadea: Vehicle 5025400, Vehicle Ledger Entry 5025405, Differential Tax

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Used Vehicle Trading](https://linear.app/auto-core-platform/project/used-vehicle-trading-85bd7ec3553f) |
| Milestone | M1 Used buy-stock-sell |
| Issues | AUT-119, AUT-120, AUT-121, AUT-122, AUT-123, AUT-124, AUT-125, AUT-126 |
