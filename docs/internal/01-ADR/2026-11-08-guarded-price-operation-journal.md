---
title: "ADR-0037: Durable Operation Journal for Guarded Parts Price Changes"
date: "2026-11-08"
status: proposed
deciders: "Dejan Dosenovic"
tags: [adr, inventory, concurrency, idempotency]
---

# ADR-0037: Durable Operation Journal for Guarded Parts Price Changes

## Status

**Proposed — 2026-11-08.** Awaiting review by the Product Planner and the Software Engineer, then Dejan Dosenovic's concrete decision. This document authorizes no implementation, no storage, no trigger, no endpoint and no migration. Statements about the current code (main `3b612c1`) come from earlier code reading and are **unverified**; each becomes a prerequisite in "Implementation and Validation". No test or QA result is claimed.

## Context and Decision Drivers

The bulk price action on the parts list (`/inventory`, AUT-886) reads each part and then sends a full-body `PATCH /api/inventory/:id` (reported, unverified at `3b612c1`). The reported contract has no revision, so overlapping edits can overwrite each other. A guarded, price-only branch of the same route (`retail_price` + `expectedRevision`) fixes the overlap only if an outcome can always be recovered after a lost response, a reload, a new tab or another device.

Dejan approved these requirements on 2026-11-08; they are fixed and not reopened here:

- Durable binding of the operation intent from server acceptance, surviving business rollback.
- Authorized recovery and discovery after reload, a new tab or another device.
- Demonstrable late-request fencing before an operation is declared NOT_APPLIED.
- Not accepted as risks: rebinding the same key to a different intent after a rollback, and a lost frozen intent causing a duplicate percentage operation.

Settled product boundaries: parts list only; loaded, selected IDs, at most 100; tenant-wide prices (no site predicate); the existing route and the price-only body; legacy validation, authorization, non-disclosure, percentage and rounding unchanged; fresh authorized reads during preview before consent; consent freezes target, expected revision and operation identity; no hidden re-read or repricing after consent.

## Decision

Introduce a narrow **operation journal** for guarded price operations, with acceptance separated from execution. Names, schema and endpoints below are recommendations, not adopted identifiers.

### 1. Acceptance (Tx-A)

A short transaction, committed independently of the business transaction. It first checks current authorization and that the item exists in the tenant (no row is written for an unauthorized or unknown item; Tx-E checks again). It then inserts or reads a journal row unique on (tenant, principal, key). The row durably binds: tenant, principal, item, operation kind, expected revision and the absolute target in canonical minor units. It also records the original basis and SKU for authorized explanation, the server-set `acceptedAt` and the state ACCEPTED. The commit of Tx-A is the linearization point of the binding. Reuse of a key with a different intent is rejected without execution. A same-key request locks the journal row (`FOR UPDATE`, bounded by the 5 s recovery wait). If the row is terminal or FENCED, it returns the stored result (for FENCED: the stored NOT_APPLIED result, not `OPERATION_UNRESOLVED`). If it is still ACCEPTED, or the 5 s wait elapses while Tx-E holds the lock, it returns 409 `OPERATION_UNRESOLVED` (it does not execute and does not mutate). It never runs Tx-E, and only fencing or discovery resolves an ACCEPTED row. Proposed: the existing PATCH handler runs Tx-A and then Tx-E in one request. A process death between them leaves ACCEPTED, which the recovery path resolves.

### 2. Execution (Tx-E)

One transaction, always in the order journal row, then item row:

1. Lock the journal row. Require state ACCEPTED; FENCED and the terminal states are final, so the state alone is the fence.
2. Re-check current authorization (existing role check, tenant scope, no site predicate).
3. Lock the item row (tenant-scoped) and compare the expected revision.
4. Match: change only `retail_price`, write the business audit, record the exact post-trigger revision (depends on the revision hypothesis in section 10) and set APPLIED. Mismatch: set CONFLICT with no price change and no business audit.

Mutation, business audit and terminal proof commit atomically. A 409 is raised only after the commit so the terminal record cannot roll back. Realtime publication happens only after commit and never for a conflict or a rollback.

### 3. Fencing and recovery

