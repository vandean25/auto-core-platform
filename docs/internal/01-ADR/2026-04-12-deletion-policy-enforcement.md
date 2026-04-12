---
title: "ADR-0005: Deletion Policy Enforcement"
date: "2026-04-12"
status: accepted
deciders: "Product Owner, Engineering Team"
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - adr
  - security
  - compliance
  - data-retention
---

# ADR-0005: Deletion Policy Enforcement

## Status

**Accepted** — 2026-04-12 (Retroactive documentation of existing system)

## Context

In complex ERP applications, cascading deletes or orphaned records can severely corrupt system state. For example, deleting a `Customer` who has existing `SalesOrders` would either aggressively delete their historical final invoices (illegal for accounting) or leave those invoices orphaned without an owner.

Furthermore, different entities require different deletion treatments. Some are safe to "hard delete" (e.g., a Draft document), some require "soft deleting" to maintain referential integrity, and some must be strictly protected from deletion. We needed a definitive and enforceable way to manage data lifecycle safely.

## Decision

We have established a centralized **Entity Deletion Policy**.

1. **Source of Truth:** All deletion rules are strictly documented in the master policy file: `docs/deletion-policy.md`. Any new entity added to the database *must* be immediately cataloged in this policy before the PR is merged.
2. **Backend Enforcement is Absolute:** The backend NestJS API is the sole enforcer of the deletion rules. A controller handling a `DELETE` request must implement guards checking for relation counts and constraints before executing the Prisma query.
3. **Types of Deletion Strategies:**

   | Strategy | Description | Example |
   |----------|-------------|---------|
   | **Forbidden** | No user-facing delete endpoint exists. The entity is immutable once created. | `InventoryTransaction`, finalized `Invoice`, `InvoiceSequence`, `FinanceSettings` |
   | **Blocked (Conditional)** | Hard delete is permitted only when specific relation counts are zero. If relations exist, deletion is rejected with a descriptive error. | `Customer` (blocked if SalesOrders > 0), `Vendor` (blocked if PurchaseOrders > 0), `Brand`, `RevenueGroup`, `LaborCategory` |
   | **Draft-Only** | Hard delete is permitted only when the entity is in `DRAFT` status *and* has produced no downstream effects (no received quantity, no linked invoices, no ledger entries). | `PurchaseOrder` (DRAFT only, no receipts), `SalesOrder` (DRAFT only, no linked Invoice) |
   | **Cascade Delete** | Safe to delete; exclusive child records are deleted with the parent. This is not a user-facing strategy — it describes how child entities behave when their parent is deleted via one of the strategies above. | Deleting a `SalesOrder` deletes its `SalesOrderItems`; deleting a `PurchaseOrder` deletes its `PurchaseOrderItems` |
   | **Soft Delete** | The entity is hidden from active use but retained in the database for historical referential integrity. Two mechanisms are used depending on the entity: | |
   | | • **`is_active = false`** — for master data that may be referenced by historical documents but should be hidden from future selection dropdowns. | `LaborOperation` |
   | | • **`deletedAt` timestamp** — for entities where a temporal soft-delete marker is more appropriate and where restoration may be needed. | `StorageLocation` |
   | **No Direct Delete** | Child entities that are exclusively managed by their parent's lifecycle. No standalone delete endpoint exists. | `SalesOrderItem`, `InvoiceItem`, `PurchaseOrderItem`, `PurchaseInvoiceLine` |

4. **Frontend UX Mirroring:** The frontend MUST NOT enforce deletion logic as a security measure, but it MUST mirror the logic for UX purposes. For example, if a `Vendor` has associated `PurchaseOrders`, the frontend should disable the Delete button and display a tooltip explaining why, rather than letting the user click it and receive a 400 error.

### Enforcement Layers

Deletion rules are enforced at two complementary layers:

