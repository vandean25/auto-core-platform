---
title: "Inventory & Catalog Management"
date: "2026-04-12"
module: "Inventory"
status: approved
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - feature-spec
  - inventory
  - ledger
---

# Inventory & Catalog Management

## Summary

> The Inventory & Catalog module acts as the central hub for parts management. It separates product definitions (`CatalogItem`) from physical stock tracking (`InventoryStock` and `StorageLocation`). To ensure strict audibility, all stock movements are managed through an append-only ledger system (`InventoryTransaction`).

---

## User Stories

- As a **Parts Manager**, I want to **define a centralized catalog of items** so that **I can maintain consistent pricing, SKUs, and brand definitions across all sales and repairs.**
- As an **Inventory Clerk**, I want to **adjust stock levels using a transaction ledger** so that **every physical change to inventory is tied to a reason, user, or source document.**
- As a **Salesperson**, I want to **view available `quantity_on_hand`** so that **I don't sell parts the shop doesn't physically possess.**

---

## Database Impact

### Core Tables

| Table | Purpose | Key Constraints / Notes |
|-------|---------|-------------------------|
| `CatalogItem` | Master definition of a salable/usable part. | Contains pricing, linked generic `Brand`, and `supersession` chains. |
| `StorageLocation` | Physical or logical place where items live. | Supports a hierarchy (`parent_id`). |
| `InventoryStock` | Materialized cache of stock levels. | Unique constraint on `[catalog_item_id, location_id]`. |
| `InventoryTransaction` | Immutable append-only ledger of stock movements. | The true source of stock levels. Tied to `TransactionType`. `cost_basis` is stored with 4 decimal places (`Decimal(12, 4)`). Manual `ADJUSTMENT` bookings require `reason` (`StockAdjustmentReason`), `value_source` (`AVG` \| `LAST_EK` \| `MANUAL`), `created_by_user_id`, and are reversed only via `reversal_of_transaction_id` (Gegenbuchung). |
| `InventoryValuation` | Per-legal-entity moving-average unit cost (`gleitender Durchschnitt`) and valued quantity per article. | Unique constraint on `[tenant_id, legal_entity_id, catalog_item_id]`. Updated in the same DB transaction as `InventoryTransaction` with row locking. |

### Legacy unvalued corrections (AUT-1050, nachbewertet)

Manual `ADJUSTMENT` rows from before AUT-1048 can have `cost_basis = null`. They are revalued by `POST /api/inventory/revalue-unvalued-adjustments` (`{ "dryRun": true | false }`, permission `stock.adjust`, OWNER/ADMIN, tenant and authorized sites only). The original row is never updated.

- **Candidates:** `type = ADJUSTMENT`, `reference_id = 'manual-adjustment'`, `cost_basis = null`, not a reversal, not yet reversed.
- **Pair per original, dated now:** a Gegenbuchung (`reference_id = 'manual-adjustment-reversal'`, `reversal_of_transaction_id` = original, opposite quantity, `cost_basis = null`) plus a new valued `ADJUSTMENT` (`reference_id = 'manual-adjustment-revaluation'`, same quantity as the original). Both rows carry `note = 'nachbewertet'`, `created_by_user_id = null` and one shared `movement_group_id`. Net quantity on hand is unchanged; Lagerwert moves only by the new valued row. The Gegenbuchung keeps the null cost and only undoes what the original did to the moving-average pool: unwinding an unvalued inbound changes nothing (it never entered the pool); unwinding an unvalued outbound puts its quantity back at the current average (it already left the pool), so the new valued row removes it once. When the unit cost equals the current average, `valued_quantity` and `average_unit_cost` end unchanged. The valuation backfill recognises the Gegenbuchung by `note = 'nachbewertet'` + `reversal_of_transaction_id` + `cost_basis = null`, so a replay ends at the same pool.
- **Unit cost:** AUT-1048 order: current `InventoryValuation.average_unit_cost` of the location's legal entity (`AVG`), else `InventoryValuationService.resolveLastEk` (`LAST_EK`). No value: the original is listed under `gaps` and nothing is booked.
- **Idempotent:** an original reversed by a `nachbewertet` Gegenbuchung is reported as `alreadyRevalued`, any other reversal as `alreadyReversed`; neither is booked again. The unique `(tenant_id, reversal_of_transaction_id)` blocks a concurrent second pair.
- **Batches:** 100 originals per database transaction. A failure rolls back its whole batch (no partial pair); batches committed before it stay complete and are skipped on the next run.
- **Audit:** one `AuditLog` per pair, `actor_type = MIGRATION`, `source = 'inventory.adjustment_revaluation'`.
- **Periods:** the new rows are dated at run time, never back-dated into an exported period.
- **Execution:** QA only. Production needs Dejan's explicit OK first; see [the runbook](../../05-Runbooks/aut-1050-revalue-unvalued-adjustments-runbook.md).

