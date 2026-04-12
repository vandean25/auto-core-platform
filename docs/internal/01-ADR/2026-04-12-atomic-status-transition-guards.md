---
title: "ADR-0011: Atomic Status Transition Guards"
date: "2026-04-12"
status: accepted
deciders: "Product Owner, Engineering Team"
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - adr
  - concurrency
  - state-machines
  - database
---

# ADR-0011: Atomic Status Transition Guards

## Status

**Accepted** — 2026-04-12 (Retroactive documentation of existing system)

## Context

Auto Core Platform has multiple entities with strict status workflows — Sales Orders, Workshop Orders, Invoices, Purchase Orders, and Purchase Invoices. Each entity moves through a defined state machine (documented in `04-Database/state-machines.md`), and many transitions trigger critical side effects:

| Transition | Side Effect |
|------------|-------------|
| Invoice `DRAFT → FINALIZED` | Sequential number assignment (ADR-0009), field snapshotting (ADR-0004), fiscal lock date check (ADR-0003) |
| PO `SENT → PARTIAL` | `RECEIPT` inventory transaction created (ADR-0002) |
| Workshop Order `COMPLETED → INVOICED` | Invoice generation with snapshotted line items |
| Sales Order `COMPLETED → INVOICED` | Invoice generation with snapshotted prices |

In a multi-user environment, two requests can attempt to transition the same entity simultaneously. Without protection, this causes:

1. **Duplicate side effects:** Two concurrent `DRAFT → FINALIZED` requests could assign two sequential numbers to the same invoice.
2. **Invalid state skips:** A request could read status as `CONFIRMED`, begin processing, while another request has already moved it to `IN_PROGRESS`.
3. **Lost transitions:** Optimistic updates that overwrite each other without detecting the conflict.

Traditional approaches like `SELECT ... FOR UPDATE` (pessimistic locking) add complexity and deadlock risk. We needed a pattern that is simple, safe, and works naturally with Prisma.

## Decision

All status transitions use the **atomic `updateMany` guard pattern** inside `prisma.$transaction`. The guard works by including the **expected current status** in the `WHERE` clause of the update:

```typescript
const result = await prisma.$transaction(async (tx) => {
  // Guard: only transition if still in the expected state
  const updated = await tx.salesOrder.updateMany({
    where: {
      id: orderId,
      status: 'CONFIRMED',  // ← expected current status
    },
    data: {
      status: 'IN_PROGRESS',
    },
  });

  // If no rows matched, the entity was already transitioned
  if (updated.count === 0) {
    throw new ConflictException(
      'Sales order has already been transitioned by another request.'
    );
  }

  // Safe to perform side effects — we hold the transaction
  await tx.inventoryTransaction.create({ /* ... */ });

  return updated;
});
```

### How It Works

1. **`updateMany` with compound `WHERE`:** PostgreSQL evaluates `WHERE id = X AND status = Y` atomically. If the status has changed since the request was initiated, the update matches 0 rows.
2. **`count === 0` detection:** The service checks the update result. Zero affected rows means a concurrent request already transitioned the entity — we throw `ConflictException` (HTTP 409).
3. **Transaction wrapping:** The entire transition (status update + side effects) is wrapped in `prisma.$transaction`, ensuring atomicity. If any side effect fails, the status change is rolled back.

### Why `updateMany` Instead of `update`

Prisma's `update` method requires a unique identifier in `where` and throws if no record matches. `updateMany` accepts non-unique `where` clauses (including status) and returns a `count` instead of throwing, giving us programmatic control over the conflict response.

### Rules for Implementation

1. **Every status transition must use this pattern.** No exceptions. Even transitions that seem "safe" (e.g., no side effects) must guard against concurrent modification.
2. **The expected status must be the immediate predecessor.** Do not use `status: { in: ['DRAFT', 'CONFIRMED'] }` to skip states — each transition is a single edge in the state machine.
3. **Side effects go inside the transaction.** Inventory ledger entries, number assignment, field snapshotting — all must execute within the same `prisma.$transaction` as the status update.
4. **HTTP 409 Conflict for race conditions.** When `count === 0`, throw `ConflictException`. The frontend should display a user-friendly message and refresh the entity state.

### Frontend Coordination

When the frontend receives an HTTP 409:

1. **Invalidate the TanStack Query cache** for the affected entity to fetch fresh state.
2. **Display a toast notification** (via Sonner): "This document was updated by another user. The page has been refreshed."
3. **Do not retry automatically.** The user must review the new state and decide whether to re-attempt the action.

### Interaction with Auto-Save (ADR-0006)

The form auto-save pattern (debounced 750ms) must **cancel any pending save** before initiating a status transition. This prevents a race where:

1. User edits a field (auto-save timer starts).
2. User clicks "Confirm Order" (status transition request fires).
3. Auto-save fires and overwrites the transitioning entity.

The cancel-before-transition rule is enforced in the frontend mutation handler.

## Consequences

### Positive

- **Race condition prevention** without pessimistic locks or external coordination.
- **Simple pattern** that every developer can follow — no lock management, no retry loops, no distributed consensus.
- **Atomic side effects** — if the inventory transaction fails, the status change rolls back. The system never reaches an inconsistent state.
- **Audit-friendly** — every transition is a deliberate, guarded operation. No silent overwrites.

### Negative

- **HTTP 409 user experience:** Users occasionally see "already transitioned" errors when two people work on the same document. This is correct behavior but requires frontend handling.
- **Verbose service code:** Every transition method follows the same boilerplate pattern (updateMany → check count → throw/proceed). This is intentional — the consistency outweighs the repetition.
- **No queue/retry:** If two requests race, the loser fails immediately rather than queuing. For our use case (ERP with moderate concurrency) this is acceptable.

### Neutral

- This pattern does not prevent **non-transition concurrent edits** (e.g., two users editing notes on the same DRAFT order). Those conflicts are handled by the last-write-wins policy in ADR-0006.
- The `ConflictException` (409) is distinct from `UnprocessableEntityException` (422) used for fiscal lock date violations (ADR-0003). This separation allows the frontend to differentiate between "someone else changed this" (409) and "this action is not allowed" (422).

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **`SELECT ... FOR UPDATE` (pessimistic locking)** | Explicit lock, prevents any concurrent read-modify-write | Deadlock risk with multiple locked rows, Prisma support is limited (requires raw queries), holds locks longer than necessary |
| **Optimistic locking with version column** | Standard pattern, supported by many ORMs | Prisma has no built-in `@Version` decorator, requires manual version increment and comparison, more complex than `updateMany` guard |
| **Application-level mutex (Redis lock)** | Works across multiple app instances | Adds infrastructure dependency, lock expiry edge cases, over-engineering for document-level transitions |
| **Event sourcing** | Transitions become immutable events, natural audit trail | Massive architectural shift, not justified for our scale, Prisma is not designed for event sourcing |
| **No guard (trust the frontend)** | Simplest implementation | Completely unsafe — concurrent requests corrupt state, violates ERP data integrity requirements |

## References

- ADR-0002: Ledger-Based Inventory — inventory transactions are side effects inside guarded transitions
- ADR-0003: Fiscal Lock Date — lock date validation occurs inside the same transaction as the status guard
- ADR-0004: Invoice Snapshotting — field snapshots are side effects inside guarded transitions
- ADR-0006: Form Auto-Save — cancel-before-transition coordination
- ADR-0009: Sequential Document Numbering — number assignment occurs inside guarded transitions
- `docs/internal/04-Database/state-machines.md` — defines all valid transitions and includes the guard code example

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | N/A |
| Issues | Retroactive ADR |
