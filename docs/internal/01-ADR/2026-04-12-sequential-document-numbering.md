---
title: "ADR-0009: Sequential Document Numbering"
date: "2026-04-12"
status: accepted
deciders: "Product Owner, Engineering Team"
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - adr
  - finance
  - concurrency
  - numbering
---

# ADR-0009: Sequential Document Numbering

## Status

**Accepted** — 2026-04-12 (Retroactive documentation of existing system)

## Context

Auto Core Platform produces several classes of legal/financial documents — Sales Invoices, Sales Orders, and Workshop Orders — each requiring unique, sequential, human-readable identifiers. These numbers serve multiple purposes:

1. **Legal compliance:** Tax invoices must carry a gap-free sequential number in many jurisdictions.
2. **Human reference:** Users communicate about documents using short identifiers, not UUIDs.
3. **Auditability:** Gaps in numbering raise red flags during fiscal audits.

The challenge is that multiple users may finalize documents concurrently, and the numbering system must guarantee uniqueness and sequential ordering without gaps, even under high concurrency.

## Decision

We use a **singleton counter model** backed by the `FinanceSettings` table (and the dedicated `InvoiceSequence` entity for invoices) to generate sequential document numbers atomically inside database transactions.

### Numbering Formats

| Document Type | Format | Example | Counter Location |
|---------------|--------|---------|-----------------|
| Sales Invoice | `RE-{YYYY}-{XXXX}` | `RE-2026-0042` | `InvoiceSequence` (per fiscal year) |
| Sales Order | `SO-{YYYY}-{XXXX}` | `SO-2026-0187` | `FinanceSettings.next_sales_order_number` |
| Workshop Order | `WO-{YYYY}-{XXXX}` | `WO-2026-0063` | `FinanceSettings.next_workshop_order_number` |

- `{YYYY}` — the fiscal year at the time of number assignment.
- `{XXXX}` — zero-padded sequential counter, resettable per fiscal year.

### Assignment Trigger

Numbers are **not** assigned at entity creation. They are assigned at the moment the document leaves its initial mutable state:

| Document | Trigger Transition | Rationale |
|----------|--------------------|-----------|
| Sales Invoice | `DRAFT → FINALIZED` | Number is permanent; DRAFT invoices are still editable/deletable. |
| Sales Order | `DRAFT → CONFIRMED` | The order becomes a commitment to the customer. |
| Workshop Order | `SCHEDULED → INTAKE` or creation | Workshop orders are externally referenced immediately. |

### Atomic Increment Pattern

Number assignment **must** occur inside a `prisma.$transaction` using an atomic read-and-increment:

```typescript
const result = await prisma.$transaction(async (tx) => {
  // 1. Atomically increment the counter
  const settings = await tx.financeSettings.update({
    where: { id: SINGLETON_ID },
    data: { next_sales_order_number: { increment: 1 } },
  });

  // 2. Format the number
  const number = `SO-${fiscalYear}-${String(settings.next_sales_order_number).padStart(4, '0')}`;

  // 3. Assign to the document inside the same transaction
  await tx.salesOrder.update({
    where: { id: orderId },
    data: { order_number: number, status: 'CONFIRMED' },
  });

  return number;
});
```

The `update` with `{ increment: 1 }` is an atomic database operation — PostgreSQL guarantees that concurrent transactions will serialize on the row lock, preventing duplicate numbers.

### Fiscal Year Rollover

When a new fiscal year begins, counters reset to 1. The `{YYYY}` prefix in the format ensures uniqueness across years. Rollover logic checks the fiscal year at assignment time and resets the counter if it has changed since the last assignment.

### Immutability

Once a sequential number is assigned, it is **permanently bound** to that document. There is no mechanism to reassign, reuse, or recycle numbers. If a document is cancelled (e.g., Invoice `FINALIZED → CANCELLED`), its number remains consumed — this is intentional for audit trail integrity.

## Consequences

### Positive

- **Gap-free numbering** under concurrent usage, satisfying fiscal audit requirements.
- **Human-readable identifiers** that encode document type and fiscal year at a glance.
- **Concurrency-safe** without application-level locks — PostgreSQL row-level locking handles serialization.

### Negative

- **Singleton contention:** Under extreme concurrent finalization, the singleton counter row becomes a serialization bottleneck. This is acceptable at current scale but would need partitioning (e.g., per-branch counters) at high volume.
- **Cancelled documents consume numbers:** A voided invoice leaves a "gap" in the active document sequence. This is correct behavior for fiscal compliance but may confuse users who expect contiguous active numbers.

### Neutral

- The `InvoiceSequence` entity is separate from `FinanceSettings` for historical reasons. Both serve the same singleton counter purpose. Consolidation is possible but not urgent.
- Purchase Orders and Purchase Invoices currently use UUID-based references without sequential numbering. If sequential numbering is needed for these, the same pattern applies.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **UUID-only identifiers** | No contention, globally unique, simple | Not human-readable, fails fiscal compliance for invoices |
| **Application-level counter with Redis** | Faster than DB lock for high-throughput | Adds infrastructure dependency, risk of drift between Redis and DB, no transactional guarantee with Prisma |
| **Database sequence (`CREATE SEQUENCE`)** | Native PostgreSQL feature, very fast | Cannot easily reset per fiscal year, gaps on transaction rollback (violates gap-free requirement), harder to manage across multiple document types |
| **Pre-allocated number blocks** | Reduces contention by reserving ranges per server/session | Complexity, unused blocks create gaps, over-engineering for current scale |

## References

- ADR-0003: Fiscal Lock Date — numbers are assigned at transitions that also validate `lock_date`
- ADR-0004: Invoice Snapshotting — `DRAFT → FINALIZED` assigns the number and triggers field snapshots simultaneously
- ADR-0005: Deletion Policy — `InvoiceSequence` is Forbidden (immutable); Draft-Only documents can be deleted before number assignment
- ADR-0011: Atomic Status Transition Guards — the number assignment transaction also uses the `updateMany` guard pattern
- `docs/internal/04-Database/core-erd.md` — `InvoiceSequence` and `FinanceSettings` entities
- `docs/internal/04-Database/state-machines.md` — trigger transitions per document type

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | N/A |
| Issues | Retroactive ADR |
