---
title: "ADR-0037: Durable Operation Journal for Guarded Parts Price Changes"
date: "2026-11-08"
status: accepted
deciders: "Dejan Dosenovic"
tags: [adr, inventory, concurrency, idempotency]
---

# ADR-0037: Durable Operation Journal for Guarded Parts Price Changes

## Status

**Accepted — 2026-11-08.** Merged repository status (not implementation or QA acceptance). Accepted by Dejan Dosenovic, who confirmed this in the implementing session after seven rounds of independent review of the text at commit `192b5cc`. Review by the Product Planner and the Software Engineer is not recorded in this document. This document records that acceptance of the direction and the amended text; exact final owner sign-off on every amended risk or mechanism was not independently established outside this file and is not asserted here as absent. Acceptance fixes the architecture direction and the values below as the documented design target. It authorizes no implementation, no storage, no trigger, no endpoint and no migration; those need the prerequisite evidence, a reviewed implementation design and the later testing, release-QA and production approvals. Statements about the current code (main `3b612c1`) come from earlier code reading and are **unverified**; each becomes a prerequisite in "Implementation and Validation". No test or QA result is claimed. AUT-890 and AUT-891 QA gates are not prerequisites for starting AUT-886.

Amended 2026-11-08 at the owner's direction: resolved open decisions in this revision.

## Context and Decision Drivers

The bulk price action on the parts list (`/inventory`, AUT-886) reads each part and then sends a full-body `PATCH /api/inventory/:id` (reported, unverified at `3b612c1`). The reported contract has no revision, so overlapping edits can overwrite each other. A guarded, price-only branch of the same route (`retail_price` + `expectedRevision`) fixes the overlap only if an outcome can always be recovered after a lost response, a reload, a new tab or another device.

Dejan approved these requirements on 2026-11-08; they are fixed and not reopened here:

- Durable binding of the operation intent from server acceptance, surviving business rollback.
- Authorized recovery and discovery after reload, a new tab or another device.
- Demonstrable late-request fencing before an operation is declared NOT_APPLIED.
- Not accepted as risks: rebinding the same key to a different intent after a rollback, and a lost frozen intent causing a duplicate percentage operation.

Settled product boundaries: parts list only; loaded, selected IDs, at most 100; tenant-wide prices (no site predicate); the existing route with a body of exactly `retail_price` and `expectedRevision`; legacy validation, authorization, non-disclosure, percentage and rounding unchanged; fresh authorized reads during preview before consent; consent freezes target, expected revision and operation key; no hidden re-read or repricing after consent.

## Decision

Introduce a narrow **operation journal** for guarded price operations, with acceptance separated from execution. The identifiers below are the decided names; column-level schema is left to the implementation design and must not change the semantics here.

### 1. Request and acceptance (Tx-A)

**Branch selection.** A `PATCH /api/inventory/:id` whose body contains `expectedRevision` is a guarded request. It must carry exactly `retail_price` and `expectedRevision` and an `Idempotency-Key` header holding a UUIDv7; otherwise it fails with 400 before any write. A request without `expectedRevision` is a legacy request and ignores the header, as today.

**Tx-A** is a short transaction that commits on its own, before the business transaction:

1. Check current authorization and that the item exists in the tenant. Nothing is written for an unauthorized or unknown item.
2. If no journal row exists for (tenant, principal, key), check the admission window (section 6) and insert one in state ACCEPTED (insert on conflict do nothing; a lost insert race continues with step 3). The row binds tenant, principal, item, operation kind, expected revision and the absolute target in minor units, and records the original basis, SKU and the server-set `acceptedAt`.
3. If the row exists: a different intent gets 422 without execution. The same intent locks the row (`FOR UPDATE`, 5 s wait) and returns the stored outcome if it is final, otherwise 409 `OPERATION_UNRESOLVED`. A same-key request never runs Tx-E.

The commit of Tx-A is the linearization point of the binding. The PATCH handler runs Tx-A and then Tx-E in one request; a process death between them leaves ACCEPTED.

### 2. Execution (Tx-E)

One transaction, lock order journal row, then item row:

