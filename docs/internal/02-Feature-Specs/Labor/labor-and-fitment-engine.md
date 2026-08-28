---
title: "Labor & Fitment Engine"
date: "2026-04-12"
module: "Labor"
status: draft
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - feature-spec
  - labor
  - fitment
  - workshop
---

# Labor & Fitment Engine

## Summary

> The Labor & Fitment Engine provides a vehicle-aware search and management system for labor operations and master parts. It enables workshop technicians to find labor operations and parts that are compatible with a specific vehicle's make, model, year, and engine code. The engine powers the inline search within Workshop Task line items, ensuring that only relevant operations and parts are surfaced. It also manages a hierarchical labor category taxonomy and a parallel master parts catalog (`MasterPart`) with local inventory tracking (`LocalInventory`) that coexists with the primary `CatalogItem` inventory system.

---

## User Stories

- As a **workshop manager**, I want to **search for labor operations by vehicle fitment** so that **only operations relevant to the customer's vehicle are shown**.
- As a **workshop technician**, I want to **search for parts that fit the vehicle on the lift** so that **I don't accidentally order or consume incompatible parts**.
- As a **service advisor**, I want to **browse labor operations by category** so that **I can quickly build a workshop order estimate**.
- As an **admin**, I want to **manage labor categories in a hierarchy** so that **operations are organized logically for reporting and pricing**.
- As an **admin**, I want to **define fitment rules (make, model, year range, engine code) for each labor operation** so that **the search engine can filter accurately**.
- As a **parts manager**, I want to **maintain a master parts catalog with OEM cross-references and fitment data** so that **parts lookup is vehicle-aware**.

---

## Database Impact

### Entities

| Table | Column | Type | Nullable | Notes |
|-------|--------|------|----------|-------|
| `labor_categories` | `id` | UUID | No | PK |
| | `name` | String | No | Unique |
| | `description` | String | Yes | |
| | `sort_order` | Int | No | Default 0 |
| | `parent_id` | UUID | Yes | FK self-ref, max depth 2 |
| | `is_active` | Boolean | No | Default true |
| | `default_hourly_rate` | Decimal(10,2) | Yes | Inherited by child operations (selling rate) |
| | `default_internal_cost_rate` | Decimal(10,2) | Yes | Added by Vehicle Intelligence (ADR-0021). Snapshot onto workshop lines; never fall back to selling rate. |
| `labor_operations` | `id` | UUID | No | PK |
| | `code` | String | No | Unique identifier (e.g., `MECH-001`) |
| | `description` | String | No | Human-readable name |
| | `standard_aw` | Decimal(10,2) | No | Standard labour units (Arbeitswerte) |
| | `hourly_rate` | Decimal(10,2) | No | Billing rate per hour |
| | `internal_cost` | Decimal(10,2) | Yes | Internal cost for margin tracking |
| | `category_id` | UUID | Yes | FK → `labor_categories` (Restrict on delete) |
| | `is_active` | Boolean | No | Default true; soft-delete target |
| `labor_fitments` | `id` | UUID | No | PK |
| | `labor_operation_id` | UUID | No | FK → `labor_operations` (Cascade on delete) |
| | `make` | String | No | Vehicle make (e.g., "BMW") |
| | `model` | String | No | Vehicle model (e.g., "320d") |
| | `year_from` | Int | Yes | Null = any start year |
| | `year_to` | Int | Yes | Null = any end year |
| | `engine_code` | String | Yes | Null = any engine |
| `master_parts` | `id` | UUID | No | PK |
| | `supplier_part_number` | String | No | Unique |
| | `oem_number` | String | Yes | OEM cross-reference |
| | `description` | String | No | |
| | `brand` | String | No | Manufacturer name (free text) |
| `part_fitments` | `id` | UUID | No | PK |
| | `master_part_id` | UUID | No | FK → `master_parts` (Cascade on delete) |
| | `make` | String | No | Vehicle make |
| | `model` | String | No | Vehicle model |
| | `year_from` | Int | Yes | Null = any start year |
| | `year_to` | Int | Yes | Null = any end year |
| | `engine_code` | String | Yes | Null = any engine |
| `local_inventories` | `id` | UUID | No | PK |
| | `master_part_id` | UUID | No | FK → `master_parts` (1:1, Cascade), Unique |
| | `quantity_on_hand` | Int | No | Default 0 |
| | `bin_location` | String | Yes | Physical storage location |
| | `cost_price` | Decimal(10,2) | No | Purchase cost |
| | `retail_price` | Decimal(10,2) | No | Selling price |

