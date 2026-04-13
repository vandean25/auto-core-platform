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
| `InventoryTransaction` | Immutable append-only ledger of stock movements. | The true source of stock levels. Tied to `TransactionType`. |

### Deletion Policy Impact

> Governed by `docs/deletion-policy.md`.
- `InventoryTransaction`: **Forbidden**. Under no circumstances can a transaction be deleted. Immutable audit trail.
- `InventoryStock`: **No**. Derived operational cache; managed by ledger operations.
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