1. Lock the journal row; continue only in state ACCEPTED. Final states never change, so the state itself is the fence.
2. Re-check current authorization (existing role check, tenant scope, no site predicate).
3. Lock the item row (tenant-scoped) and compare the expected revision.
4. Match: change only `retail_price`, write the business audit, record the post-update revision (section 9) and set APPLIED. Mismatch: set CONFLICT, with no price change, no business audit and no realtime event.

On APPLIED, price mutation, business audit and terminal journal proof commit atomically. On CONFLICT, only the terminal **journal** proof (state CONFLICT and its result metadata) commits; price, business audit and realtime stay absent. The 409 for CONFLICT is sent only after that journal commit, so durable conflict recovery survives business rollback. Realtime publication happens only after a successful price commit, never for CONFLICT or a rollback. Tx-E runs with a 10 s lock timeout and a 30 s transaction timeout; a timeout or deadlock aborts it without any write and leaves ACCEPTED. Tx-A's accepted intent binding is never erased by business rollback.

### 3. Fencing

A fence sets a row to FENCED (= NOT_APPLIED) under the same journal-row lock as Tx-E, so exactly one of them wins; a later Tx-E or same-key request finds FENCED and writes nothing. Only FENCED, APPLIED or CONFLICT on a committed journal row proves a terminal outcome. A timeout, an elapsed lease, missing or expired **receipt after retention cleanup**, a current price or revision match, or a browser acknowledgement never proves whether an operation originally ran.

- **User fence** (explicit, authorized, takes the key and the frozen intent; a different intent gets 422):
  - Row ACCEPTED: allowed from 2 min after `acceptedAt` (the lease). The lease is UX only; the lock decides, because a late-starting Tx-E could still hold the row.
  - No row, key UUIDv7 time **within** the admission window (§6): must serialize with concurrent Tx-A under the shared journal-row lock obligation (implementation must prove wait/re-read or `OPERATION_UNRESOLVED`; claiming a lock on an absent row is not proof here). Either inserts FENCED or, if Tx-A commits ACCEPTED first, applies the ACCEPTED rule. Does not reconstruct proof deleted by retention.
  - No row, key time **outside** the admission window: under journal-row lock, **wait/re-read first** per §5 race (in-flight or committed ACCEPTED, including uncommitted admission that passed pre-check). Returns stored ACCEPTED/final state or `OPERATION_UNRESOLVED`. Only if still no row after that, refuses fence insert and returns **`OUTCOME_UNAVAILABLE`** — historical unknown, not NOT_APPLIED. Key-age pre-check does not void admitted or in-flight ACCEPTED work.
  - Row final: returns the stored outcome.
- **System fence:** the retention job fences every row still ACCEPTED **24 h after `acceptedAt`** (cutoff source: server `acceptedAt` at job evaluation time, not key UUID time alone), through the same locked transition. It is a committed fence with scheduler retries and escalation, not a proof that every row resolved within 24 h without the job running. It bounds the same-principal block (section 6) and resolves rows whose item was deleted or whose principal lost access, which no user can fence.

A fence waits at most 5 s for the row lock and otherwise reports "still unresolved" (`OPERATION_UNRESOLVED` where applicable). Discovery never mutates.

### 4. State model

```
ACCEPTED ── Tx-E, revision matches ──▶ APPLIED
    ├──── Tx-E, revision differs ────▶ CONFLICT
    └──── user or system fence ──────▶ FENCED  (= NOT_APPLIED)
APPLIED | CONFLICT | FENCED ── retention (section 6) ──▶ deleted
```

No transition leaves a final state. Client acknowledgement changes no state. ACCEPTED rows are never deleted.

### 5. Race matrix