### Key Indexes

- `labor_fitments`: Composite on `(make, model, year_from, year_to, engine_code)` for fitment search.
- `part_fitments`: Composite on `(make, model, year_from, year_to, engine_code)` for fitment search.
- `labor_operations`: Composite on `(code, description)` for text search; index on `(is_active, description)`.
- `master_parts`: Composite on `(supplier_part_number, oem_number, description)` for text search.

### Deletion Policy Impact

| Entity | Strategy | Rule |
|--------|----------|------|
| `LaborCategory` | **Blocked (Conditional)** | Cannot delete if has child categories or linked `LaborOperation` records. |
| `LaborOperation` | **Soft Delete** | Sets `is_active = false`. Preserves data for historical workshop tasks that reference it. |
| `LaborFitment` | **Cascade Delete** | Deleted when parent `LaborOperation` is deleted. |
| `MasterPart` | **Blocked (Conditional)** | Cannot delete if referenced by active workshop task line items. |
| `PartFitment` | **Cascade Delete** | Deleted when parent `MasterPart` is deleted. |
| `LocalInventory` | **Cascade Delete** | 1:1 with `MasterPart`; deleted with parent. |

> **Action required:** Add `LaborCategory`, `LaborOperation`, `LaborFitment`, `MasterPart`, `PartFitment`, and `LocalInventory` to `docs/deletion-policy.md`.

---

## State Machine & Transitions

This module does not use a traditional status state machine. Key lifecycle rules:

- **`LaborCategory`**: Active/Inactive toggle. Inactive categories cannot be assigned to new operations. Max hierarchy depth = 2 (parent → child, no grandchildren).
- **`LaborOperation`**: Active/Inactive toggle via `is_active` field. Soft-deleted operations remain queryable for historical workshop task references but are excluded from search results.
- **`MasterPart`**: No status field. Parts exist or are deleted.

### Fitment Matching Algorithm

When searching with a `workshopOrderId`:

1. Extract the `Vehicle` linked to the workshop order (make, model, year, engine_code).
2. Query `LaborFitment` / `PartFitment` records where:
   - `make` = vehicle make **AND** `model` = vehicle model
   - `year_from` ≤ vehicle year ≤ `year_to` (nulls treated as unbounded)
   - `engine_code` = vehicle engine code (null = matches all)
3. Return parent `LaborOperation` / `MasterPart` records that have at least one matching fitment.
4. Merge `MasterPart` results with `CatalogItem` results (CatalogItem takes priority on deduplication).

---

## API Contract Changes

### Endpoints

| Method | Route | Request | Response | Description |
|--------|-------|---------|----------|-------------|
| GET | `/labor/search?q={query}&workshopOrderId={id}` | Query params | `LaborOperationSearchResponse` | Vehicle-aware labor search (max 20) |
| GET | `/labor/operations?search=&categoryId=&isActive=&page=&limit=&sortField=&sortDirection=` | Query params | Paginated `LaborOperation[]` | List all operations with filters |
| GET | `/labor/operations/:id` | — | `LaborOperation` with fitments | Single operation detail |
| POST | `/labor/operations` | `CreateLaborOperationDto` | `LaborOperation` | Create operation + fitments |
| PATCH | `/labor/operations/:id` | `UpdateLaborOperationDto` | `LaborOperation` | Update operation (fitments replaced entirely) |
| DELETE | `/labor/operations/:id` | — | — | Soft delete (`is_active = false`) |
| GET | `/labor/categories` | — | Tree structure | Hierarchical category list |
| POST | `/labor/categories` | `CreateLaborCategoryDto` | `LaborCategory` | Create category |
| PATCH | `/labor/categories/:id` | `UpdateLaborCategoryDto` | `LaborCategory` | Update category |
| DELETE | `/labor/categories/:id` | — | — | Hard delete (with guards) |
| GET | `/catalog/search?q={query}&workshopOrderId={id}` | Query params | `CatalogSearchResponse` | Combined labor + parts search with fitment |

### OpenAPI Regeneration

- [x] Contract already generated and committed.

---

## UX Compliance

### Layout & Actions

- [x] Page-level actions (Create, Save, Delete) are **top-right aligned**.
- [x] Top-left reserved for breadcrumbs / title / badges only.
- [x] Uses `text-2xl font-semibold tracking-tight` for page header.
- [x] Subtitle uses `text-slate-500`.

