---
title: "ADR-0004: Invoice Snapshotting Policy"
date: "2026-04-12"
status: accepted
deciders: "Product Owner, Architecture Team"
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - adr
  - sales
  - invoice
  - immutability
---

# ADR-0004: Invoice Snapshotting Policy

## Status

**Accepted** — 2026-04-12 (Retroactive documentation of existing system)

## Context

When generating a Sales Invoice or processing a Purchase Bill, the items on that document often refer to master data entities (e.g., `CatalogItem`, `RevenueGroup`, `LaborOperation`). 

If an invoice line merely holds a `catalog_item_id` foreign key, any future updates to the master data (like changing the item's name, increasing its retail price, or recategorizing its revenue group) would cascade and retroactively alter the historical invoice. This violates accounting principles where an invoice must represent the exact agreement at the exact time of the transaction.

## Decision

We have adopted a strict **Snapshotting Policy for Invoices**.

### 1. Snapshot on Creation

Snapshotting occurs at a specific, well-defined moment for each document type:

| Document Path | Trigger | Snapshot Source |
|--------------|---------|-----------------|
| **Sales Invoice** | `SalesOrder` status transitions from `COMPLETED` → `INVOICED`, which creates the `Invoice` entity and its `InvoiceItem` lines in a single atomic transaction. | `SalesOrderItem` fields (which themselves reference `CatalogItem` and `RevenueGroup`) |
| **Workshop Invoice** | `WorkshopOrder` status transitions from `COMPLETED` → `INVOICED`. The workshop invoice snapshots both parts (from `WorkshopTaskLineItem`) and labor (from `LaborOperation`). | `WorkshopTaskLineItem` and `LaborOperation` fields |
| **Purchase Invoice** | `PurchaseInvoice` is created manually against a `PurchaseOrder`. Snapshotting occurs when `PurchaseInvoiceLine` records are created. | `PurchaseOrderItem` fields (which reference `CatalogItem`) |
| **Vehicle Sale Invoice** | `VehicleSale` status transitions from `DRAFT` → `INVOICED` (ADR-0016). Creates `Invoice` with `tax_mode = MARGIN_SCHEME` (phase A) and `vehicle_sale_id`. | Vehicle identity (make/model/year/VIN), `sale_price`, frozen `cost_basis_snapshot` / `margin_vat_snapshot` |

> **Note:** Invoices are never created independently of a source document (SalesOrder, WorkshopOrder, PurchaseOrder, or VehicleSale). There is no "direct creation" path that bypasses a parent document.

**Amendment 2026-08-15 (ADR-0016):** Used-vehicle sales reuse `Invoice` rather than a second invoice engine. `Invoice.tax_mode` distinguishes standard VAT from Differenzbesteuerung. Margin VAT is computed from the vehicle ledger cost basis, not from line `unit_price * tax_rate`. PDF rendering must read `tax_mode` and must not recompute tax from live master data.

### 2. Key Snapshotted Fields

**Sales and Workshop Invoices (`InvoiceItem`):**

| Field | Source | Purpose |
|-------|--------|---------|
| `unit_price` | Agreed price at the time of sale | Financial record integrity |
| `item_name` / `description` | Name of the product or service sold | Human-readable invoice rendering |
| `revenue_group_name` | Accounting category at the time of sale | Historical accounting exports and revenue reporting |

**Purchase Invoices (`PurchaseInvoiceLine`):**

| Field | Source | Purpose |
|-------|--------|---------|
| `unit_cost` | Negotiated cost from the PurchaseOrderItem | Cost accounting integrity |
| `item_name` / `description` | Name of the received product | Human-readable bill rendering |

> Purchase invoices do not snapshot `revenue_group_name` because revenue categorization is a sales-side concern, not a procurement concern.

### 3. Immutability of Finalized Invoices

Once an `Invoice` is assigned a permanent sequential number (e.g., `RE-2026-0001`) and leaves the `DRAFT` status, the document and all its line items become **strictly immutable**:

- Backend APIs must block all `UPDATE` operations on finalized invoices and their line items.
- The same immutability applies to `PurchaseInvoice` after it transitions from `DRAFT` to `POSTED`.
- Reversal must happen via a cancellation workflow (status transition to `CANCELLED`), never by editing the finalized snapshot.

> ⚠️ **Credit notes / cancellation workflow:** A formal credit note mechanism does not yet exist. Currently, the only reversal path is full invoice cancellation. A credit note Feature Spec should be created when partial reversals are needed. Until then, an incorrect invoice must be cancelled entirely and a corrected invoice issued.

### 4. Decoupling from Master Data

The foreign key to the original `CatalogItem` or `LaborOperation` may be retained for analytical purposes (e.g., "how many times was part X sold?"), but **invoice rendering and financial reporting logic must always read from the snapshotted fields on the invoice line itself**.

**Anti-pattern — do NOT do this:**
```
// ❌ WRONG: Reading live master data for an invoice
const item = await prisma.catalogItem.findUnique({ where: { id: invoiceLine.catalog_item_id } });
return { name: item.name, price: item.retail_price };

// ✅ CORRECT: Reading from the snapshot
return { name: invoiceLine.item_name, price: invoiceLine.unit_price };
```

If code reads from the live `CatalogItem` instead of the snapshot, price changes or product renames will retroactively corrupt historical invoices.

## Consequences

### Positive

- **Accounting Integrity:** Historical invoices will never change, even if prices are updated or products are renamed.
- **Accurate Reporting:** Revenue grouped by category remains accurate for the month it was booked, even if the item's default revenue group is changed later.

### Negative

- **Data Duplication:** We store the item name and price redundantly. This is an intended consequence for record retention.
- **Migration Complexity:** If an accounting mistake is caught after an invoice is finalized, it requires a formal void/credit process rather than a simple edit.

### Neutral

- Requires careful mapping in the backend service when converting an order (which might be dynamic) into an invoice (which is static). Each new snapshotted field added to a source entity must be mirrored to the corresponding invoice line schema and service.
- Workshop invoices snapshot from two sources (parts + labor), making the mapping more complex than sales invoices which draw from a single `SalesOrderItem` source.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Temporal Tables (History Tables) | Single source of truth. | Complex to query point-in-time state for every invoice rendering. Slow joins. Requires all master data tables to maintain history, even those that change rarely. |
| Deep Document Embedding (JSONB) | Isolates the whole document structure easily. | Harder to query across invoices for specific revenue group rollups or individual part sales. No relational integrity on embedded data. |
| Event Sourcing (reconstruct state from events) | Full traceability of every state change. Can reconstruct any point-in-time view. | Extreme implementation complexity. Requires a projection layer to materialize current state. Over-engineered for the specific problem of invoice immutability. |
| Versioned Master Data (version_id on invoice lines) | Less duplication — invoice lines reference a specific version of CatalogItem rather than copying fields. | Requires versioning infrastructure on every master data table. Adds FK complexity. Query performance degrades as version chains grow. |

## References

- `apps/core-api/prisma/schema.prisma` (`InvoiceItem`, `PurchaseInvoiceLine` snapshot fields)
- `agents.md` — Architectural Invariants §2 ("Invoices are immutable after finalization")
- ADR-0002: `2026-04-12-ledger-based-inventory.md` — SALE-type `InventoryTransaction` ledger entries are created in the same atomic transaction as invoice snapshots during the `COMPLETED → INVOICED` transition
- ADR-0003: `2026-04-12-fiscal-lock-date.md` — the fiscal lock date prevents creation of invoices with dates in closed periods, protecting the temporal integrity of snapshots
- ADR-0005: `2026-04-12-deletion-policy-enforcement.md` — the "Forbidden" deletion strategy for finalized invoices directly preserves snapshot immutability
- ADR-0009: `2026-04-12-sequential-document-numbering.md` — the sequential number is assigned in the same atomic transition that triggers snapshotting (`DRAFT → FINALIZED`)
- ADR-0011: `2026-04-12-atomic-status-transition-guards.md` — the `updateMany` guard ensures snapshot-triggering transitions are race-condition-safe

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | N/A |
| Issues | N/A |