| Race | Outcome |
|---|---|
| Same key, same intent, concurrent | One Tx-E; the duplicate waits at most 5 s, then returns the stored outcome if final, else 409 `OPERATION_UNRESOLVED` |
| Same key, different intent | 422 `IDEMPOTENCY_KEY_REUSED`, no execution |
| Fence vs Tx-E | Row lock decides; exactly one wins |
| Tx-A in flight inside window vs no-row fence inside window | Journal-row lock: exactly one of FENCED insert or ACCEPTED commit wins; no authoritative NOT_APPLIED while ACCEPTED can still commit |
| Tx-A admitted before cutoff (ACCEPTED commit or in-flight insert) while key UUID time later reads outside window | Key-age pre-check applies only on **no-row admission**; fence must acquire journal-row lock, wait/re-read, return stored ACCEPTED/final outcome or `OPERATION_UNRESOLVED` — not `OUTCOME_UNAVAILABLE` and not NOT_APPLIED while uncommitted ACCEPTED may still complete |
| New fence/admission after cutoff with no row | Outside-window path returns `OUTCOME_UNAVAILABLE`; new Tx-A admission rejected with `IDEMPOTENCY_KEY_EXPIRED` |
| No-row fence outside admission window | Wait/re-read per admitted-Tx-A row above; if still no row, no FENCED insert; `OUTCOME_UNAVAILABLE` only — does not prove an operation never ran |
| Late original request after a fence | 409 `OPERATION_FENCED`, no effect |
| Fence before Tx-A (lost request) | FENCED row inserted; the later Tx-A gets 409 `OPERATION_FENCED` |
| Final journal row deleted after retention | `OUTCOME_UNAVAILABLE`, not NOT_APPLIED; no new-key retry from missing receipt |
| Different keys, same item, different principals | Item lock plus revision check: one APPLIED, one CONFLICT |
| Different keys, same item, same principal | Second refused at Tx-A with 409 `OPERATION_UNRESOLVED` until the first is final |
| Request in flight on device A, never accepted, user continues on device B | B cannot see or fence it; if a guarded change lands first, the late request gets CONFLICT by its revision check (depends on section 9) |
| Crash between Tx-A and Tx-E | ACCEPTED persists; a user or system fence resolves it |
| Legacy full-body write vs guarded operation | No coordination; the legacy write can overwrite a guarded commit |

### 6. Coordination, identity and time

- **Coordination:** at most one ACCEPTED guarded operation per (tenant, principal, item), enforced by a partial unique index, not by the browser. Legacy edits take no lock. No global exactly-once claim is made; unconditional legacy writers can still overwrite guarded commits, and revision advancement alone does not make them safe.
- **Key:** client-generated UUIDv7 in the `Idempotency-Key` header, one key per item per consent, stored by the client with the frozen intent until the outcome is final.
- **Separate clocks:** admission uses the key's UUIDv7 time (within 24 h in the past and 5 min in the future of server time, checked only on the **no-row** Tx-A insert path; a pre-filter, not proof). An existing journal row is served from storage regardless of key UUID age until retention deletes it. `acceptedAt` is server time and anchors the 2 min lease and the 24 h system fence. Retention deletes final rows 30 days after the later of their final time and the key time.
- **Non-reuse:** at deletion a key's time is more than 30 days old, so admission rejects it forever; no tombstone is needed. A different timestamp is a different key, hence a new operation under its own revision check.

### 7. Discovery, fence API and UI states

Principal-only; keys are not bearer credentials; every call needs current authorization and the principal match.

- `GET /api/inventory/price-operations` lists the caller's own rows that are ACCEPTED or final within retention (state, item, SKU, original basis, target, expected revision, `acceptedAt`, final time), with bounded pagination (fixed maximum page size in the implementation specification). Rows whose item was deleted (404) or is no longer accessible (403) are omitted, so no receipt is disclosed (authorized no-row privacy).
- `GET /api/inventory/price-operations/:key` returns one own row within retention, or **404** if no row exists (read-only; not proof of outcome). **404** is not used for unknown historical outcome on mutating routes.
- `POST /api/inventory/price-operations/:key/fence` with the frozen intent (`itemId`, `retail_price`, `expectedRevision`) performs the user fence (section 3) and returns the resulting state.

A 400, 410 or 422 describes the current attempt only; the original outcome, including a recorded 409, is read from the journal. There is no replay: a fenced or conflicting operation is redone only through a new preview, consent and key.

**Response applicability:** guarded `PATCH` (Tx-A) applies `GUARDED_REQUEST_INVALID` / `IDEMPOTENCY_KEY_EXPIRED` on **no-row admission** only — before any journal write. If a row already exists, Tx-A step 3 returns the stored outcome regardless of key UUID age. `POST .../fence`: inside-window no-row may commit FENCED; outside-window **with no row** returns `OUTCOME_UNAVAILABLE` (410); with an existing row, §3 row rules apply. `GET .../:key` stays **404** when no row (discovery never returns 410). Retained receipts remain readable until retention deletion.

