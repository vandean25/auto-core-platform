---
title: "Vehicle Management"
date: "2026-04-12"
module: "Vehicle"
status: draft
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - feature-spec
  - vehicle
  - crm
---

# Vehicle Management

## Summary

> The Vehicle module provides a centralized registry of vehicles tracked across the platform. Each row is the **VIN master**: make, model, year, engine code, VIN, and license plate. For **customer/service cars** (`inventory_role = CUSTOMER`) this remains a CRM identity that connects owners to workshop orders, parts sales, and invoices, and drives the Fitment Engine. The same table is also the stock identity for dealer-owned cars — see [Vehicle Stock Trading](vehicle-stock-trading.md) and ADR-0016. Do not create a second vehicle table. Vehicles are created during workshop intake, customer management, or (for stock) vehicle purchase receive.

---

## User Stories

- As a **service advisor**, I want to **view a vehicle's complete service and sales history** so that **I can advise the customer on upcoming maintenance**.
- As a **workshop receptionist**, I want to **look up a vehicle by license plate or VIN** so that **I can quickly find existing records during intake**.
- As a **service advisor**, I want to **assign or reassign a vehicle to a customer** so that **ownership changes are tracked**.
- As a **workshop technician**, I want the **vehicle's make, model, year, and engine code to drive fitment search** so that **only compatible parts and labor operations are suggested**.
- As a **service advisor**, I want to **start a new workshop order directly from a vehicle's detail page** so that **the vehicle is pre-linked to the order**.

---

## Database Impact

### Entity: `vehicles`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | UUID | No | PK |
| `make` | String | No | Vehicle manufacturer (e.g., "BMW") |
| `model` | String | No | Vehicle model (e.g., "320d") |
| `year` | Int | No | Model year |
| `engine_code` | String | Yes | Engine variant identifier |
| `vin` | String | Yes | Vehicle Identification Number — unique constraint |
| `plate` | String | Yes | License plate number |
| `customer_id` | UUID | Yes | FK → `customers`. Null = unassigned vehicle. |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

**Relations:**
- `Vehicle` → `Customer` (many-to-one, optional): Owner.
- `Vehicle` → `WorkshopOrder[]` (one-to-many): Service history.
- `Vehicle` → `SalesOrder[]` (one-to-many): Parts sales linked to this vehicle.
- `Vehicle` → `Invoice[]` (one-to-many): Billing history.

### Unique Constraints

- `vin`: Unique when non-null. Duplicate VINs throw `ConflictException`.
- `plate`: Not formally unique in schema but validated in service for duplicates.

### Deletion Policy Impact

| Entity | Strategy | Rule |
|--------|----------|------|
| `Vehicle` | **Blocked (Conditional)** | Cannot delete if linked to any `WorkshopOrder`, `SalesOrder`, or `Invoice`. Vehicle must have no downstream references. |

> This aligns with `docs/deletion-policy.md`.

---

## State Machine & Transitions

This module does not use a status state machine. Vehicles are reference entities — they exist and accumulate history over their lifetime.

### Customer Assignment Lifecycle

- A vehicle can be created without a customer (`customer_id = null`).
- A customer can be assigned later via `PATCH /vehicles/:id` with `customer_id`.
- A customer can be detached by setting `customer_id = null` (e.g., vehicle sold to another owner).
- Changing the customer does **not** reassign historical orders — past orders retain their original customer linkage.

---

## API Contract Changes

### Endpoints

| Method | Route | Request | Response | Description |
|--------|-------|---------|----------|-------------|
| GET | `/vehicles?search=&page=&pageSize=&sortField=&sortDirection=` | Query params | Paginated `Vehicle[]` with customer | List vehicles with search/sort/pagination |
| GET | `/vehicles/:id` | — | `Vehicle` with customer, last 20 sales orders, last 20 workshop orders (with tasks + invoice), last 20 invoices | Full vehicle detail with history |
| PATCH | `/vehicles/:id` | `UpdateVehicleDto` | `Vehicle` with customer | Update vehicle fields or customer assignment |

**Search:** The `search` query param matches across `make`, `model`, `plate`, `vin`, `engine_code`, and the linked customer's `first_name` / `last_name` (OR logic).

**Sort Fields:** `createdAt`, `make`, `model`, `year`, `plate`, `vin`, `customer` (customer last name).

**Note:** There is no `POST /vehicles` endpoint in the Vehicle controller. Vehicles are created through the Workshop intake flow or Customer management UI.

