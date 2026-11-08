---
title: "ADR-0037: Authoritative Scope Context for Cursor Lists"
date: "2026-11-08"
status: proposed
deciders: "Dejan Dosenovic (Product Owner); review by Product Planner and Software Engineer"
tags: [adr, platform, tables, security, multi-tenancy, sessions]
---

# ADR-0037: Authoritative Scope Context for Cursor Lists

## Status

**Proposed — 2026-11-08.** This is a decision packet for review by the Product Planner and the Software Engineer, then Dejan's concrete decision. It changes documentation only.

The owner approved the planning *direction* on 2026-11-08 (09:34 MEZ): mandatory expected context, server-verified session continuity, coherent authorization, and one shared safety and recovery contract. **No concrete architecture, storage, schema, API, token or protocol is approved.** Every name, structure and interface below is a recommendation, not an adopted contract. Implementation, including shared prerequisites, is not authorized. Specification, implementation and release approvals stay separate.

If accepted, this ADR would amend [ADR-0035](2026-11-02-cursor-based-infinite-lists.md) §2 (the explicit page-one restart after an incompatible cursor becomes one budgeted automatic restart) and §6/§7 (a changed authoritative context becomes a reset trigger). Until then ADR-0035 stands unchanged.

Observed facts (marked *Observed*) come from reading `main` at `9284e46`. They are not independently audited; the Software Engineer re-verifies them before acceptance. This ADR claims no QA acceptance and no PASS.

## Context and Decision Drivers

[ADR-0035](2026-11-02-cursor-based-infinite-lists.md) binds a cursor to tenant and authorized site and requires fresh authorization on every request. It does not protect a *client* that keeps protected rows, counts, selection or scroll anchors after its access changed, and it cannot tell a server that a cached chain belongs to an old principal, session or permission set.

*Observed*:

- The cursor binds the endpoint, sort, direction, filter hash, tenant and site. It carries no principal, session or permission-version binding.
- Requests are authorized from current database state on every request, so a cursor never grants access.
- Scope changes reach the web app as best-effort websocket events (claims, site context, site access scope). The site-access-scope handler only invalidates site queries; it does not reset list caches or selection.
- On reconnect and when a hidden tab becomes visible, a resync invalidates the session, site and realtime-backed queries, so the client re-reads its *current* session and sites. That cannot detect A→B→A or a scope change that goes unnoticed while the socket stays connected, does not reset list caches or selection, and gives the server no way to reject a stale client context.
- `User`, `TenantMember` and `SiteMembership` carry timestamps but no persisted, monotonic scope version today. [ADR-0034](2026-11-02-custom-tenant-roles.md) (also Proposed, not implemented) would add `TenantRole.version`, `TenantMember.authorization_version` and an opaque `permissionsVersion`. Its client detection relies on events, a refetch after a 403 or tenant change, and a refetch on reconnect.
- The shared web cursor hook throws a generic `Error` for any non-OK response, so the typed 400 cursor codes (`LIST_CURSOR_INVALID`, `LIST_CURSOR_SORT_UNSUPPORTED`, `LIST_CURSOR_STOCK_FILTER_REQUIRED`) and 401/403/422 are indistinguishable to callers. No context-mismatch failure type exists yet. The app-wide query default is one automatic retry.

Drivers:

- A later 403 is not detection. A fingerprint of *current* rights misses A→B→A. Missed events must not leave a stale scope accepted by the server.
- Tenant/site isolation (ADR-0013, ADR-0022) and each consumer's business permissions and visibility stay unchanged.
- No global authorization rewrite and no safety opt-out.

## Fixed Requirements (approved direction)

1. Expected context is mandatory on cursor **and** count requests; omission cannot bypass validation.
2. Server-verified session continuity.
3. A coherent authorization decision over permission state, scope epoch and data.
4. One shared safety and recovery contract for the invoice, inventory and vehicle-stock cursor consumers and the later Sales Orders wave.
5. Legacy offset behavior and each consumer's permissions and visibility are preserved.

## Decision (recommended; subject to the open choices below)

### 1. Scope Context

The server mints an opaque, signed *Scope Context* (SC) only after full fresh validation. It binds: principal reference, continuity id, tenant, site, a principal-tenant scope epoch, a tenant-authorization epoch and a policy version. An SC is context metadata, not a credential: normal credentials still authorize every request. Raw credentials and session secrets never appear in cursors or cache keys; both use an SC digest.

### 2. History-sensitive epochs

