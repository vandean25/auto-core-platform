---
title: "ADR-0002: Ledger-Based Inventory System"
date: "2026-04-12"
status: accepted
deciders: "Product Owner, Engineering Team"
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - adr
  - inventory
  - ledger
---

# ADR-0002: Ledger-Based Inventory System

## Status

**Accepted** — 2026-04-12 (Retroactive documentation of existing system)

## Context

Inventory management systems often fall into the trap of managing abstract "stock quantities" directly (e.g., `UPDATE inventory SET quantity = 10`). This simple approach fails at scale because it lacks traceability. When stock discrepancies occur, it is impossible to determine *why* or *how* a quantity changed if only the final number is stored.

Auto Core Platform requires an auditable trail of all stock movements for accounting, loss prevention, and historical reporting. We needed an inventory architecture that acts more like a financial ledger than a simple key-value store.

## Decision

We have implemented an **append-only, Ledger-Based Inventory architecture**.

### 1. `InventoryTransaction` as the Source of Truth

Every change in stock is recorded as an immutable `InventoryTransaction`. A transaction includes:
- The `CatalogItem` involved.
- The `StorageLocation`.
- The `TransactionType` (see taxonomy below).
- A signed `quantity` (positive for additions, negative for deductions).
- Links to source documents (e.g., Purchase Order ID, Sales Order ID).

**Transaction Type Taxonomy:**

| TransactionType | Signed Qty | Trigger | Source Document |
|----------------|-----------|---------|-----------------|
| `RECEIPT` | + | Goods received against a Purchase Order | `PurchaseOrder` |
| `SALE` | − | Stock deducted when a SalesOrder transitions to `INVOICED` | `SalesOrder` / `Invoice` |
| `ADJUSTMENT` | +/− | Manual stock correction (e.g., physical count reconciliation) | None (manual entry with reason) |
| `TRANSFER_OUT` | − | Stock moved out of a source location | `InventoryTransfer` (paired with `TRANSFER_IN`) |
| `TRANSFER_IN` | + | Stock moved into a destination location | `InventoryTransfer` (paired with `TRANSFER_OUT`) |
| `RETURN` | + | Customer returns goods to stock | `SalesOrder` / return workflow |
| `WORKSHOP_CONSUMPTION` | − | Parts consumed by a WorkshopTask | `WorkshopOrder` |

> Any new `TransactionType` must be added to the Prisma enum, documented in this table, and handled in `ledger.service.ts` before use.

**Whole vehicles are out of scope for this ledger.** Dealer-owned cars use `VehicleLedgerEntry` (ADR-0016). Do not add a VIN to `CatalogItem` or post vehicle purchases/sales as `InventoryTransaction` rows.

### 2. Derived Stock Quantities (Eager Cache Model)