Client acknowledgement is UX only: it never changes journal state and never proves that a mutation committed. **UI states per item:** Applied; Conflict (shows that the price changed, offers a new preview); Pending (ACCEPTED, under 2 min); Unresolved (ACCEPTED after 2 min, offers "Mark as not applied", which calls the fence); Not applied (FENCED); Outcome unavailable (`OUTCOME_UNAVAILABLE` after retention or expired admission). On load, the parts list calls discovery and shows unresolved and unacknowledged final operations; the per-tab client copy of keys and intents is a convenience, not the source of truth. A partial unique index violation or ambiguous uniqueness at fence time maps to `OPERATION_UNRESOLVED`, not an undifferentiated 500. All texts in German and English.

### 8. Money and responses

The target is an integer in minor units from 0 to 9,999,999,999 (99,999,999.99), written to the stored decimal without extra database rounding; percentage and rounding policy stay unchanged. Lexical forms such as `1e2` are not rejected; legacy number validation applies. Guarded responses use separate OpenAPI schemas so legacy generated unions stay untouched. Clients branch on `code`:

| Outcome | HTTP | `code` |
|---|---|---|
| APPLIED | 200 | none; guarded receipt with the new revision |
| CONFLICT | 409 | `INVENTORY_REVISION_CONFLICT` |
| Earlier operation unresolved | 409 | `OPERATION_UNRESOLVED` |
| FENCED | 409 | `OPERATION_FENCED` |
| Historical outcome unknown on POST fence (retention, never admitted, or outside admission after wait/re-read) | 410 | `OUTCOME_UNAVAILABLE` |
| Key reused with a different intent | 422 | `IDEMPOTENCY_KEY_REUSED` |
| Key older than the admission window on **no-row** PATCH admission | 410 | `IDEMPOTENCY_KEY_EXPIRED` |
| Key missing, not UUIDv7 or more than 5 min ahead; body not exactly the two fields | 400 | `GUARDED_REQUEST_INVALID` |

### 9. Revision (decision rule)

The revision mechanism depends on unverified evidence, so this ADR fixes the rule, not the outcome:

- **Default:** an integer `revision` set by a single `BEFORE UPDATE` trigger (`OLD.revision + 1`, once per UPDATE), because it also covers writers the application cannot see. No application code increments it.
- **Fallback:** application-side increments only if the trigger evidence fails (conflicting triggers, or Prisma returning a stale revision) **and** exhaustive writer coverage proves every parts-table update goes through one enforced service path (inventory grep alone is insufficient).
- **Recreate:** if any writer deletes and recreates a part under the same id, the revision must continue from the old value; if neither holds, the guarded action is deferred.

## Decisions

| # | Decision | Rationale | Would change if |
|---|---|---|---|
| 1 | Journal with separate acceptance, fenced execution and system fence | The only option that meets all three fixed requirements synchronously, without a queue | The recovery requirement is withdrawn: plain guarded PATCH |
| 2 | `Idempotency-Key` header with a UUIDv7; branch selected by `expectedRevision` | The body is fixed to two fields; the name follows the IETF Idempotency-Key draft | The CORS/proxy check shows the header is stripped: query parameter `operationKey` on the same route, same semantics |
| 3 | Principal-only discovery and user fence | Binding and the one-unresolved rule are per principal; the system fence removes the need for an operator fence | A permission for operator recovery is added under ADR-0034 |
| 4 | Lease 2 min; Tx-E lock 10 s and transaction 30 s; lock wait 5 s; system fence 24 h; admission 24 h past / 5 min future; retention 30 days | The lease exceeds the Tx-E bound four times, the system fence matches the admission window, retention far exceeds admission | Measured lock waits on the parts table exceed 10 s |
| 5 | Codes in section 8 | 409 for state outcomes; 422 for key reuse; 410 for `IDEMPOTENCY_KEY_EXPIRED` (PATCH no-row admission) and `OUTCOME_UNAVAILABLE` (POST fence when unknown history); discovery GET missing row stays 404 | The `core-api` error convention (unverified) differs: same codes in that convention |
| 6 | Storage rule: a new narrow `inventory_price_operations` table, unless the prerequisite review finds an existing pattern with independent commit, per-intent unique binding, same-lock fencing and authorized discovery, which is then reused | No such pattern is known (unverified); a separate table keeps writes off the hot parts table | The review finds such a pattern |
| 7 | ACCEPTED rows with a deleted item or lost access: system fence after 24 h, then normal retention; never executed | A committed fence is proof, needs no operator role and frees the row for deletion | Such rows must stay ACCEPTED for manual review |
| 8 | Realtime rule: the journal is never emitted; the price change is emitted after commit, explicitly from the guarded path if the extension emits before commit | Satisfies "realtime only after commit" whatever the extension does today (unverified) | — |

