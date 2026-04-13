---
title: "ADR-0003: Fiscal Lock Date Integrity"
date: "2026-04-12"
status: accepted
deciders: "Product Owner, Finance Team"
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - adr
  - finance
  - architecture
---

# ADR-0003: Fiscal Lock Date Integrity

## Status

**Accepted** — 2026-04-12 (Retroactive documentation of existing system)

## Context

In accounting and enterprise resource planning (ERP) systems, allowing users to modify or insert financial transactions with historical dates creates severe compliance and reconciliation issues. Once a financial period (e.g., a month or quarter) is "closed" and reported to external authorities, the data for that period must become strictly immutable.

Auto Core Platform lacked a centralized mechanism to prevent backdated entries in core modules (Sales Invoices, Purchase Bills, Inventory Transactions). We needed a definitive architectural rule to protect historical data integrity.

## Decision

We introduced a global **Fiscal Lock Date** governed by the `FinanceSettings` singleton.

1. **Global Configuration:** The `FinanceSettings` database table (which is enforced to have only one row via application logic) contains a `lock_date` (DateTime) column.

2. **Backend Enforcement:** Any backend service that creates or modifies a date-bearing financial or inventory record must validate the record's fiscal date against `FinanceSettings.lock_date`. The following entities are subject to lock date validation:

   | Entity | Fiscal Date Field | Service Responsible |
   |--------|-------------------|---------------------|
   | `Invoice` | `invoice_date` | `invoices.service.ts` |
   | `PurchaseInvoice` | `invoice_date` | `purchase.service.ts` |
   | `InventoryTransaction` | `transaction_date` | `ledger.service.ts` |

   Entities that are pre-financial (e.g., `SalesOrder`, `PurchaseOrder`, `WorkshopOrder`) are **not** subject to lock date validation because they do not represent finalized financial commitments. However, the downstream entities they produce (invoices, ledger entries) are validated at the moment of creation.

3. **Immutability Rule:** If the record's fiscal date is less than or equal to (`<=`) the `lock_date`, the operation must be rejected with an **HTTP 422 (Unprocessable Entity)** error and a descriptive message (e.g., `"Cannot create invoice: date 2026-01-15 falls within the locked fiscal period ending 2026-01-31"`). We use 422 rather than 400 (the request is syntactically valid) or 403 (this is a business rule, not an authorization check).

4. **No UI Bypassing:** The frontend UI must never be trusted to enforce this rule alone. The rule is absolute at the API/Database layer. The UI may disable dates or show warnings for better UX, but the actual security boundary is the backend.

### Lock Date Advancement Rules

The fiscal lock date is a one-way ratchet:

| Rule | Detail |
|------|--------|
| **Who can advance it** | Only users with the Finance Settings permission (currently any authenticated user with Settings access; a future Feature Spec may restrict this to a dedicated `FINANCE_ADMIN` role). |
| **Direction** | The lock date may only be moved **forward** (to a later date). Moving it backward would reopen a closed fiscal period, which is a compliance violation. The backend must reject any `UPDATE` that sets `lock_date` to a value earlier than the current `lock_date`. |
| **Confirmation** | Advancing the lock date is a destructive action (it permanently seals a period). The frontend must present a confirmation dialog. However, the backend does not require a confirmation token — idempotent forward moves are safe. |
| **Granularity** | The lock date is a specific calendar date (not a fiscal period). This allows flexible period closings (e.g., closing January while February remains open) without requiring a period-based calendar configuration. |

## Consequences

### Positive

- **Financial Compliance:** Ensures that once a period is closed by the finance team, no rogue transactions can be slipped in retroactively, guaranteeing report stability.
- **Data Confidence:** Builds trust with stakeholders that historical numbers will not silently drift.

### Negative

- **Rigidity:** If a legitimate mistake was made in a closed period, the system will not allow a direct edit. Users must learn accounting correction patterns (e.g., creating a reversing entry in the *current* open period rather than deleting the old one).

### Neutral

- Requires every new feature that handles dates and financials to be explicitly wired up to check the `finance.service` for the active lock date. Feature Specs for such features must include a "Fiscal Impact" section confirming the lock date check is planned.
- The lock date comparison uses a date-only check (calendar day), not a timestamp. All fiscal date fields should be stored as date-only values or truncated to midnight before comparison.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Soft/Warning Locks | Better UX for immediate mistake correction. | Violates strict accounting principles. Makes financial audits extremely difficult. |
| Role-Based Bypasses (Admin can bypass) | Flexibility for system administrators. | Security and compliance risk. An admin account compromise or mistake could invalidate closed periods. |
| Period-Based Locking (lock by fiscal period) | More granular; allows locking Q1 while Q2 remains open without calculating exact dates. | Requires a fiscal calendar configuration (period definitions, fiscal year start month). Over-engineered for current scale where a single date suffices. |
| Database-Level CHECK Constraints | Enforcement at the lowest possible layer; impossible to bypass from application code. | CHECK constraints cannot reference other tables (`FinanceSettings`). Would require a PostgreSQL trigger, which scatters business logic into the DB layer and produces opaque error messages. |

## References

- `apps/core-api/prisma/schema.prisma` (`FinanceSettings` model)
- `apps/core-api/src/finance/finance.service.ts`
- ADR-0002: `2026-04-12-ledger-based-inventory.md` — `InventoryTransaction` is a protected entity governed by the lock date
- ADR-0004: `2026-04-12-invoice-snapshotting.md` — invoice immutability after finalization is reinforced by the lock date preventing backdated invoice creation
- ADR-0005: `2026-04-12-deletion-policy-enforcement.md` — the "Forbidden" deletion strategy for `Invoice` and `InventoryTransaction` is motivated by the same fiscal immutability principle
- ADR-0009: `2026-04-12-sequential-document-numbering.md` — number assignment occurs inside the same transaction that validates the lock date
- ADR-0011: `2026-04-12-atomic-status-transition-guards.md` — the `updateMany` guard pattern protects the transitions that trigger lock date validation

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | N/A |
| Issues | N/A |