The `InventoryStock` table, which holds `quantity_on_hand` per item per location, is treated as a **materialized cache**. It is not computed on-the-fly via SUM but is **eagerly updated** (incremented or decremented by the transaction's signed quantity) inside the same `prisma.$transaction` block that creates the `InventoryTransaction` record.

```
// Conceptual flow inside a single prisma.$transaction:
// 1. Create InventoryTransaction { quantity: -2, type: SALE }
// 2. Update InventoryStock { quantity_on_hand: { decrement: 2 } }
```

This eager model provides O(1) stock lookups for UI rendering and API responses, while the ledger remains the authoritative audit trail. If the cache ever drifts (e.g., due to a bug), `quantity_on_hand` can be recalculated by summing all `InventoryTransaction` records for that item/location.

### 3. No Direct Mutation

Developers and AI Agents are strictly forbidden from writing code that directly updates the `quantity_on_hand` in the `InventoryStock` table. All stock modifications **must** be executed by creating an `InventoryTransaction`, letting the backend architecture (via `ledger.service.ts`) handle the corresponding cache update inside a transaction block.

### 4. Negative Stock Policy

The system currently **allows negative stock** (`quantity_on_hand < 0`). This is a deliberate business decision for the automotive parts context:

- A workshop may consume a part before the corresponding Purchase Order receipt is logged.
- Rejecting the sale or workshop operation due to a stock timing discrepancy would block real-world work.
- Negative stock is treated as a signal for the procurement team to investigate, not as a hard error.

> ⚠️ **Future consideration:** If negative stock abuse becomes a problem, a configurable per-location or per-item "allow negative" flag can be introduced. This is deferred — not a current requirement.

### 5. Multi-Location Transfers

Transferring stock between `StorageLocation`s is modeled as **two paired transactions** in a single atomic `prisma.$transaction`:

1. A `TRANSFER_OUT` transaction with a negative quantity at the source location.
2. A `TRANSFER_IN` transaction with a positive quantity at the destination location.

Both transactions share a common reference (transfer ID or batch ID) for audit traceability. If either write fails, the entire transaction rolls back — stock is never "in transit" at the database level.

### 6. Integration with Goods Receipt

The Purchase Order goods receipt flow is the primary mechanism for stock entering the system. When a `PurchaseOrder` item is marked as received (partially or fully), the `purchase.service.ts` creates a `RECEIPT`-type `InventoryTransaction` through `ledger.service.ts`. This is the only way to add purchased stock — there is no direct "add stock" API that bypasses the PO receipt flow (manual additions use `ADJUSTMENT` type instead).

## Consequences

### Positive

- **Full Auditability:** We can answer exactly *when*, *why*, and *by whom* an item's stock level changed.
- **Financial Reconciliation:** Inventory valuation reports can be generated retroactively for any given date by summing transactions up to that point.
- **Concurrency Safety:** Append-only ledger entries avoid update conflicts on the transaction table itself. The `InventoryStock` cache row does require serialized access (via `prisma.$transaction` with an atomic `decrement`/`increment`), but contention is limited to the single cache row per item/location — read-heavy operations (stock lookups, list views) are never blocked.

### Negative

- **Increased Complexity:** Simple stock adjustments require creating a transaction record rather than a simple UPDATE command.
- **Storage Growth:** The `InventoryTransaction` table will grow infinitely over time, potentially requiring archival strategies in the distant future.

### Neutral

- Requires strict developer discipline to never bypass the ledger service. The automated governance agent (ADR-0008) assists by flagging direct `InventoryStock` mutations in code review.
- The eager cache model means `quantity_on_hand` is only eventually consistent if a transaction fails between the ledger write and the cache update — but since both happen inside a single `prisma.$transaction`, this scenario only occurs on full database failures.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Direct `UPDATE` of Stock Quantities | Simplest to implement, fast to develop. | No audit trail, impossible to answer "what happened to the 5 missing spark plugs?" |
| State-Snapshotting | Simple to query historical stock levels on specific dates. | Doesn't explain the transitions between states. Storage heavy if snapshotted frequently without changes. |
| Event Sourcing (full event stream) | Complete system-wide traceability beyond just inventory. Can replay and project any point-in-time state. | Massive infrastructure complexity (event store, projections, snapshots). Over-engineered — we only need inventory auditability, not full system replay. |
| Double-Entry Bookkeeping (debit/credit model) | Standard accounting pattern; natural fit for financial systems. Every transaction balances. | Adds conceptual overhead for a parts inventory system that isn't a general ledger. Requires a chart of accounts abstraction. Better suited for the Finance module than the Inventory module. |

## References

- `apps/core-api/prisma/schema.prisma` (`InventoryTransaction`, `InventoryStock` models, `TransactionType` enum)
- `apps/core-api/src/inventory/ledger.service.ts`
- ADR-0003: `2026-04-12-fiscal-lock-date.md` — `InventoryTransaction.transaction_date` is validated against the fiscal lock date; transactions in closed periods are rejected
- ADR-0004: `2026-04-12-invoice-snapshotting.md` — SALE-type ledger entries are created in the same atomic transaction as invoice line snapshots during the `COMPLETED → INVOICED` transition
- ADR-0005: `2026-04-12-deletion-policy-enforcement.md` — `InventoryTransaction` has a "Forbidden" deletion policy (immutable audit trail); `InventoryStock` has a "No" deletion policy (derived cache)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | N/A |
| Issues | N/A |