Monotonic counters advance in the **same transaction** as every database-backed writer of effective access: role assignment, grant-changing role-definition edits, membership create/activate/deactivate/remove, and user and site transitions. Counters only increase, so A→B→A is detected. Writer coverage uses one shared transactional helper and an inventory test that fails on any unregistered writer (raw SQL, seeds and admin tools included). If ADR-0034 is accepted and implemented, its `authorization_version`, role versions and `permissionsVersion` are the candidate source of the role and membership component; site membership, user and site status and continuity are not covered by it as read and need their own coverage.

### 3. Session continuity

The server mints an opaque continuity id per authenticated session lineage. A normal credential refresh keeps it only when the server proves lineage; reauthentication issues a new one; logout and revocation end it; each device has its own. Continuity means "same lineage"; it never means "currently valid". Validity is evaluated per request.

### 4. Decision point and coherent read

After authentication, one database snapshot reads membership and activation, permissions, both epochs and the authoritative time (demo and time expiry), then the data.

- The server compares the bound *components* of the expected SC (principal, continuity id, tenant, site, both epochs, policy version) with the snapshot's, not token bytes, and returns a typed `CONTEXT_MISMATCH` iff any component differs.
- A relevant change committed before the snapshot, meaning one that advanced a component bound in the SC, rejects an old context. A change that advances no bound component does not reject, and a correct new context is not rejected merely because a mutation occurred. With a coarse (tenant-wide) epoch granularity, an unrelated role edit in the same tenant can advance a bound component and reject; that over-invalidation is the cost named in the open choices.
- A later commit cannot recall delivered bytes; the next old-context request rejects.
- A second epoch read in the same snapshot is not independent freshness evidence, so none is made.
- Existing 401, 403 and 422 outcomes take precedence when scope is unusable.

### 5. Authorities outside the database snapshot

- **Time expiry is not a writer.** It is evaluated against authoritative time at the snapshot, not by an epoch increment.
- **Identity-provider revocation and claim freshness** is separate and not atomic with the database: verify per request with a revocation check or a bounded token age, and fail closed when verification is unavailable. The staleness bound is an owner choice.
- **Policy deployment**: a policy version derived from deployed policy content; a mismatch is a context mismatch. Coupling to the deploy pipeline is a proof obligation.
- An epoch covers revocation or policy invalidation only where it is demonstrably coupled to that authority; otherwise separate freshness requirements apply. No global external atomicity is claimed.

### 6. Handshake and quarantine

A handshake endpoint (proposed) performs fresh authentication and authorization, then returns the SC. On resume, focus, reconnect and online, protected cached content stays quarantined until the handshake succeeds. An unchanged epoch alone does not release it: current credential validity, membership, activation and expiry are re-evaluated. A handshake failure leaves content blocked with manual retry. Offline revocation is not instant, and delivered bytes are not recalled.

A lifecycle handshake is not a recovery of a failed request and does not spend the episode budget in §9:

- It returns the same SC: the quarantined content is released.
- It returns a different SC for the same tenant and site (an external scope change): pages, counts, selection and anchors are flushed, late results fenced, and the list stays blocked until an explicit user refresh (ADR-0035 §7). No page-one restart runs automatically.
- It returns an SC for a different tenant or site, or a different principal: this is a genuine context switch. The central session reset runs (ADR-0035 §6) and a new episode starts.

### 7. Requests and rollout

The expected SC is mandatory on the cursor list **and** the count request of every contracted consumer. Omission returns a typed `CONTEXT_REQUIRED`. Roll out under a versioned, coordinated compatibility path: the server issues and echoes the SC, the web app sends it, then the server enforces it. Existing direct clients are inventoried, notified and given a window rather than broken silently. Offset endpoints are unaffected.

Requirement 1 holds only once enforcement is on. During the compatibility window an omitted SC is accepted, so the protections are advisory only. No consumer counts as covered by this contract, and the Sales Orders gate in "Gates and Sequencing" is not met, before enforcement is on for both the cursor and the count endpoint of that consumer.

### 8. Binding

A cursor binds the SC digest, endpoint, sort, direction and the resolver fingerprint. Cache keys use the SC digest. A response whose echoed context differs from the client's validated context is discarded.

### 9. One shared recovery contract