### OpenAPI Regeneration

- [x] Contract already generated and committed.

---

## UX Compliance

### Layout & Actions

- [x] Vehicle detail page header: title shows `{make} {model}` with year badge.
- [x] "Start Service" button top-right to create a workshop order pre-linked to this vehicle.
- [x] Top-left reserved for breadcrumbs / title / vehicle metadata.
- [x] Uses `text-2xl font-semibold tracking-tight` for page header.

### List Page (`/vehicles`)

- [x] Create button: Not present — vehicles are created via Workshop intake or Customer flow.
- [x] Search bar searches across make, model, plate, VIN, engine code, and customer name.
- [x] Sortable column headers via `DataTable` / `DataTableColumnHeader`.
- [x] Columns: Vehicle (make + model with icon), Year, VIN, Plate, Customer.
- [x] Row click navigates to `/vehicles/:id`.
- [x] Default page size: 10.

### Detail Page (`/vehicles/:id`)

- [x] **Inline editable fields** via save-on-blur (ADR-0006 Pattern 2): make, model, year (validated 1900–2100), engine_code, vin, plate.
- [x] **Customer assignment** via dialog with search.
- [x] **Tabs** for Active Sales Orders and Active Workshop Orders (excludes `INVOICED` status).
- [x] Workshop order rows show total cost (sum of task line items).
- [x] Order history table.

### Real-Time Sync

- [x] `Vehicle` mutations (`VEHICLE`) emit socket events via `SUPPORTED_ENTITY_TYPES`.
- [x] Frontend `dashboard-entity-map.ts` maps `VEHICLE` to vehicle query key invalidation.

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `VehicleList` | `src/pages/vehicles/` | DataTable of all vehicles with search, sort, pagination. |
| `VehicleDetail` | `src/pages/vehicles/` | Detail page with inline edit, customer assignment, and order history tabs. |
| `CustomerAssignDialog` | `src/pages/vehicles/` or `src/components/vehicles/` | Modal for searching and assigning a customer to a vehicle. |

---

## Testing Plan

### Backend E2E

- [ ] Happy-path: Create vehicle (via workshop intake) → Assign customer → Update fields → Verify detail includes related orders.
- [ ] Search: Create vehicles with different makes/plates → Search by plate → Verify correct results.
- [ ] Customer detach: Assign customer → Set `customer_id = null` → Verify vehicle is unassigned but historical orders unchanged.
- [ ] Unique VIN: Create two vehicles with same VIN → Expect `ConflictException` on second.
- [ ] Deletion guard: Create vehicle → Create workshop order for it → Attempt delete → Expect rejection.

### Frontend

- [ ] Visual QA: Vehicle list with pagination, vehicle detail with inline editing, customer assignment dialog.
- [ ] Fitment integration: Open workshop order for this vehicle → Search parts → Verify fitment-filtered results.

---

## Open Questions

1. **Vehicle creation flow:** Should a standalone `POST /vehicles` endpoint exist, or should vehicles only be created as part of workshop intake / customer management?
2. **Plate uniqueness:** The schema does not enforce a unique constraint on `plate`. Should it?
3. **Vehicle transfer history:** When `customer_id` changes, should an audit log entry record the previous owner?
4. **Vehicle images:** Is there a need for storing vehicle photos (e.g., intake condition photos)?

---

## References

- ADR-0016: Vehicle Stock Is a Parallel Ledger Domain — same `Vehicle` row can be `USED` stock; CRM list at `/vehicles` is not the stock list
- Feature Spec: `vehicle-stock-trading.md`
- ADR-0005: Deletion Policy — Blocked (Conditional) for Vehicle
- ADR-0006: Form Auto-Save — vehicle detail uses save-on-blur for inline edits
- ADR-0001: Prisma Real-Time Sync — `VEHICLE` in `SUPPORTED_ENTITY_TYPES`
- Sales Feature Spec: `sales-and-crm.md` — SalesOrder optionally references Vehicle
- Workshop Feature Spec: `workshop-order-lifecycle.md` — WorkshopOrder requires Vehicle; vehicle specs drive fitment
- Labor Feature Spec: `labor-and-fitment-engine.md` — Fitment engine uses vehicle make/model/year/engine_code
- `docs/internal/04-Database/core-erd.md` — Vehicle relationships in ERD

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | N/A |
| Issues | Backfilled Spec |
