---
title: "Brand Master Data"
date: "2026-04-12"
module: "Brand"
status: draft
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - feature-spec
  - brand
  - master-data
---

# Brand Master Data

## Summary

> The Brand module provides centralized management of vehicle makes and part manufacturers. A single `Brand` entity serves dual purposes — it can represent a vehicle make (e.g., "BMW", "Toyota"), a part manufacturer (e.g., "Bosch", "Mann"), or both. Brands are linked to `Vendor` entities (which brands a supplier carries) and `CatalogItem` entities (which brand manufactured the part), enabling consistent categorization and smart filtering across the Procurement and Inventory modules. Brand management is accessed through the Settings page.

---

## User Stories

- As an **admin**, I want to **create and manage brands** so that **parts and vehicles are consistently categorized across the system**.
- As an **admin**, I want to **flag a brand as a vehicle make, a part manufacturer, or both** so that **the system can filter brands contextually** (e.g., vehicle make dropdowns only show vehicle makes).
- As a **parts manager**, I want to **assign a brand to each catalog item** so that **I can filter inventory by manufacturer**.
- As a **procurement manager**, I want to **link brands to vendors** so that **I know which suppliers carry which brands**.

---

## Database Impact

### Entity: `brands`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | Int (auto-increment) | No | PK — note: integer, not UUID |
| `name` | String | No | Unique |
| `isVehicleMake` | Boolean | No | Default false |
| `isPartManufacturer` | Boolean | No | Default false |
| `logoUrl` | String | Yes | URL to brand logo image |
| `createdAt` | DateTime | No | |
| `updatedAt` | DateTime | No | |

**Relations:**
- `Brand` → `Vendor[]` (many-to-many via `VendorBrands` join table): Which vendors carry this brand.
- `Brand` → `CatalogItem[]` (one-to-many): Which parts are manufactured by this brand.

### Validation Rules

- At least one of `isVehicleMake` or `isPartManufacturer` must be `true`. A brand with both flags `false` is rejected.
- `name` must be unique (case-sensitive). Duplicate names throw `ConflictException`.

### Deletion Policy Impact

| Entity | Strategy | Rule |
|--------|----------|------|
| `Brand` | **Blocked (Conditional)** | Cannot delete if linked to any `CatalogItem` or `Vendor`. All references must be removed first. |

This is already documented in `docs/deletion-policy.md`.

---

## State Machine & Transitions

This module does not use a status state machine. Brands are simple master data records — they exist or they don't.

---

## API Contract Changes

### Endpoints

| Method | Route | Request | Response | Description |
|--------|-------|---------|----------|-------------|
| POST | `/brands` | `CreateBrandDto` | `Brand` | Create new brand |
| GET | `/brands?isVehicleMake={bool}&isPartManufacturer={bool}` | Query params (optional filters) | `Brand[]` | List brands with optional type filter |
| GET | `/brands/:id` | — | `Brand` | Single brand |
| PATCH | `/brands/:id` | `UpdateBrandDto` | `Brand` | Update brand |
| DELETE | `/brands/:id` | — | — | Delete brand (with dependency guard) |

### DTOs

**CreateBrandDto:**
- `name`: string (required)
- `isVehicleMake`: boolean (required)
- `isPartManufacturer`: boolean (required)
- `logoUrl`: string (optional, validated as URL)

**UpdateBrandDto:** All fields optional (partial update).

### OpenAPI Regeneration

- [x] Contract already generated and committed.

---

## UX Compliance

### Layout & Actions

- [x] Brand management lives in the **Settings page** (`/settings?tab=brands`), not a standalone page.
- [x] Create action: `+ Brand` button top-right of the brands tab.
- [x] Uses `AddBrandDialog` modal for creation (inline with Settings page patterns).

### List Display

- [x] `BrandTable` component renders all brands in a table within the Settings tab.
- [x] Editable inline via `setEditingBrand` state pattern.
- [x] Delete action available per row (with dependency guard feedback).

### Form Handling

- [x] Brand creation via modal dialog (not auto-save — explicit submit).
- [x] Brand editing: inline within the Settings table.

### Real-Time Sync

- [ ] `Brand` is **not** in `SUPPORTED_ENTITY_TYPES`. Brand changes are low-frequency admin operations and do not require real-time dashboard updates.

> **Rationale:** Brands are master data edited rarely. The Settings page is not a collaborative real-time surface. Standard cache invalidation on mutation is sufficient.

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `BrandTable` | `src/pages/settings/` or `src/components/brand/` | Table displaying all brands with edit/delete actions. |
| `AddBrandDialog` | `src/pages/settings/` or `src/components/brand/` | Modal form for creating a new brand. |

---

## Testing Plan

### Backend E2E

- [ ] Happy-path: Create brand with both flags → List with filter → Update → Delete.
- [ ] Validation: Attempt to create brand with both flags `false` → Expect rejection.
- [ ] Uniqueness: Attempt to create duplicate brand name → Expect `ConflictException`.
- [ ] Deletion guard: Create brand → Link to vendor → Attempt delete → Expect rejection with descriptive error.
- [ ] Deletion guard: Create brand → Link to catalog item → Attempt delete → Expect rejection.

### Frontend

- [ ] Visual QA: Brands tab in Settings, AddBrandDialog, inline editing, delete confirmation.
- [ ] Filter behavior: `isVehicleMake` and `isPartManufacturer` dropdowns in other modules show only relevant brands.

---

## Open Questions

1. **Logo storage:** Is `logoUrl` an external URL or should we support file upload to a storage bucket?
2. **Brand merge:** If two brands represent the same entity (e.g., "BMW" and "Bmw"), is a merge/dedup tool needed?

---

## References

- ADR-0005: Deletion Policy — Blocked (Conditional) strategy for Brand
- Finance Feature Spec: `finance-and-settings.md` — Brand managed in the same Settings page
- Vendor Feature Spec: (covered in `procurement-and-purchasing.md`) — Vendors link to supported brands
- Inventory Feature Spec: `inventory-and-catalog.md` — CatalogItem references Brand as manufacturer
- `docs/internal/04-Database/core-erd.md` — Brand relationships in ERD

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | N/A |
| Issues | Backfilled Spec |
