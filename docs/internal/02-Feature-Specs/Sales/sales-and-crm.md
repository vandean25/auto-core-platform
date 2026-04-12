---
title: "Sales & CRM Workflows"
date: "2026-04-12"
module: "Sales"
status: approved
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - feature-spec
  - sales
  - crm
---

# Sales & CRM Workflows

## Summary

> The Sales module manages Customer relationships (CRM), physical vehicle registries, and outbound order workflows. It encompasses the entire journey from quoting a customer (`SalesOrder`) to finalizing the transaction and locking the financial record (`Invoice`). It strictly relies on the architectural invariants of Invoice Snapshotting and Ledger Deductions.

---

## User Stories

- As a **Service Advisor**, I want to **maintain a database of customers and their vehicles** so that **I have a complete history of all interactions, orders, and repairs for a specific license plate.**
- As a **Parts Salesperson**, I want to **draft a Sales Order for counter-sales** so that **I can gather parts for a customer before billing them.**
- As an **Accountant**, I want to **finalize Invoices** so that **the revenue is snapshotted, locked against the fiscal date, and ready for end-of-month reporting.**

---

## Database Impact

### Core Tables

| Table | Purpose | Key Constraints / Notes |
|-------|---------|-------------------------|
| `Customer` | Individual or Company profile. | Base entity for a CRM. Tied to all downstream docs. |
| `Vehicle` | A specific physical vehicle (VIN). | Belongs to a Customer. Tied to Workshop Orders and Sales Orders. |
| `SalesOrder` | Pre-invoice commitment. | Controls fulfillment status. |
| `SalesOrderItem`| Expected goods to deliver. | Ties to `CatalogItem`. |
| `Invoice` | Final financial document. | Generates a sequential `invoice_number` from `InvoiceSequence` table upon finalization. |
| `InvoiceItem` | Snapshotted line item. | Stores `unit_price`, `item_name`, and `revenue_group_name` redundantly for immutability. |

### Deletion Policy Impact

> Governed by `docs/deletion-policy.md`.
- `Customer`: **Blocked (Conditional)**. Cannot delete if any `SalesOrder`, `Invoice`, `WorkshopOrder`, or linked `Vehicle` exists.
- `Vehicle`: **Conditional (future)**. Should be blocked if linked to orders/invoices/workshop records.
- `SalesOrder`: **Draft-only**. Can be deleted only in `DRAFT` status and only when no linked `Invoice` exists. Cascades to `SalesOrderItem`.
- `Invoice`: **Forbidden**. Under no circumstances can a finalized invoice be deleted. Must use cancellation workflow.
- `InvoiceItem`: **No direct delete**. Managed by parent `Invoice` lifecycle.
- `SalesOrderItem`: **No direct delete**. Managed by parent `SalesOrder` lifecycle.

---

## State Machine & Transitions

### Sales Order Status (`SalesOrderStatus`)
1. **`DRAFT`**: Document is being actively populated.
2. **`CONFIRMED`**: Customer agreed to the quote.
3. **`IN_PROGRESS`**: Goods are being picked.
4. **`COMPLETED`**: Goods handed over. `SALE`-type `InventoryTransaction` entries hit the ledger (ADR-0002).
5. **`INVOICED`**: An `Invoice` has been generated from this order. Closed.

### Invoice Status (`InvoiceStatus`)
1. **`DRAFT`**: Being built (often automatically created from a SalesOrder or WorkshopOrder during the `COMPLETED → INVOICED` transition).
2. **`FINALIZED`**: The crucial boundary. Document is snapshotted (ADR-0004), assigned a sequential number from `InvoiceSequence`, validated against the fiscal lock date (ADR-0003), and frozen. All `UPDATE` operations are blocked from this point forward.
3. **`ISSUED`**: PDF generated and sent to the customer (ADR-0007).
4. **`PAID`**: Payment received. Marks the receivable cycle as complete.
5. **`CANCELLED`**: Reversal. The only mechanism for correcting a finalized invoice. A credit note mechanism does not yet exist (see ADR-0004 §3).

> **Note on `FINALIZED`:** This status name is used within the Invoice's own lifecycle. It is distinct from the SalesOrder's `INVOICED` status, which indicates the parent order has produced an invoice. The SalesOrder transitions to `INVOICED` when the Invoice is created; the Invoice then progresses through its own `DRAFT → FINALIZED → ISSUED → PAID` lifecycle independently.

---

## Technical Invariants

### Sequential Numbering
When generating an `Invoice` (moving from `DRAFT` to `FINALIZED`), the backend must atomically increment the `InvoiceSequence` for the current year. This ensures no gaps in European/strict accounting environments (e.g., `RE-2026-1024`). Sales Orders also use sequential numbering (`SO-2026-XXXX`) from `FinanceSettings` counters.