Recovery is an explicit, authorized action that takes the key and the frozen intent. It locks the same journal row and moves ACCEPTED to FENCED (NOT_APPLIED). **If no row exists**, it inserts a FENCED row under the same unique (tenant, principal, key), so a later Tx-A for that key finds FENCED and never executes; a differing intent is rejected. A fence that finds ACCEPTED is allowed only after the lease (section 7) has ended; the lease end is not proof, only the committed fence is. A fence that finds no row needs no lease and takes effect immediately, but it considers the admission window: a key more than 24 h in the past can never be admitted, so the fence reports it as NOT_APPLIED without inserting a row. A key within the window, or ahead of server time (it enters the window later), gets a FENCED row; the unique constraint serializes it against a concurrent Tx-A, and if Tx-A commits first the fence finds ACCEPTED and the lease rule applies. Execution and fencing serialize on the journal row: either Tx-E commits first and recovery observes the terminal result, or the fence commits first and Tx-E observes FENCED and returns without any write. A late original request after a fence is rejected. Only FENCED or a terminal state allows NOT_APPLIED. A timeout, an expired lease, a missing row or a browser acknowledgement is not proof. Tx-E sets a lock timeout of 10 s and a whole-transaction timeout of 30 s. The lease is a UX bound; correctness comes only from the row lock, because a late-starting Tx-E could still hold the row past the lease. If the lock is still held, recovery waits within its bound and then reports "still unresolved". A read-only status or discovery never mutates.

### 4. State model

```
ACCEPTED ── Tx-E match ──────▶ APPLIED
    │ ──── Tx-E mismatch ────▶ CONFLICT
    └ ──── fence (explicit) ─▶ FENCED  (= NOT_APPLIED)
APPLIED | CONFLICT | FENCED ──▶ retained ──▶ deleted
```

Acknowledgement by the client changes no state. Retention counts from the time the row reached a terminal state.

### 5. Race matrix

| Race | Outcome |
|---|---|
| Same key, same intent, concurrent | One execution; the duplicate waits for the row lock (5 s bound), then returns the stored result if terminal, otherwise (still ACCEPTED, or the wait elapsed) 409 `OPERATION_UNRESOLVED` |
| Same key, different intent | Rejected, no execution |
| Fence vs Tx-E | Row lock decides; no third outcome |
| Late original after fence | Rejected, no effect |
| Different keys, same item, different principals | Item lock plus revision CAS: one APPLIED, one CONFLICT |
| Different keys, same item, same principal | Second refused at Tx-A (409 `OPERATION_UNRESOLVED`) while the first is unresolved; no execution |
| Same-key retry while ACCEPTED | 409 `OPERATION_UNRESOLVED`; Tx-E is not run again |
| Fence with no row (request not yet accepted) | FENCED row inserted; a later Tx-A for that key does not execute |
| Crash between Tx-A and Tx-E | ACCEPTED persists; recovery fences or observes |

### 6. Coordination

A uniqueness rule allows at most one unresolved (ACCEPTED) guarded operation per (tenant, principal, item). Another guarded operation on that item for the same principal is refused until the first is resolved. A browser lock or discovery alone cannot enforce this. Legacy edits receive no lock. No global exactly-once claim is made, and unconditional legacy full-body writers can still overwrite guarded commits; revision advancement alone does not make them CAS-safe.

### 7. Identity, time and retention (recommended values)

- **Identity:** the key is a client-generated UUIDv7 sent in an `Idempotency-Key` header, consumed only by the guarded branch. Legacy requests keep today's behavior for that header. Header name and protocol still need approval.
- **Admission:** a key is admitted only if its UUIDv7 time is within 24 h in the past and 5 min in the future of server time. This is a pre-filter against suspended clients and skew, not proof. An existing journal row is looked up first, so an accepted operation stays recoverable after 24 h.
- **`acceptedAt`** is server-authoritative. ACCEPTED has no wall-clock expiry and active rows are never deleted. A 2-minute lease, counted from `acceptedAt`, is the earliest time at which a fence of an ACCEPTED row is allowed.
- **Retention:** terminal and fenced rows live 30 days, counted from the later of the terminal time and the key's UUIDv7 time, longer than the admission window plus skew. After deletion a same-string key is rejected by admission age, so no separate tombstone is needed. A forged timestamp creates a different key string, hence a new operation under its own CAS.
- **Lock bounds:** Tx-E lock timeout 10 s and whole-transaction timeout 30 s; recovery lock wait 5 s. A lock timeout or deadlock aborts only Tx-E, leaving ACCEPTED, which the client shows as unresolved until fenced or observed.

### 8. Discovery and authorization

The server offers a read-only discovery/status capability scoped to the caller's own operations (state, original basis, target, expected revision, SKU, `acceptedAt`), plus the explicit fence action. Visibility is principal-only in this version. Keys are not bearer credentials. Discovery, recovery, fencing and any future replay need current authorization and the principal match. A deleted item gives 404, lost access gives 403, and receipt contents are not disclosed. Rows that cannot be fenced under these conditions are never deleted while ACCEPTED; they stay readable to an operator for audit, and how they are resolved is an open decision (below). 400/410/422 describe the current attempt only; the original outcome, including a recorded 409, is recovered from the journal. There is no automatic replay, and any later approved replay resolves the original frozen intent without recalculation.

### 9. Money and response compatibility

