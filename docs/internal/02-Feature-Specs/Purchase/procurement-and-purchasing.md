---
title: "Procurement & Purchase Orders"
date: "2026-04-12"
module: "Purchase"
status: approved
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - feature-spec
  - purchase
  - procurement
---

# Procurement & Purchase Orders

## Summary

> The Procurement module (Purchase) manages the lifecycle of acquiring goods from external vendors. It tracks Purchase Orders (intent to buy), receives goods into the Inventory Ledger, and processes Purchase Invoices (vendor bills) for accounting. It ensures that inventory is never blindly increased without a traceable receipt.

---

## User Stories

- As a **Procurement Manager**, I want to **draft and send Purchase Orders** so that **I can establish a formal commitment with a vendor for required parts.**
- As a **Receiving Clerk**, I want to **log goods receipts against an open Purchase Order** so that **the system accurately adds the received items to my `InventoryStock` cache via the ledger.**
- As an **Accounts Payable Clerk**, I want to **create a Purchase Invoice from received items** so that **I can schedule payment to the vendor.**

---

## Database Impact

### Core Tables

| Table | Purpose | Key Constraints / Notes |
|-------|---------|-------------------------|
| `Vendor` | Master data for external suppliers. | Links to supported `Brands`. |
| `PurchaseOrder` | Header document representing an order. | Linked to a `Vendor`. Dictates overall `status`. |
| `PurchaseOrderItem` | Line item for an expected part. | Tracks `quantity`, `quantity_received`, and `quantity_invoiced`. Links to `CatalogItem`. |
| `PurchaseInvoice` | Vendor bill for received goods. | Linked to `Vendor`. |
| `PurchaseInvoiceLine`| Specific charges on a bill. | Optionally linked back to a `PurchaseOrderItem` to track billing completeness. |

### Deletion Policy Impact

> Governed by `docs/deletion-policy.md`.
- `Vendor`: **Blocked (Conditional)**. Cannot delete if tied to any `PurchaseOrder` or `PurchaseInvoice`.
- `PurchaseOrder`: **Draft-only**. Can be deleted only in `DRAFT` status (cascades to `PurchaseOrderItem`). Blocked if `status > DRAFT` or if any `quantity_received > 0`.
- `PurchaseOrderItem`: **No direct delete**. Managed by parent `PurchaseOrder` lifecycle.
- `PurchaseInvoice`: **Forbidden**. Finalized accounting documents cannot be deleted. Use status lifecycle (`DRAFT → POSTED → PAID`).
- `PurchaseInvoiceLine`: **No direct delete**. Managed by parent `PurchaseInvoice` lifecycle.

---

## State Machine & Transitions

### Purchase Order Status (`PurchaseOrderStatus`)
1. **`DRAFT`**: Being built. Not yet active.
2. **`SENT`**: Electronically transmitted or emailed to the vendor. Waiting for goods.
3. **`PARTIAL`**: Some, but not all, items have been received (i.e., `quantity_received < quantity`).
4. **`COMPLETED`**: All items received (`quantity_received >= quantity`). Order closed.

### Purchase Invoice Status (`PurchaseInvoiceStatus`)
1. **`DRAFT`**: Bill being manually keyed in.
2. **`POSTED`**: Locked and pushed to accounting/finance. Modifying requires a credit note.
3. **`PAID`**: Marking the payable cycle as complete.

*Invariant:* When moving from `DRAFT` to `POSTED`, the transaction date is checked against `FinanceSettings.lock_date`.

---

## UX Compliance

### Layout & Actions
- [x] Page-level actions (`+ Purchase Order`, `+ Purchase Invoice`) are **top-right aligned**.
- [x] Top-left reserved for breadcrumbs / title / vendor name.

### List Pages
- [x] Create button format: `+ Purchase Order`, `+ Vendor`.
- [x] Search bar searches across all visible columns (vendor name, PO number, status).
- [x] Sortable column headers via `DataTable` / `DataTableColumnHeader`.
- [x] Status cells use shared `StatusBadge` component.
- [x] Row click opens detail view.

### Form Handling
- [x] Complex documents like `PurchaseBillForm` require the **debounced auto-save (750 ms)** pattern (ADR-0006 Pattern 1).
- [x] Vendor inline edits (notes, contact info) use **save-on-blur** via `InlineEdit` (ADR-0006 Pattern 2).

### Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `PurchaseOrderList` | `src/pages/purchase/` | DataTable of all purchase orders. |
| `PurchaseOrderDetails` | `src/pages/purchase/` | PO editing with receiving workflow. |
| `PurchaseBillForm` | `src/pages/purchase/` | Purchase invoice creation with auto-save. |
| `VendorCombobox` | `src/components/purchase/` | Searchable vendor selector dropdown. |
| `VendorDialog` | `src/components/purchase/` | Quick-create vendor modal. |

### Real-Time Sync

- [x] `PurchaseOrder` mutations emit socket events (`PURCHASE_ORDER` in `SUPPORTED_ENTITY_TYPES`).
- [x] `PurchaseInvoice` mutations emit socket events (`PURCHASE_INVOICE` in `SUPPORTED_ENTITY_TYPES`).
- [x] `Vendor` mutations emit socket events (`VENDOR` in `SUPPORTED_ENTITY_TYPES`).
- [x] Frontend `dashboard-entity-map.ts` maps each to respective query key invalidation.

---

## Testing Plan

### Backend E2E

- [ ] Happy-path: Create PO → Add items → Send → Receive partial → Receive remaining → Verify status transitions (`DRAFT → SENT → PARTIAL → COMPLETED`).
- [ ] Each receipt creates a `RECEIPT`-type `InventoryTransaction` and increments stock.
- [ ] Cannot delete PO outside `DRAFT` status.
- [ ] PurchaseInvoice `DRAFT → POSTED` validates against fiscal lock date (ADR-0003).
- [ ] PurchaseInvoice line items snapshot `unit_cost` and `item_name` (ADR-0004).

### Frontend

- [ ] Visual QA: PO list, receiving workflow, purchase bill auto-save.
- [ ] StatusBadge renders correctly for all PO and PI statuses.

---

## Open Questions

1. Should a `PurchaseOrder` support partial invoicing (some items invoiced, others not)?
2. Is a goods return (return-to-vendor) workflow needed?

---

## References

- ADR-0002: Ledger-Based Inventory — `RECEIPT`-type transactions for goods receipt
- ADR-0003: Fiscal Lock Date — `PurchaseInvoice.invoice_date` validated on `DRAFT → POSTED`
- ADR-0004: Invoice Snapshotting — `PurchaseInvoiceLine` snapshots `unit_cost` and `item_name`
- ADR-0005: Deletion Policy — Draft-only for PO, Forbidden for PurchaseInvoice
- ADR-0006: Form Auto-Save — debounced auto-save for PurchaseBillForm
- ADR-0011: Atomic Status Transition Guards — PO and PurchaseInvoice status transitions use the `updateMany` guard pattern

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | None (Retroactive Documentation) |
| Milestone | Existing Implementation |
| Issues | Backfilled Spec |
