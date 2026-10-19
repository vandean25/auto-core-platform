---
title: "ADR-0032: Collective Workshop Invoices Have Immutable Allocation Sources"
date: "2026-10-19"
status: accepted
deciders: "Dejan Dosenovic; AUT-651 specification baseline requested for main"
linear-project: "incadea Migration"
tags: [adr, finance, invoice, fleet]
---

# ADR-0032: Collective Workshop Invoices Have Immutable Allocation Sources

## Status

**Accepted specification baseline — 2026-10-19.** This narrowly amends ADR-0023's one-source shape for a future gated collective workshop origin. It does not mark the feature implemented/activated or certify country/accountant readiness. The [AUT-651 feature spec](../02-Feature-Specs/Finance/fleet-monthly-collective-invoicing.md) is normative for scope, commands, examples and rollout.

## Context and Decision Drivers

Fleet payers need a new fiscal invoice covering unbilled work from several workshop orders. Today's singular `Invoice.workshop_order_id` and AUT-646's per-order/bearer/payer model cannot represent that truth. Choosing one representative source would lose traceability; collecting already issued invoices would duplicate fiscal amounts. Removing uniqueness alone would permit the same allocation to be billed through individual and collective writers.

Protect exactly-once coverage, persisted seller/site/payer ownership, immutable line accounting evidence, compatible credits/exports and retained v1/v2 behavior.

## Decision

1. Add explicit `COLLECTIVE_WORKSHOP` origin to the future invoice model. Such an invoice has no direct workshop/sales/vehicle-sale source FK; instead it requires a nonempty immutable tenant-safe source-allocation join and snapshot v3. Every source belongs to the same legal entity, persisted site, payer, currency and approved tax-profile group. A single-order origin still has its legitimate single source and the same coverage guard. No new generic source-less issuance is allowed.
2. Use one active allocation claim/committed coverage invariant shared by all invoice writers. Lock and validate orders/allocations in stable order, commit source manifest, frozen money/ownership, source-plan versions, one number and fiscal status atomically per collective invoice. A source cannot be billed individually while claimed/committed collectively, or become billable again after credit. Draft claims release only under an audited uncommitted abandon command.
3. Reuse tenant/calendar-year RE and CN numbering. Add no monthly, payer, bearer or per-entity series. Preserve original source/order references in lines/manifest rather than assigning old numbers to the invoice. Source allocations carry already approved net/VAT/gross; aggregate their exact cents, do not reprice/recompute VAT on a monthly grand total.
4. Keep one site per collective invoice; multi-site runs produce separate previewed invoices. Monthly ready-date grouping is distinct from actual supply dates and legal issuance/tax periods. Complete source groups, opt-in/approval/profile/deadline checks and persisted ownership are mandatory. No existing invoices, legacy history, payments, warranty/internal allocations or other business-domain sources are bundled as new sales.
5. Credits still reference one original invoice/line snapshot, including its source traceability, under ADR-0023's quantity/money caps. No stock effect, source reopening, mixed-original credit or automatic rebill. Committed PDFs/export evidence remain immutable; serializer/payment/credit readers must explicitly support origin/v3 or refuse it safely.
6. Runs orchestrate outcomes; only invoices are fiscal documents. Commit per invoice, retain successful numbers on partial run/PDF/mail failures, and retry only uncovered entries using durable idempotency. No synthetic monthly workshop order, duplicate operational consumption, per-order shadow receivable or expected-payment posting is introduced.

Sales-order and vehicle-sale source uniqueness, legacy snapshot restrictions, fiscal locks, site authorization, credit semantics, numbering and export-retention invariants of ADR-0023 remain unchanged. AUT-646 per-order behavior remains the default until all collective prerequisites ship and its separate human-only flag/opt-ins are enabled.

## Alternatives Considered

| Option | Benefit | Reason not selected |
|---|---|---|
| Nonfiscal monthly statement only | Retains existing per-order invoices | Useful separate report, but does not satisfy one new monthly fiscal invoice. |
| Representative workshop FK / synthetic monthly order | Reuses current one-source code | Misstates ownership, source work and source allocation traceability; risks double stock/revenue. |
| Remove workshop uniqueness only | Small schema diff | No exclusive coverage across competing origins; permits duplicate billing. |
| Separate fiscal/numbering engine | Avoids adapting Invoice | Duplicates proven snapshots, sequences, credits, registers and export infrastructure. |
| Cross-site collective invoice immediately | One payer PDF across sites | Would require a new multi-site document access model; initial scope keeps explicit site-owned invoices. |

## Consequences

### Positive

- One fiscal invoice can truthfully cover several orders, retaining every source allocation and real service date.
- Shared coverage guards prevent races between legacy per-order and new collective issuance.
- Existing RE/CN series, credits and frozen accounting facts remain reusable.

### Negative

- Every writer/reader/export/payment path that assumes one source must be audited and deployed before enabling collective origin.
- The new joins/claims and immutable v3 manifest require schema, restore/deletion rules and concurrency tests.
- One-site grouping may produce several invoices for a fleet operating across sites; the preview must make that partition explicit.

### Neutral

- No schema, code or OpenAPI change occurs in this documentation PR.
- Country/accountant/profile and load evidence remain release gates; a specification is not tax approval.
- Existing issued v1/v2 documents and per-order billing are not migrated into collective invoices.

## Implementation and Validation

Add schema/coverage guards first; update all origin-aware writers and readers next; prove country/provider/export/credit/recovery compatibility and cap-bound load; only then enable the separate default-OFF collective flag and payer profiles. Rollback cannot restore a writer that ignores committed coverage. Stop affected issuance and fix forward if compatible code is unavailable.

Required tests include single-vs-collective races, multiple/foreign source ownership, draft abandonment/commit races, one-number atomicity, source/payer-version drift, exact per-source rounding, partial run failure, immutable v3 PDFs, one-original credits, no duplicated inventory/payments/KPI/export and disabled-feature regressions.

## Pragmatic Enforcer Analysis

Necessity **8/10**, complexity **6/10**, ratio **0.75**. A statement is simpler but is not a collective invoice. Extending Invoice with explicit sources/coverage is the smallest design that fulfills the fiscal feature without inventing another billing platform. Keep cross-site single documents, other source domains and further correction types outside this release; preserve their existing workflows.

## References and Linear Tracking

- [AUT-651](https://linear.app/auto-core-platform/issue/AUT-651); [Fleet monthly collective invoicing](../02-Feature-Specs/Finance/fleet-monthly-collective-invoicing.md).
- [ADR-0023 legal invoicing/accounting](2026-09-20-legal-invoicing-and-accounting-export.md); [AUT-646 multi-payer specification](../02-Feature-Specs/Finance/split-invoicing-multi-payer.md); [ADR-0022 site ownership](2026-08-31-site-operational-scope.md).
- Current ACP source: `apps/core-api/prisma/schema.prisma` and invoice/workshop/credit/accounting-export code. Target structures are specified prerequisites, not assertions about deployed schema.