The canonical target is an integer in minor units from 0 to 9,999,999,999 (99,999,999.99), written to the stored decimal without extra database rounding. The percentage policy and rounding stay unchanged. A parsed JSON number cannot distinguish `1e2` from `100`; lexical rejection needs separate raw-body parser scope. Guarded responses are documented as separate schemas so legacy generated unions are untouched. Status codes (proposed): revision conflict 409 `INVENTORY_REVISION_CONFLICT`; unresolved earlier operation 409 `OPERATION_UNRESOLVED`; expired admission 410; intent mismatch 422. Clients branch on `code`.

### 10. Revision

An integer `revision` assigned by a single `BEFORE UPDATE` trigger (`OLD.revision + 1`, once per UPDATE) is a hypothesis, not a decision. No application increments. The item row lock proves neither universal revision advancement nor delete/recreate (ABA) safety.

## Consequences

### Positive

- Binding, fencing and recovery survive rollback, crashes, reloads and device changes.
- Mutation, audit and applied proof are atomic; fence and execution cannot both win.
- No heuristic (price or revision comparison) decides an outcome.

### Negative

- New storage, a retention job and an authorized discovery and fence API surface, all needing approval.
- The same-principal per-item block can delay a second bulk action until recovery.
- Legacy writers remain unprotected; the guard is action-local.

### Neutral

- Rounding, percentage policy and legacy validation are unchanged.

## Alternatives Considered

- **Reuse an existing pattern:** only if later shown equivalent (independent commit, per-intent unique binding, fencing under the same row lock, authorized discovery). Otherwise defer.
- **Pending-operation field on the catalog row:** serializes with the item lock but adds writes to a hot table and fits per-principal binding poorly.
- **Asynchronous queue and worker:** changes the synchronous UX and is larger.
- **Advisory or browser locks:** not durable.
- **Rejected:** keeping the binding only inside the business transaction (it disappears on rollback) and accepting the duplicate-percentage risk.
- **Deferral:** acceptable if the prerequisites below cannot be met.

## Implementation and Validation

No implementation is authorized. Prerequisite evidence, none gathered yet:

- Writer and bypass coverage for the catalog table, including raw and nested writes, `upsert`, jobs, imports, and delete/recreate ABA.
- Trigger hypothesis: single trigger, coexistence with other triggers, Prisma return values after the trigger, realtime behavior after commit.
- Database version, backfill, integer width and fail-closed overflow, rollout, lock levels and rollback compatibility.
- A writer lock graph supporting the journal-then-item order, since lock ordering alone does not prove deadlock freedom.
- Existing operation patterns (to confirm or exclude reuse).
- CORS and proxy pass-through of the custom header; request-body parser scope.
- The journal model is excluded from realtime emission, and emission for the price change happens only after commit (the realtime extension may otherwise emit before commit).
- Equivalence evidence if reuse of an existing pattern is proposed.

Later tests (not yet written or run) must cover atomic success, different-key races, same-key serialization and changed-intent rejection including rollback, lost-response, in-flight, late-request, crash, terminal-conflict and expiry reconciliation, the frozen preview flow, and the existing selection, legacy, permission and mobile regressions. Full end-to-end runs stay in CI; performance benchmarks belong in nightly runs.

## Decisions Requested from Dejan

1. Adopt this journal (separate acceptance, fenced execution) as the mechanism.
2. Header carriage and name of the key.
3. Principal-only visibility of discovery and fence.
4. Lease 2 min, Tx-E lock timeout 10 s and transaction timeout 30 s, recovery lock wait 5 s, admission 24 h, retention 30 days.
5. Status codes and codes listed in section 9.
6. New narrow journal storage versus a demonstrated equivalent existing pattern.
7. Resolution of ACCEPTED rows whose item was deleted or whose principal lost access (recommendation: the still-authorized principal may fence by row, never executing; otherwise an operator reads them for audit).

## Pragmatic Enforcer Analysis

Necessity **7/10**: an unrecoverable outcome after a lost response risks a duplicate price change on real parts. Complexity **6/10**: one table, a short acceptance step, a row-lock fence and a retention job; no queue and no change to legacy writers. Ratio **0.86**, below 1.5. The simpler guarded PATCH without a journal remains the fallback only if the approved recovery requirement is withdrawn.

## References

- [ADR-0010: OpenAPI contract](2026-04-12-openapi-contract-first.md)
- [ADR-0011: Atomic status transition guards](2026-04-12-atomic-status-transition-guards.md)
- [ADR-0013: Tenant isolation](2026-04-15-row-level-multi-tenancy.md)
- [ADR-0035: Cursor-based infinite lists](2026-11-02-cursor-based-infinite-lists.md)
- [ADR-0036: Frontend interaction rules](2026-11-02-frontend-interaction-rules.md)

## Linear Tracking

AUT-886 (parts bulk price action). This ADR assigns no implementation issue and does not close AUT-886.