```
Episode key = semantic user query + genuine user context switch
(recovery contexts, epochs, generations and successes never rearm it)

READY -next page | count-> LOADING
LOADING -ok-> READY
LOADING -CONTEXT_MISMATCH | CONTEXT_REQUIRED (page or count) | CURSOR_INVALID (page)->
    singleflight; QUARANTINE + FLUSH + fence late results
    budget 1 -> (context errors only) handshake:
        same tenant, site and principal -> restart page 1, budget 0
        different tenant, site or principal -> central session reset, NEW episode,
                                               no restart of the old query
        (CURSOR_INVALID with valid context -> restart page 1, budget 0, no handshake)
    budget 0 -> BLOCKED (manual)
handshake failure -> BLOCKED (manual)
LOADING -401 | 403 | 422-> QUARANTINE + FLUSH + fence late results -> BLOCKED (never automatic)
LOADING -UNSUPPORTED_SORT-> latch offset at offset 0, keep sort and filters
LOADING -other or network error-> ERROR (not a restart or resync)
ERROR -manual retry-> LOADING (same episode, budget unchanged)
BLOCKED -manual retry | explicit user refresh | new semantic query | user context switch-> new episode
```

- One total automatic action per episode is shared by page and count and by all failure types, so alternating errors cannot multiply attempts. A realtime event, focus or lifecycle refresh never starts a new episode by itself. The one exception is a handshake that reveals a genuine context switch (different tenant, site or principal), which runs the central session reset and starts a new episode.
- Lifecycle and recovery share one singleflight handshake per client context. If both are triggered at once, a tenant, site or principal change takes precedence over a restart or a block.
- The asymmetry is intended: a failed request interrupts a load the user just started, so one budgeted automatic restart finishes that load. A lifecycle handshake runs while the user may be reading or mid-action, so an external scope change there blocks until an explicit user refresh (ADR-0035 §7) instead of replacing the list underneath them.
- Quarantine, flush and late-result fencing remain mandatory when the budget is spent.
- `LIST_CURSOR_STOCK_FILTER_REQUIRED` (vehicle stock) is not a recovery case. It keeps its existing handling and is outside this contract.
- `CONTEXT_REQUIRED` reaching a web client that always sends the SC signals version skew. It follows the context-mismatch path once and then stops.
- Library-level automatic retry is disabled for every typed scope or cursor error (`CONTEXT_MISMATCH`, `CONTEXT_REQUIRED`, the cursor codes) and for 401, 403 and 422, overriding the one-retry default. The only automatic scope or cursor action is the budgeted one. Whether transport and 5xx retries of an identical request remain is an open choice; they are never a restart or resync.

### 10. Page and count identity

Page and count acceptance use separate generations. Count identity binds **all** resolved effective filters and the SC digest, but not sort. A sort-only change keeps the count only while filters and validated context are unchanged, no invalidation or explicit refresh occurred, and the echoed context matches. The page fingerprint adds endpoint, sort and direction. One resolver feeds rows, count and fingerprint. Scope invalidation flushes protected pages, counts, selection and anchors.

## Open Choices for the Owner

| Choice | Notes |
|---|---|
| Token form | Signed self-contained, or a server-side reference |
| Epoch granularity for role definitions | Per role, or tenant-wide; the cost is over-invalidation |
| Snapshot isolation level | Versus a validate-after-read alternative |
| Identity-provider freshness mechanism and staleness bound | Revocation latency is unmeasured |
| Policy-version derivation | Content digest versus pipeline-coupled |
| Transport of the SC | Header versus query |
| Rollout windows for direct clients | Needs the client inventory |
| Transport and 5xx retry of an identical request | Keep the default, or disable on cursor requests; never a restart or resync |
| Storage of continuity ids | |
| Relationship to ADR-0034 | Reuse its versions, or a separate epoch; sequencing if ADR-0034 is not accepted first |

## Alternatives Considered

| Option | Why not chosen |
|---|---|
| Reuse an existing mechanism | Only if later proven equivalent. None is shown; ADR-0034's versions are proposed, unimplemented and cover only part of the scope |
| Epoch without continuity | Misses refresh lineage and other-device isolation |
| Fingerprint of current rights | Misses A→B→A |
| Events plus a refetch after a 403 | Lossy, and a later 403 is not detection |
| Deferral | Remains the outcome if the proof obligations cannot be met |

An unsafe opt-out is not an alternative.

## Consequences

- Positive: stale or foreign-principal content is rejected by the server even when events are missed; recovery cannot loop; old-session replay is rejected.
- Negative: a coverage obligation across all access writers; extra snapshot reads on the cursor hot path; a client rollout and a coordinated server change; possible over-invalidation.
- Neutral: no business entity, fiscal rule or visibility change. Accepted design does not mean deployed behavior.

## Validation and Proof Obligations

Nothing here has been run. Names are proposals, not existing files.

**Six focused scenarios, each one test.** These are carried from the Sales Orders wave plan. Only `salesOrders_missed_event_epoch_replay`, `cursorScope_resync_rejects_late_results` and `cursorRecovery_shared_episode_budget` test the contract of this ADR. The timestamp, exact-count and explicit-refresh rows test keyset, count and ADR-0035 §7 behavior of the Sales Orders wave and belong to its specification; they are listed here only because the wave plan names them.

