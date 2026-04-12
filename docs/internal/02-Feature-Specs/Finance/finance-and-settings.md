---
title: "Finance & Global Settings"
date: "2026-04-12"
module: "Finance"
status: approved
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - feature-spec
  - finance
  - master-data
---

# Finance & Global Settings

## Summary

> The Finance & Settings module acts as the global control plane for the core architectural rules. It dictates the ERP compliance logic (fiscal lock dates), sequential numbering rules, tax categorization (Revenue Groups), and unified Master Data (Brands). This is not an active transactional module, but the foundation that all transaction modules report to.

---

## User Stories

- As a **Shop Owner**, I want to **configure global Revenue Groups** so that **my accountant can map sales of parts vs. labor to different tax accounts.**
- As a **Financial Controller**, I want to **set a strict Fiscal Lock Date** so that **my staff cannot backdate transactions into a closed financial quarter.**
- As a **System Admin**, I want to **manage a unified list of Brands** so that **we don't have duplicated entries for "Bosch" vs "BOSCH" across parts and vendors.**

---

## Database Impact

### Core Tables

| Table | Purpose | Key Constraints / Notes |
|-------|---------|-------------------------|
| `FinanceSettings` | True singleton table (ID=1). | Holds `lock_date` and invoice/order prefix and sequence counters. |
| `RevenueGroup` | Tax and accounting mapping. | Assigned to `CatalogItem` and `LaborCategory`. |
| `Brand` | Centralized master mapping. | Shared across `Vendor` and `CatalogItem`. |

### Deletion Policy Impact

> Governed by `docs/deletion-policy.md`.
- `FinanceSettings`: **Forbidden**. Singleton configuration record. Cannot be deleted. Only ID=1 should ever exist.
- `RevenueGroup`: **Conditional (hard delete)**. Allow only when no `CatalogItem` references it. If any catalog item is assigned this revenue group, deletion is blocked with a descriptive error. Historical `InvoiceItem` records snapshot the `revenue_group_name` (ADR-0004), so deleting a RevenueGroup does not corrupt historical invoices.
- `Brand`: **Conditional (hard delete)**. Allow only when no `CatalogItem` or `Vendor.supportedBrands` reference it.

---

## Global Architectural Enforcement

### The Singleton Enforcement
The `FinanceSettings` entity is mapped in the UI to the primary "Settings" tab. The backend must intercept any `POST` to create `FinanceSettings` and fail if ID=1 already exists, forcing an `UPSERT` or `PUT` methodology.

### Fiscal Lock Date
The `lock_date` column on `FinanceSettings` is the enforcement point for ADR-0003. Key rules:
- The lock date may only be moved **forward** (never backward — this would reopen closed periods).
- The UI must present a confirmation dialog before advancing.
- All downstream modules (Invoice, PurchaseInvoice, InventoryTransaction) validate their fiscal dates against this value.

See ADR-0003 for the full Lock Date Advancement Rules.

### Revenue Group Interception
Because historical invoices rely on `revenue_group_name` snapshots (ADR-0004), altering a `RevenueGroup.name` in this module will *not* retroactively change old invoices. This is the intended behavior. The UI should politely warn the admin that renaming a Revenue Group only affects future reporting.

---

## UX Compliance

### Settings Consolidation
- [x] All configuration (Finance, Revenue Groups, Brands, Storage Locations) is consolidated into a unified tabbed page at `src/pages/SettingsPage.tsx`.
- [x] Accessible via the gear icon in the sidebar navigation.

### Master Data Forms
- [x] UI forms for creating Master Data use standardized modal presentations rather than dedicated full-screen routing.

### Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `SettingsPage` | `src/pages/` | Unified tabbed settings page. |
| `FinanceSettingsTab` | `src/pages/settings/` | Lock date, numbering prefixes, sequence counters. |
| `RevenueGroupTab` | `src/pages/settings/` | CRUD for revenue groups. |
| `BrandTab` | `src/pages/settings/` | CRUD for brands (vehicle makes + part manufacturers). |
| `AddBrandDialog` | `src/components/settings/` | Modal for quick brand creation. |
| `AddRevenueGroupDialog` | `src/components/settings/` | Modal for quick revenue group creation. |

### Real-Time Sync

`FinanceSettings`, `RevenueGroup`, and `Brand` are **not** in `SUPPORTED_ENTITY_TYPES` (ADR-0001). Changes to these master data entities do not broadcast WebSocket events. This is intentional — settings changes are rare, low-frequency operations that do not need dashboard-level real-time updates. Connected clients will see updated values on their next page navigation or manual refresh.

---

## Testing Plan

### Backend E2E

- [ ] Singleton enforcement: cannot create a second `FinanceSettings` row.
- [ ] Lock date can only advance forward; backward move rejected with 422.
- [ ] RevenueGroup deletion blocked when referenced by a `CatalogItem`.
- [ ] Brand deletion blocked when referenced by a `CatalogItem` or `Vendor.supportedBrands`.
- [ ] Revenue group rename does not affect existing `InvoiceItem.revenue_group_name` snapshots.

### Frontend

- [ ] Visual QA: Settings tabs, lock date confirmation dialog, deletion error messaging.

---

## Open Questions

1. Should a `FINANCE_ADMIN` role be introduced to restrict lock date advancement, or is current Settings access sufficient?
2. Should Revenue Group and Brand support soft-delete (`is_active = false`) in addition to conditional hard delete, for cases where historical reference is needed but the entity should be hidden from dropdowns?

---

## References

- ADR-0003: Fiscal Lock Date — `FinanceSettings.lock_date` advancement rules and enforcement
- ADR-0004: Invoice Snapshotting — `revenue_group_name` is snapshotted at invoice creation
- ADR-0005: Deletion Policy — Forbidden for FinanceSettings, Conditional for RevenueGroup and Brand
- ADR-0009: Sequential Document Numbering — `FinanceSettings` holds SO/WO counters; `InvoiceSequence` holds invoice counters

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | None (Retroactive Documentation) |
| Milestone | Existing Implementation |
| Issues | Backfilled Spec |