### Deletion Policy Impact

> Governed by `docs/deletion-policy.md`.
- `InventoryTransaction`: **Forbidden**. Under no circumstances can a transaction be updated or deleted (enforced by DB trigger `inventory_transactions_immutable`; exceeds 7-year minimum in BAO § 132 / UGB § 212). Adjustments are reversed only by a counter-booking (`POST /api/inventory/transactions/:transactionId/reverse`).
- `InventoryStock`: **No**. Derived operational cache; managed by ledger operations.
- `InventoryValuation`: **No**. Derived per-legal-entity valuation state; managed atomically by ledger operations.
- `CatalogItem`: **No (current API)**. Inventory ledger and historical documents depend on item identity. Use supersession/inactive approach.
- `StorageLocation`: **Conditional (soft delete)**. Allow only when no child locations and no stock exists. Soft-delete via `deletedAt` timestamp.

---

## State Machine & Transitions

Inventory uses a `TransactionType` enum to classify mutations (authoritative list from ADR-0002):

| TransactionType | Signed Qty | Description |
|----------------|-----------|-------------|
| `RECEIPT` | + | Goods received against a `PurchaseOrderItem` |
| `SALE` | − | Stock deducted when a `SalesOrder` transitions to `INVOICED` |
| `ADJUSTMENT` | +/− | Manual correction (cycle counts, shrinkage, write-offs) |
| `TRANSFER_OUT` | − | Stock moved out of a source `StorageLocation` |
| `TRANSFER_IN` | + | Stock moved into a destination `StorageLocation` |
| `RETURN` | + | Customer returns goods to stock |
| `WORKSHOP_CONSUMPTION` | − | Parts consumed by a `WorkshopTask` |

**Multi-location transfers** use paired `TRANSFER_OUT` + `TRANSFER_IN` transactions in a single atomic `prisma.$transaction`. Stock is never "in transit" at the database level.

**Negative stock** is allowed. A negative `quantity_on_hand` signals the procurement team to investigate, rather than blocking real-world operations (see ADR-0002 §4).

*Invariant:* Developers cannot mutate `InventoryStock.quantity_on_hand` directly. They must use the backend `ledger.service.ts` to post a transaction, which atomically creates the `InventoryTransaction` and updates the cache within a `prisma.$transaction`.

---

## UX Compliance

### Layout & Actions
- [x] Page-level actions (`+ Catalog Item`, `+ Location`) are **top-right aligned**.
- [x] Top-left reserved for breadcrumbs.

### List Pages
- [x] Catalog List includes global search spanning SKU, name, and brand.
- [x] Inventory Ledger page is strictly read-only, showing a chronological feed of transactions.

### Real-Time Sync
- [x] `CatalogItem` mutations emit socket events (entity type `CATALOG_ITEM` in ADR-0001's `SUPPORTED_ENTITY_TYPES`).
- [x] Frontend `dashboard-entity-map.ts` maps `CATALOG_ITEM` → `['dashboard-widget-data', 'inventory']`.

> Note: `InventoryStock` is not a directly supported real-time entity. Stock changes are reflected through `CatalogItem` query invalidation, since stock data is fetched alongside catalog item details.

---

## Testing Plan

### Backend E2E

- [ ] Happy-path: Create CatalogItem → Receive stock via PO receipt (`RECEIPT`) → Verify `quantity_on_hand` increment.
- [ ] `SALE` transaction decrements stock correctly.
- [ ] `ADJUSTMENT` can add or subtract stock.
- [ ] `TRANSFER_OUT` + `TRANSFER_IN` pair executes atomically.
- [ ] Negative stock is allowed (not rejected).
- [ ] Direct `InventoryStock.quantity_on_hand` mutation is blocked by service architecture.
- [ ] Fiscal lock date validation on `InventoryTransaction.transaction_date`.

### Frontend

- [ ] Visual QA: Catalog list search across SKU/name/brand, ledger chronological view.
- [ ] Stock quantity updates reflect after WebSocket event.

---

## Open Questions

1. Should `INITIAL_BALANCE` be a supported `TransactionType` for system setup / data migration, or is `ADJUSTMENT` sufficient?
2. Is an archival strategy needed for the `InventoryTransaction` table at current data volumes?

---

## References

- ADR-0002: Ledger-Based Inventory — authoritative TransactionType taxonomy and eager cache model
- ADR-0003: Fiscal Lock Date — `InventoryTransaction.transaction_date` is validated against the lock date
- ADR-0005: Deletion Policy — `InventoryTransaction` is Forbidden, `InventoryStock` is No, `CatalogItem` is No (current API)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | None (Retroactive Documentation) |
| Milestone | Existing Implementation |
| Issues | Backfilled Spec |