## Consequences

### Positive

- Binding, fencing and recovery survive rollback, crashes, reloads and device changes.
- Mutation, audit and applied proof are atomic; fence and execution cannot both win.
- No heuristic decides an outcome. System fencing targets ACCEPTED rows older than 24 h with committed job retries and escalation; lock wait timeout, job delay or principal inaccessibility can leave a row unresolved longer — that is not terminal proof by elapsed lease alone.

### Negative

- New storage, a retention-and-fence job and three small API routes.
- A principal's second guarded operation on the same item waits until the first is final (normally immediate after Tx-E; otherwise user fence after the 2 min lease, with system fencing targeted from 24 h `acceptedAt` per job retries and escalation — not a hard upper bound on unresolved time).
- Legacy writers remain unprotected; the guard is action-local.

### Neutral

- Rounding, percentage policy and legacy validation are unchanged.

## Alternatives Considered

- **Reuse an existing pattern:** only under decision 6.
- **Pending-operation field on the parts row:** serializes with the item lock but adds writes to a hot table and fits per-principal binding poorly.
- **Asynchronous queue and worker:** changes the synchronous UX and is larger.
- **Advisory or browser locks:** not durable.
- **Rejected:** keeping the binding only inside the business transaction (it disappears on rollback) and accepting the duplicate-percentage risk.
- **Deferral:** applies if the section 9 rule leaves no usable revision mechanism.

## Implementation and Validation

No implementation is authorized. Prerequisite evidence, none gathered yet:

- Writer and bypass coverage for the parts table (raw and nested writes, `upsert`, jobs, imports, delete/recreate under the same id), feeding the section 9 rule.
- Trigger evidence: single trigger, coexistence with other triggers, Prisma return values after the trigger, backfill, integer width and fail-closed overflow.
- Database version, lock levels, rollout and rollback compatibility, and a writer lock graph for the journal-then-item order (lock ordering alone does not prove deadlock freedom).
- Existing operation patterns and the `core-api` error convention (decisions 5 and 6).
- CORS and proxy pass-through of the `Idempotency-Key` header (decision 2).
- Realtime extension timing relative to commit (decision 8).

Later tests (not yet written or run) must cover atomic success, every race-matrix row (including cutoff edge with already-admitted Tx-A), same-key rejection after a rollback, lost-response, crash, user and system fence, admission and retention boundaries, the UI states, the frozen preview flow, and the existing selection, legacy, permission and mobile regressions. Proof that no-row fence paths honor the journal-row lock obligation (wait/re-read, not false `OUTCOME_UNAVAILABLE`) is an implementation-design prerequisite, not established here. Full end-to-end runs stay in CI; performance benchmarks belong in nightly runs.

## Pragmatic Enforcer Analysis

Necessity **7/10**: an unrecoverable outcome after a lost response risks a duplicate price change on real parts. Complexity **6/10**: one table, a short acceptance step, a row-lock fence, one job for fencing and retention, and three small routes; no queue and no change to legacy writers. Ratio **0.86**, below 1.5. The simpler guarded PATCH without a journal remains the fallback only if the approved recovery requirement is withdrawn.

## References

- [ADR-0010: OpenAPI contract](2026-04-12-openapi-contract-first.md)
- [ADR-0011: Atomic status transition guards](2026-04-12-atomic-status-transition-guards.md)
- [ADR-0013: Tenant isolation](2026-04-15-row-level-multi-tenancy.md)
- [ADR-0034: Custom tenant roles](2026-11-02-custom-tenant-roles.md)
- [ADR-0035: Cursor-based infinite lists](2026-11-02-cursor-based-infinite-lists.md)
- [ADR-0036: Frontend interaction rules](2026-11-02-frontend-interaction-rules.md)

## Linear Tracking

AUT-886 (parts bulk price action). This ADR assigns no implementation issue and does not close AUT-886.