### Inventory Deductions
Finalizing a Sales Order (transitioning to `COMPLETED`) issues a command to `ledger.service.ts` to deduct `quantity_on_hand` by creating a `SALE`-type `InventoryTransaction` (ADR-0002). A developer must never manually decrement stock in the sales controller.

---

## UX Compliance

### Layout & Actions
- [ ] Page-level actions (`+ Sales Order`, `Create Invoice`, `Print`) are **top-right aligned**.
- [ ] Top-left reserved for breadcrumbs / title / customer name / badges.
- [ ] Uses `text-2xl font-semibold tracking-tight` for page header.
- [ ] Subtitle uses `text-slate-500`.

### List Pages
- [ ] Create button format: `+ Sales Order`, `+ Customer`.
- [ ] Search bar searches across all visible columns (customer name, order number, status, date).
- [ ] Sortable column headers via `DataTable` / `DataTableColumnHeader`.
- [ ] Status cells use shared `StatusBadge` component.
- [ ] Row click opens detail view.
- [ ] Right-click row → contextual Delete for `SalesOrder` (Draft only) and `Customer` (if no relations).

### Form Handling
- [ ] SalesOrder create/edit uses **debounced auto-save (750 ms)** with Saving/Saved indicator (ADR-0006 Pattern 1).
- [ ] Customer detail sidebar fields (notes, contact info) use **save-on-blur** via `InlineEdit` (ADR-0006 Pattern 2).

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `CustomerList` | `src/pages/customers/` | DataTable of all customers with search and sort. |
| `CustomerDetails` | `src/pages/customers/` | Customer profile with vehicles, order history, invoice history. |
| `SalesOrderList` | `src/pages/sales/` | DataTable of all sales orders. |
| `SalesOrderDetails` | `src/pages/sales/` | Order editing page with auto-save. |
| `InvoiceList` | `src/pages/invoices/` | DataTable of all invoices. |
| `InvoiceDetails` | `src/pages/invoices/` | Read-only finalized invoice view with PDF download. |

---

## Real-Time Sync

- [ ] `SalesOrder` mutations emit socket events (`SALES_ORDER` in `SUPPORTED_ENTITY_TYPES`).
- [ ] `Customer` mutations emit socket events (`CUSTOMER` in `SUPPORTED_ENTITY_TYPES`).
- [ ] `Vehicle` mutations emit socket events (`VEHICLE` in `SUPPORTED_ENTITY_TYPES`).
- [ ] Frontend `dashboard-entity-map.ts` maps each entity to its query key invalidation.

---

## Testing Plan

### Backend E2E

- [ ] Happy-path: Create Customer → Create SalesOrder → Add items → Confirm → Complete (verify `SALE` ledger entry) → Invoice → Finalize (verify snapshot, sequential number, lock date check).
- [ ] Cannot delete Customer with existing SalesOrders.
- [ ] Cannot delete SalesOrder outside `DRAFT` status.
- [ ] Cannot `UPDATE` a finalized Invoice.
- [ ] Fiscal lock date rejects backdated invoice finalization.
- [ ] Sequential numbering increments atomically with no gaps.

### Frontend

- [ ] Visual QA: Customer list, SalesOrder auto-save, Invoice read-only view.
- [ ] StatusBadge renders correctly for all SalesOrder and Invoice statuses.

---

## Open Questions

1. Should the Invoice `FINALIZED` → `ISSUED` transition be automatic upon PDF generation completing, or manual?
2. Is a partial invoicing workflow needed (invoice some order items, leave others)?
3. Should `CANCELLED` invoices retain their sequential number in the sequence (no reuse)?

---

## References

- ADR-0002: Ledger-Based Inventory — `SALE`-type transactions for stock deduction
- ADR-0003: Fiscal Lock Date — invoice date validated on `DRAFT → FINALIZED`
- ADR-0004: Invoice Snapshotting — `InvoiceItem` fields snapshotted from `SalesOrderItem`
- ADR-0005: Deletion Policy — Draft-only deletion for SalesOrder, Forbidden for Invoice
- ADR-0006: Form Auto-Save — debounced auto-save for SalesOrder editing
- ADR-0007: Async PDF Pipeline — Invoice PDF generation on `FINALIZED → ISSUED`
- ADR-0009: Sequential Document Numbering — `SO-2026-XXXX` assigned at `DRAFT → CONFIRMED`; invoice `RE-2026-XXXX` at `DRAFT → FINALIZED`
- ADR-0011: Atomic Status Transition Guards — all SalesOrder and Invoice status transitions use the `updateMany` guard pattern

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | None (Retroactive Documentation) |
| Milestone | Existing Implementation |
| Issues | Backfilled Spec |