### List Pages

- [x] Labor categories managed in Settings page (hierarchical tree view).
- [x] Labor operations: sortable DataTable with search, category filter, active status filter.
- [x] Create button format: `+ Operation` / `+ Category`.

### Form Handling

- [x] Labor operation edit: **debounced auto-save (750 ms)** for description, rates, and code fields (ADR-0006 Pattern 1).
- [x] Fitment rules: managed as an inline editable list within the operation detail — full replacement on save.
- [x] Category management: **save-on-blur** for name/description fields (ADR-0006 Pattern 2).

### Inline Workshop Search

The primary user-facing surface for this feature is the **catalog search** within Workshop Task line items:

- Technician types a search query in the task line item input.
- Frontend calls `/catalog/search` with the query and the workshop order ID.
- Results split into **Labor** and **Parts** tabs.
- Selecting a result adds it as a `WorkshopTaskLineItem`.

### Real-Time Sync

- [ ] `LaborCategory` and `LaborOperation` are **not** in `SUPPORTED_ENTITY_TYPES`. Changes are low-frequency master data edits and do not require real-time dashboard updates.
- [ ] `MasterPart` and `LocalInventory` are **not** in `SUPPORTED_ENTITY_TYPES`.

> **Rationale:** These are configuration/master data entities edited by admins, not transactional documents. Real-time sync is not justified.

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `LaborCategoryTree` | `src/pages/settings/` or `src/components/labor/` | Hierarchical tree view for category management in Settings. |
| `LaborOperationList` | `src/pages/settings/` or `src/components/labor/` | DataTable of operations with filters. |
| `LaborOperationDetail` | `src/components/labor/` | Edit form for a single operation including fitment rules. |
| `FitmentRuleEditor` | `src/components/labor/` | Inline editable list of fitment rules (make, model, year range, engine code). |
| `CatalogSearchCombobox` | `src/pages/workshop/components/` | The inline search input within workshop task line items that calls `/catalog/search`. |

---

## Testing Plan

### Backend E2E

- [ ] Happy-path: Create category → Create operation with fitments → Search by vehicle → Verify fitment filtering works.
- [ ] Category depth guard: Attempt to create depth-3 category → Expect rejection.
- [ ] Category deletion guard: Attempt to delete category with linked operations → Expect rejection.
- [ ] Operation soft delete: Delete operation → Verify `is_active = false`, excluded from search, but still retrievable by ID.
- [ ] Fitment edge cases: Null `year_from`/`year_to` matches any year; null `engine_code` matches any engine.
- [ ] Catalog search deduplication: MasterPart and CatalogItem with same part → CatalogItem takes priority.
- [ ] Catalog search without workshop order: Returns unfiltered results (no fitment filtering).

### Frontend

- [ ] Visual QA: Labor category tree in Settings, operation list with filters, fitment rule editor.
- [ ] Workshop search: Type query → see labor + parts tabs → select item → added to task.

---

## Open Questions

1. **`MasterPart` vs `CatalogItem` relationship:** Should `MasterPart` records be linkable to `CatalogItem` records (e.g., for stock tracking through the primary ledger)? Currently they are separate systems with deduplication at search time.
2. **`LocalInventory` vs `InventoryStock`:** `LocalInventory.quantity_on_hand` is mutated directly (not ledger-based). Should this be migrated to the `InventoryTransaction` ledger pattern (ADR-0002) for audit consistency?
3. **Fitment data import:** External TecDoc/OEM/Haynes lookup is specified in [Vehicle Intelligence & Parts Catalog](../Vehicle/2026-08-28-vehicle-intelligence-and-parts-catalog.md) (ADR-0021). Homemade `LaborFitment` / `PartFitment` is not that engine.
4. **`MasterPart.brand` is free text** — should it reference the `Brand` entity for consistency?

---

## References

- ADR-0002: Ledger-Based Inventory — `LocalInventory` bypasses the ledger pattern (flagged as open question)
- ADR-0005: Deletion Policy — soft delete for operations, blocked for categories, cascade for fitments
- ADR-0006: Form Auto-Save — operation editing uses debounced auto-save, category uses save-on-blur
- Workshop Feature Spec: `workshop-order-lifecycle.md` — consumes this module via `/catalog/search`

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | N/A |
| Issues | Backfilled Spec |