| Layer | Mechanism | When to Use |
|-------|-----------|-------------|
| **Prisma Schema** | `@relation(onDelete: Restrict)` directive | Use as the database-level safety net for all foreign key relationships. Prevents accidental orphaning even if application logic has a bug. |
| **Application Logic** | Explicit relation-count checks in the NestJS service/controller before calling `prisma.entity.delete()` | Use for all user-facing delete endpoints. Provides descriptive error messages (e.g., "Cannot delete Customer: 3 Sales Orders exist") that the `onDelete: Restrict` database error would not convey. |

Both layers should always be present. The Prisma schema prevents corruption; the application logic provides UX.

### Real-Time Sync on Deletion

When an entity is hard-deleted, the Prisma `$extends` real-time extension (see ADR-0001) intercepts the `delete` / `deleteMany` operation and emits a `DELETED` WebSocket event. This causes the frontend to invalidate cached query data for the affected entity type, ensuring list views and dashboards reflect the removal immediately. No additional wiring is needed beyond what ADR-0001 already provides — any entity in `SUPPORTED_ENTITY_TYPES` gets deletion events automatically.

### Deletion Audit Trail

Currently, successful hard deletions of permitted entities are **not** logged to a persistent audit table. This is an acknowledged gap. For entities where deletion is rare and low-risk (e.g., removing a Draft PurchaseOrder), the absence of an audit log is acceptable for the current scale. However, if regulatory requirements expand or deletion volume increases, a dedicated `DeletionAuditLog` table (entity type, entity ID, deleted-by user, timestamp, reason) should be introduced. This is deferred as a future Feature Spec, not a blocker for the current policy.

## Consequences

### Positive

- **Referential Integrity:** Prevents orphaned records and data corruption across modules.
- **Compliance:** Ensures financial records remain intact.
- **Clear Developer Expectations:** `docs/deletion-policy.md` answers the "Can I delete this?" question definitively for AI agents and human developers.

### Negative

- **Increased Boilerplate:** Developers must write custom backend validation logic prior to calling `prisma.entity.delete()`.
- **Maintenance Overhead:** The `docs/deletion-policy.md` file must be meticulously maintained.

### Neutral

- Requires both Prisma schema-level `@relation(onDelete: Restrict)` directives and application-level relation-count checks. The schema layer is the safety net; the application layer provides actionable error messages. Both must be maintained in sync when relationships change.
- Hard deletions of entities in `SUPPORTED_ENTITY_TYPES` (ADR-0001) automatically emit `DELETED` WebSocket events. No additional wiring is needed, but developers must verify their entity is in the supported list if dashboard freshness after deletion matters.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Global Soft Delete for Everything | Data is never truly lost. Solves referential integrity easily. | Massive DB bloat over time. Complicates uniqueness constraints and every querying filter (must always check `is_deleted = false`). |
| DB-level Cascades universally | Easiest to implement. | Highly dangerous. Accidental deletion of a master record can wipe out thousands of historical transactions silently. |
| Prisma Middleware (Global Delete Interceptor) | Could centralize all deletion guards in one place, similar to the real-time sync extension pattern. | Prisma Middleware is officially deprecated in favor of `$extends`. Also, deletion rules are highly entity-specific (relation checks, status checks) — a generic interceptor would still need per-entity logic, providing little benefit over service-level guards. |
| Database-level Triggers (PostgreSQL `BEFORE DELETE`) | Enforcement at the lowest level; impossible to bypass from application code. | PostgreSQL-specific; harder to test in CI; error messages are opaque (raw Postgres exceptions vs structured HTTP responses); business logic scattered between app and DB layers. |

## References

- `docs/deletion-policy.md` — the authoritative policy matrix for all entities
- `agents.md` — "Deletion policy is law" architectural invariant (§5)
- ADR-0001: `2026-04-12-prisma-extends-realtime-sync.md` — governs the `DELETED` WebSocket event emission when entities are hard-deleted
- ADR-0003: `2026-04-12-fiscal-lock-date.md` — fiscal immutability is the primary motivation for the "Forbidden" strategy on `Invoice` and `InventoryTransaction`

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | N/A |
| Issues | N/A |