| WHEN / THEN | Proposed test | Runner |
|---|---|---|
| Static tied timestamps are paged under a non-UTC runtime → tuples round-trip and order correctly | `salesOrders_static_timestamp_roundtrip` | backend e2e |
| 1,000 versus 1,001 authorized matches → the capped count distinguishes them | `salesOrders_exact_count_boundary` | backend e2e |
| An external role definition changes A→B→A with websocket delivery suppressed → the old expected scope is rejected | `salesOrders_missed_event_epoch_replay` | backend e2e |
| A resync invalidates the context before delayed page and count responses resolve → neither repopulates the cache | `cursorScope_resync_rejects_late_results` | web unit |
| Concurrent invalid-cursor failures recover and then fail again in one episode → one automatic restart | `cursorRecovery_shared_episode_budget` | web unit |
| A `SALES_ORDER` realtime event arrives → retained rows stay unchanged until an explicit fresh-chain refresh | `salesOrders_explicit_realtime_refresh` | web unit |

**Supporting coverage for the shared requirements** (unlimited; each is a separate test, per consumer where the consumer differs):

- `CONTEXT_REQUIRED` on omission, for the count request as well as the page request, on each contracted consumer once enforcement is on.
- No automatic retry of 401, 403 and 422, and none of the typed scope or cursor errors.
- Unsupported sort latches offset at offset 0 and keeps filters and sort.
- Replay of an old continuity id is rejected, including from another device.
- A→B→A on membership, site grant and user or site status, not only on a role definition.
- Fencing and quarantine continue after the budget is exhausted.
- A lifecycle handshake that returns a changed SC flushes and blocks without an automatic restart.
- Invoice, inventory and vehicle-stock consumers keep their existing regressions after the shared change.

New behavior follows the TDD workflow in `agents.md`: each new test must fail against the pre-change code. Characterization baselines are used only to pin existing, correct behavior that the change must not alter.

Before acceptance:

- **Writer coverage** and transactional coupling of every access-relevant writer.
- **Identity provider**: revocation latency and refresh-lineage verifiability.
- **Deployment**: policy-deployment authority.
- **Clients**: an inventory of direct API clients.
- **Cost**: that snapshot reads and over-invalidation are acceptable.
- **Environment**: schema and collation, Prisma behavior under a non-UTC runtime, real query plans, the live URL and mobile card capability, and QA acceptance on the released build.

## Gates and Sequencing

The Sales Orders wave (AUT-891) starts only after all of the following are documented; none is today:

1. AUT-890 pilot QA acceptance.
2. Invoice-wave QA acceptance.
3. Approval of the corrected Sales Orders specification.
4. An accepted decision on this ADR, or a demonstrated accepted equivalent.

Merges, reviews and scratch probes do not replace these. Sales Orders query plans and QA are completion evidence. If shared defects block the predecessors, a bounded prerequisite correction is proposed separately for explicit owner approval; this ADR authorizes none. Shared changes require renewed relevant regressions before rollout.

## Sales Orders Wave: Settled Scope (planning input)

**Preserved behavior:** cursor-only default `createdAt DESC, id DESC`; database text ordering for `order_number`; exact tenant, active-site and null-site visibility and existing permissions; Saved Views and live-URL compatibility; effective legacy `params` computed after the status override, with remaining filters forcing the unchanged offset fallback; raw wire search; exact 1,000 versus 1,001 capped count; an independent 2,000 loaded-row ceiling; no snapshot or no-gap guarantee on mutable data; the existing DRAFT-only Delete with its endpoint, permission, state restriction and confirmation.

**New fixed requirements of the wave, not current behavior:** the card shows date plus vehicle, and the DRAFT Delete becomes a registry action reachable through Cmd+K with a visible mobile path. Today it is a right-click context action with a browser confirmation. Whether the existing card supports a second detail line is unverified.

No Sales Orders selection is introduced.

## References

- [ADR-0013: Row-level multi-tenancy](2026-04-15-row-level-multi-tenancy.md)
- [ADR-0022: Site operational scope](2026-08-31-site-operational-scope.md)
- [ADR-0034: Custom tenant roles](2026-11-02-custom-tenant-roles.md)
- [ADR-0035: Cursor-based infinite lists](2026-11-02-cursor-based-infinite-lists.md)
- [ADR-0036: Frontend interaction rules](2026-11-02-frontend-interaction-rules.md)

## Linear Tracking

Part of AUT-891. This ADR does not complete the issue or claim QA acceptance.
