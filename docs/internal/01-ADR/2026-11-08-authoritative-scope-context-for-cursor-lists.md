---
title: "ADR-0038: Authoritative Scope Context for Cursor Lists"
date: "2026-11-08"
status: accepted
deciders: "Dejan Dosenovic (Product Owner)"
tags: [adr, platform, tables, security, multi-tenancy, sessions]
---

# ADR-0038: Authoritative Scope Context for Cursor Lists

## Status

**Accepted — 2026-11-08.** Merged repository status (not rollout or feature QA acceptance). Accepted on the owner's instruction in the AUT-891 session. The document records Dejan Dosenovic as decider for that acceptance of **planning direction** only. Several rounds of automated model review preceded merge; they do not substitute for human review.

On **2026-11-08** (09:34 MEZ) the owner fixed the direction: mandatory expected context, server-verified session continuity, coherent authorization, and one shared safety and recovery contract. Sections 1–10 record that design target. Names marked "recommended" (secret, header, table) are proposed names, fixed in the implementation specification. **Implementation, including shared prerequisites, is not authorized by this ADR alone.** Wave specification, implementation and release approvals stay separate where not closed below.

This ADR amends [ADR-0035](2026-11-02-cursor-based-infinite-lists.md) §2 (the explicit page-one restart after an incompatible cursor becomes one budgeted automatic restart) and §6/§7 (a changed authoritative context becomes a reset trigger). The amendment takes effect for a consumer when that consumer's enforcement is on (§7); until then ADR-0035 stands for it.

**Amended 2026-11-09** (Product Planner + ACP Software Engineer under Dejan Dosenovic's delegation of 2026-11-09; AUT-932): the three formerly still-open Resolutions items are decided (B1–B3) and context-error statuses are fixed (B4). This amendment records these contract deltas against the 2026-11-08 text:

- **B1:** hot-path ID-token expiry (reject expired tokens); maximum IdP-only staleness while database membership still authorizes is ID-token lifetime (60 minutes); handshake verifies revocation with `checkRevoked=true`; no per-request revocation on list/count.
- **B2:** no compatibility window; clients without expected context receive `CONTEXT_REQUIRED`; 7-day read-only log query on list and count routes is evidence only, not a gate.
- **B3:** HMAC continuity digest (subject + authentication time) with the ended-lineage table is the approved continuity mechanism; same-subject, same-second alias is an accepted risk (see fixed requirement 2 and §3).
- **B4:** `CONTEXT_REQUIRED` → HTTP 428, `CONTEXT_MISMATCH` → HTTP 412 (client-safe envelope); consumer parameter-validation 400s rank after context codes and are §9 "other 4xx" (no automatic retry, not budgeted); recovery shorthands `CURSOR_INVALID` / `UNSUPPORTED_SORT` unchanged.

Observed facts (marked *Observed*) come from reading `main` at `9284e46`. They are not independently audited; the Software Engineer re-verifies them in the implementation specification. This ADR claims no QA acceptance and no PASS.

## Context and Decision Drivers

[ADR-0035](2026-11-02-cursor-based-infinite-lists.md) binds a cursor to tenant and authorized site and requires fresh authorization on every request. It does not protect a *client* that keeps protected rows, counts, selection or scroll anchors after its access changed, and it cannot tell a server that a cached chain belongs to an old principal, session or permission set.

*Observed*:

- The cursor binds the endpoint, sort, direction, filter hash, tenant and site. It carries no principal, session or permission-version binding.
- Requests are authorized from current database state on every request, so a cursor never grants access. The session is resolved by separate reads outside one transaction (Postgres default isolation), and the active site comes from `User.active_site_id`.
- Authentication calls `verifyIdToken` without a revocation check. There is no server-side logout endpoint. Refresh tokens are revoked only together with security-sensitive membership changes.
- Cursors are unsigned base64url JSON (`LIST_CURSOR_VERSION = 1`). A signed-token pattern (HMAC with `timingSafeEqual`, secret from `config/env.ts`) exists elsewhere in the API.
- Authorization policy is code (`OPERATION_TABLE` per controller method and `PERMISSION_CATALOGUE_VERSION`), shipped in the Cloud Run image; no database role definitions exist yet.
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
2. **Independently authenticated session continuity:** distinct sign-ins and lineages (including other devices) must be isolatable server-side; a stale lineage must not be treated as current, **except** the same-subject, same-second alias accepted under B3 (2026-11-09). The approved continuity digest in §3 implements this contract.
3. A coherent authorization decision over permission state, scope epoch and data.
4. One shared safety and recovery contract for the invoice, inventory and vehicle-stock cursor consumers and the later Sales Orders wave.
5. Legacy offset behavior and each consumer's permissions and visibility are preserved.

## Decision

### 1. Scope Context

The server mints an opaque *Scope Context* (SC) only after full fresh validation. It is signed with HMAC-SHA-256 under a dedicated secret (recommended name `SCOPE_CONTEXT_HMAC_SECRET`, held in the secret manager); the current and previous key are accepted during rotation, and a rotated key surfaces as `CONTEXT_MISMATCH`. It carries no expiry, because validity is evaluated per request. It binds: principal reference, continuity id, tenant, site, a principal-tenant scope epoch, a tenant-authorization epoch and a policy version. An SC is context metadata, not a credential: normal credentials still authorize every request. Raw credentials and session secrets never appear in cursors or cache keys; both use an SC digest.

### 2. History-sensitive epochs

Monotonic counters advance in the **same transaction** as every database-backed writer of effective access: role assignment, grant-changing role-definition edits (which advance the principal-tenant epoch of every assigned member in the same transaction), membership create/activate/deactivate/remove, and user and site transitions. The tenant-authorization epoch advances only on tenant, legal-entity and site activation changes. Today role definitions are code, so the policy version (§5) covers them. Counters only increase, so A→B→A is detected. Writer coverage uses one shared transactional helper and an inventory test that fails on any unregistered writer (raw SQL, seeds and admin tools included).

ADR-0034's versions are not reused: its `authorization_version` fences a narrower set of writers and does not cover site membership, site status or continuity, and tying this ADR to a Proposed one is avoided. If ADR-0034 is accepted, each authorization writer it adds must also advance the scope epoch through the shared helper and appear in the writer-coverage inventory.

### 3. Session continuity

**Required contract** (fixed requirement 2): the server must be able to reject a context whose lineage is no longer current, including replay from another device or an ended sign-in, **subject to the B3 same-subject, same-second alias exception.** The approved continuity digest below implements this contract.

**Continuity digest** (decided B3, 2026-11-09): the HMAC continuity digest (subject + authentication time from the verified token) together with the ended-lineage table written by a new authenticated logout endpoint (recommended name `ended_session_lineages`) is the approved continuity mechanism.

A normal credential refresh keeps the authentication time, so the digest is unchanged; reauthentication or a new sign-in sets a new authentication time and a new digest. Explicit logout on the same principal, tenant and site records the ended lineage in the table, read in the §4 snapshot; a row may be pruned only once a later refresh-token revocation covers its authentication time **and** the maximum ID-token lifetime has passed since that revocation. **User session lifecycle** (logout, reauthentication or a new sign-in on the same principal, tenant and site): the prior lineage is ended, old SCs fail closed (401 via ended lineage and/or digest mismatch), protected caches are quarantined, and the client starts a **new** §9 episode with the normal initial recovery budget for that new episode. That is not rearming the prior episode's spent budget. A refresh-token revocation ends all lineages at the next handshake and on list and count requests within the token-expiry bound (§5).

**Deterministic alias (accepted risk, B3):** two independently authenticated sign-ins in the same UTC second receive the same digest. This is a **same-subject/authentication-time alias**, not a random HMAC collision and not evidence of a cross-user or cross-tenant leak. The same-subject, same-second alias is an accepted risk: it never crosses principal, tenant or site; its effects are that a logout ends both aliased sign-ins (fail closed) and that one aliased sign-in's context is accepted by the other for the same principal with identical rights, while credentials still authorize every request. Fixed requirement 2 is met except for the same-subject, same-second alias, which is accepted as a risk. Continuity means "same lineage digest"; it never means "currently valid". Validity is evaluated per request.

### 4. Decision point and coherent read

After authentication, the shared cursor list and count helper (and the handshake) opens one read-only `REPEATABLE READ` transaction. It reads membership and activation, the active site membership, site and legal-entity activity, both epochs, the ended-lineage record and the authoritative time (demo and time expiry), compares them with the SC, then reads the data. An ended lineage returns 401 on the list, count and handshake requests and ranks with the 401, 403 and 422 outcomes in the precedence order below. The authentication guard is not rewritten. A validate-after-read design is not used.

- The server compares the bound *components* of the expected SC (principal, continuity id, tenant, site, both epochs, policy version) with the snapshot's, not token bytes, and returns a typed `CONTEXT_MISMATCH` iff any component differs.
- A relevant change committed before the snapshot, meaning one that advanced a component bound in the SC, rejects an old context. A change that advances no bound component does not reject, and a correct new context is not rejected merely because a mutation occurred. The tenant-authorization epoch is tenant-wide, so a tenant, legal-entity or site activation change can reject contexts of members it does not affect; that rare over-invalidation is accepted. Role-definition edits advance only the epochs of assigned members.
- A later commit cannot recall delivered bytes; the next old-context request rejects.
- A second epoch read in the same snapshot is not independent freshness evidence, so none is made.
- Existing 401, 403 and 422 outcomes take precedence when scope is unusable. Precedence is: 401, 403 or 422; then `CONTEXT_REQUIRED` or `CONTEXT_MISMATCH`; then the cursor codes. `CONTEXT_REQUIRED` is returned with HTTP 428, `CONTEXT_MISMATCH` with HTTP 412, both in the standard API error envelope and listed among the client-safe error codes (B4). Parameter-validation 400s of a consumer rank after the context codes for precedence and fingerprinting; they are §9 "other 4xx" (no automatic retry, not budgeted), not context-recovery cases. `CURSOR_INVALID` and `UNSUPPORTED_SORT` remain state-machine shorthands for `LIST_CURSOR_INVALID` and `LIST_CURSOR_SORT_UNSUPPORTED`. A `LIST_CURSOR_INVALID` response therefore implies that the expected SC matched the snapshot.

### 5. Authorities outside the database snapshot

- **Time expiry is not a writer.** It is evaluated against authoritative time at the snapshot, not by an epoch increment.
- **Identity-provider revocation and claim freshness** is separate and not atomic with the database snapshot. Membership, activation and site scope are evaluated on every request from current database state in the §4 snapshot; this ADR does not bypass those checks. The list and count **hot path** rejects expired ID tokens; the handshake verifies the ID token with revocation checking (`checkRevoked=true`, covering disabled and revoked users) and fails closed. The accepted maximum staleness for an identity-provider-only disable or revocation, while database membership still authorizes the principal, is the ID-token lifetime (60 minutes). Database-visible revocations are caught immediately by the epochs. No per-request revocation call is made (decided B1, 2026-11-09).
- **Policy deployment**: the policy version is a content digest computed at boot over the operation entries of the contracted routes, the permission catalogue version and the demo request mask for those routes. It ships with the image, so it is not tied to the deploy pipeline. While old and new revisions both serve after a digest change, a request can see a mismatch, take the one restart and end blocked; that fails closed.
- An epoch covers revocation or policy invalidation only where it is demonstrably coupled to that authority; otherwise separate freshness requirements apply. No global external atomicity is claimed.

### 6. Handshake and quarantine

A handshake endpoint (name and shape fixed in the implementation specification) performs fresh authentication (including an identity-provider revocation check) and authorization, then returns the SC. On resume, focus, reconnect and online, protected cached content stays quarantined until the handshake succeeds. An unchanged epoch alone does not release it: current credential validity, ended lineage, membership, activation and expiry are re-evaluated. A handshake failure leaves content blocked with manual retry. Offline revocation is not instant, and delivered bytes are not recalled.

A lifecycle handshake is not a recovery of a failed request and does not spend the §9 recovery budget of the current episode (except where a pending recovery handshake counts as that recovery's handshake per §9):

- It returns the same SC: the quarantined content is released.
- It returns a different SC for the same tenant and site because **scope epochs or policy** changed while the user session is unchanged (external scope change): pages, counts, selection and anchors are flushed, late results fenced, and the list stays blocked until an explicit user refresh (ADR-0035 §7). No page-one restart runs automatically; the episode key is unchanged.
- It returns a different SC for the same tenant and site because **user session lifecycle** changed (logout, reauthentication or new sign-in — new continuity digest, §3): ended-lineage rules apply, caches are quarantined, a **new** §9 episode starts with a fresh initial recovery budget; this is not the external-scope flush/block-only path above.
- It returns an SC for a different tenant or site, or a different principal: a genuine tenancy/principal context switch. The central session reset runs (ADR-0035 §6) and a new episode starts.

### 7. Requests and rollout

The expected SC is mandatory on the cursor list **and** the count request of every contracted consumer. Omission returns a typed `CONTEXT_REQUIRED`. There is **no** compatibility window (decided B2, 2026-11-09): enforcement starts in the release in which the web app sends the SC, and a client without the expected context receives `CONTEXT_REQUIRED`. The enforcing change records a read-only log query (user agent and origin on the three list and three count routes, 7 days) as evidence; it is not a gate. Offset endpoints are unaffected.

A consumer counts as covered by this contract only after enforcement is on for both its cursor list and its count endpoint. For Sales Orders, turning that enforcement on is **rollout/completion** work on endpoints defined in the wave specification, not a precondition that those endpoints already exist before implementation starts (see "Gates and Sequencing").

### 8. Binding

The SC travels in a request header (recommended name `X-ACP-Scope-Context`) on the cursor list and count requests, never in the query string, which would reach request logs and error-tracking URLs. Responses return the SC digest in the body (`meta` for pages, a sibling field for the count) and are `Cache-Control: private, no-store`. A cursor binds the SC digest, endpoint, sort, direction and the resolver fingerprint; the cursor payload moves to version 2 and stays unsigned, because the server compares its digest with the digest of the presented, verified SC and authorizes freshly on every request. Version 1 cursors return `LIST_CURSOR_INVALID` and take the budgeted restart. Cache keys use the SC digest. OpenAPI and generated types are regenerated (ADR-0010). A response whose echoed context differs from the client's validated context is discarded.

### 9. One shared recovery contract

```
Episode key = semantic user query + episode counter
  Reset (new episode, fresh initial budget 1) on:
    user session lifecycle on same principal/tenant/site (logout, reauth, new sign-in),
    or different tenant, site or principal (handshake or user switch)
  Unchanged episode on:
    external scope change (epochs/policy) on same session — flush/block per §6, budget unchanged
Recovery within one episode (CONTEXT_MISMATCH / LIST_CURSOR_INVALID restart, or
handshake that only refreshes the same session SC after a budgeted recovery) —
never rearm a spent budget (budget 0 stays 0)

READY -next page | count-> LOADING
LOADING -ok-> READY
LOADING -CONTEXT_MISMATCH | CONTEXT_REQUIRED (page or count) | LIST_CURSOR_INVALID (page;
    recovery shorthand CURSOR_INVALID)->
    singleflight; QUARANTINE + FLUSH + fence late results
    budget 1 -> (context errors only) handshake:
        user session lifecycle on same tenant/site/principal (§3, §6) ->
            NEW episode, fresh initial budget; pending recovery on the old episode is abandoned
        same tenant, site and principal, same user session (pending budgeted recovery) ->
            restart page 1, budget 0 (wins over external-scope-only flush below)
        same tenant, site and principal, external scope change only (epochs/policy),
            lifecycle-only handshake (not this pending recovery handshake) ->
            flush/block per §6; no automatic page-one restart; episode unchanged
        different tenant, site or principal -> central session reset, NEW episode,
                                               no restart of the old query
        (LIST_CURSOR_INVALID with valid context -> restart page 1, budget 0, no handshake)
    budget 0 -> BLOCKED (manual)
handshake failure -> BLOCKED (manual)
LOADING -401 | 403 | 422-> QUARANTINE + FLUSH + fence late results -> BLOCKED (never automatic)
LOADING -LIST_CURSOR_SORT_UNSUPPORTED (recovery shorthand UNSUPPORTED_SORT)->
    OFFSET (latched for the episode, offset 0, keep sort and filters)
LOADING -network error or 5xx (after at most one identical retry, same generation) | other 4xx-> ERROR (not a restart or resync)
ERROR -manual retry-> LOADING (same episode, budget unchanged)
BLOCKED -manual retry | explicit user refresh | new semantic query | user context switch-> new episode
```

- Canonical API codes are `LIST_CURSOR_INVALID` and `LIST_CURSOR_SORT_UNSUPPORTED` (ADR-0010 / OpenAPI). The recovery state machine uses the shorthands `CURSOR_INVALID` and `UNSUPPORTED_SORT` for the same outcomes. One total automatic action per episode is shared by page and count and by all scope and cursor-recovery failure types (`CONTEXT_MISMATCH`, `CONTEXT_REQUIRED`, `LIST_CURSOR_INVALID`), so alternating errors cannot multiply attempts. The unsupported-sort latch is a one-way mode switch for the episode, not a budgeted action. A realtime event, focus, or an external-scope lifecycle handshake never starts a new episode. A new episode starts only on user session lifecycle or tenant/site/principal switch (§6, episode key above).
- Lifecycle and recovery share one singleflight handshake per client context. **Precedence** (highest first): tenant/site/principal switch; **genuine user session lifecycle**; pending **same-episode budgeted recovery** (one restart, budget 0, including when epochs also changed); **external scope** flush/block only on **lifecycle-only** handshakes that are not finishing a pending recovery. A recovery-minted SC alone does not count as user session lifecycle.
- The asymmetry is intended: a failed request interrupts a load the user just started, so one budgeted automatic restart finishes that load. A lifecycle handshake runs while the user may be reading or mid-action, so an external scope change there blocks until an explicit user refresh (ADR-0035 §7) instead of replacing the list underneath them.
- Quarantine, flush and late-result fencing remain mandatory when the budget is spent.
- `LIST_CURSOR_STOCK_FILTER_REQUIRED` (vehicle stock) is not a recovery case. It keeps its existing handling and is outside this contract.
- `CONTEXT_REQUIRED` reaching a web client that always sends the SC signals version skew. It follows the context-mismatch path once and then stops.
- Library-level automatic retry is disabled for every typed scope or cursor error (`CONTEXT_MISMATCH`, `CONTEXT_REQUIRED`, the cursor codes) and for 401, 403 and 422, overriding the one-retry default. The only automatic scope or cursor action is the budgeted one. A network error or 5xx gets at most one retry of the identical GET with the same cursor, SC and generation; it is never a restart or resync and does not use the budget. No 4xx is retried automatically. The web hook must throw an error that carries status and code, which the current generic error does not.

### 10. Page and count identity

Page and count acceptance use separate generations. Count identity binds **all** resolved effective filters and the SC digest, but not sort. A sort-only change keeps the count only while filters and validated context are unchanged, no invalidation or explicit refresh occurred, and the echoed context matches. The page fingerprint adds endpoint, sort and direction. One resolver feeds rows, count and fingerprint. Scope invalidation flushes protected pages, counts, selection and anchors.

## Resolutions

The earlier open choices were documented on 2026-11-08 at the owner's instruction, grounded in a read of `main` at `9284e46`. Nothing has been run or measured. Rows below are **design targets** for implementation specification; B1–B4 (2026-11-09) close the former still-open items.

| Choice | Resolution | Basis |
|---|---|---|
| Token form | HMAC-signed, self-contained SC; current and previous key accepted; no expiry (§1) | Validity is checked per request, so a server-side reference only adds a lookup; the API already has an HMAC token pattern |
| Epoch granularity for role definitions | A grant-changing edit advances the epoch of each assigned member; the tenant epoch covers only tenant, legal-entity and site activation (§2) | Avoids tenant-wide over-invalidation and a role list inside the SC |
| Snapshot isolation | Read-only `REPEATABLE READ` transaction in the shared cursor helper and the handshake; the guard is not rewritten (§4) | One snapshot without a global rewrite; validate-after-read rejected |
| Identity-provider freshness | Token expiry on the hot path (≤ 60 min); revocation at the handshake; decided 2026-11-09 (B1) | IdP-only disable with valid token is bounded by ID-token lifetime; handshake checks revocation with `checkRevoked=true` |
| Policy-version derivation | Boot-time content digest of the contracted routes' operation entries, catalogue version and demo mask (§5) | Policy ships in the image, so no pipeline coupling is needed |
| Transport of the SC | Request header on list and count, digest echoed in the body, `private, no-store`, cursor version 2 (§8) | A query string would reach logs and error-tracking URLs; requests are same-origin |
| Storage of continuity ids | HMAC continuity digest (subject + authentication time) with ended-lineage table; decided B3, 2026-11-09 (§3) | Same-subject, same-second alias is an accepted risk; it never crosses principal, tenant or site |
| Relationship to ADR-0034 | Separate epoch; ADR-0038 does not wait for ADR-0034; its writers must also advance the epoch (§2) | Its versions cover fewer writers and it is Proposed |
| Transport and 5xx retry | At most one identical retry for a network error or 5xx; none for 4xx; not a restart or resync (§9) | Keeps today's behavior for transient failures only |

**Decided 2026-11-09 (formerly still open):**

1. **B1 – Identity-provider staleness on the hot path.** The list and count hot path rejects expired ID tokens; the handshake verifies the ID token with revocation checking (`checkRevoked=true`, covering disabled and revoked users) and fails closed. The accepted maximum staleness for an identity-provider-only disable or revocation, while database membership still authorizes the principal, is the ID-token lifetime (60 minutes). Database-visible revocations are caught immediately by the epochs. No per-request revocation call is made.
2. **B2 – Compatibility window.** None. A client without the expected context receives `CONTEXT_REQUIRED`. The enforcing change records a read-only log query (user agent and origin on the three list and three count routes, 7 days) as evidence; it is not a gate.
3. **B3 – Continuity mechanism.** The HMAC continuity digest (subject + authentication time) together with the ended-lineage table is the approved continuity mechanism. The same-subject, same-second alias is an accepted risk: it never crosses principal, tenant or site; its effects are that a logout ends both aliased sign-ins (fail closed) and that one aliased sign-in's context is accepted by the other for the same principal with identical rights, while credentials still authorize every request. Fixed requirement 2 is met except for the same-subject, same-second alias, which is accepted as a risk.

**B4 – Context error statuses.** `CONTEXT_REQUIRED` is returned with HTTP 428, `CONTEXT_MISMATCH` with HTTP 412, both in the standard API error envelope and listed among the client-safe error codes. Parameter-validation 400s of a consumer rank after the context codes for precedence; they remain §9 "other 4xx" (no automatic retry, not budgeted). `CURSOR_INVALID` and `UNSUPPORTED_SORT` remain state-machine shorthands for `LIST_CURSOR_INVALID` and `LIST_CURSOR_SORT_UNSUPPORTED`.

## Alternatives Considered

| Option | Why not chosen |
|---|---|
| Reuse an existing mechanism | Only if later proven equivalent. None is shown; ADR-0034's versions are proposed, unimplemented and cover only part of the scope |
| Epoch without continuity | Misses refresh lineage and other-sign-in isolation |
| Fingerprint of current rights | Misses A→B→A |
| Events plus a refetch after a 403 | Lossy, and a later 403 is not detection |
| Deferral | Remains the outcome if the proof obligations cannot be met |

An unsafe opt-out is not an alternative.

## Consequences

- Positive: stale or foreign-principal content is rejected by the server even when events are missed; recovery cannot loop; ended lineages and digest mismatch reject replay when the mechanism distinguishes lineages (same-second alias accepted as a disclosed risk per B3).
- Negative: a coverage obligation across all access writers; extra snapshot reads on the cursor hot path; a client rollout and a coordinated server change; a new logout endpoint and ended-lineage table; a request header and cursor version 2; rare over-invalidation on tenant-wide activation changes.
- Neutral: no business entity, fiscal rule or visibility change. Accepted design does not mean deployed behavior.

## Validation and Proof Obligations

Nothing here has been run. Names are proposals, not existing files.

**Six focused scenarios, each one test.** These are carried from the Sales Orders wave plan. Only `salesOrders_missed_event_epoch_replay`, `cursorScope_resync_rejects_late_results` and `cursorRecovery_shared_episode_budget` test the contract of this ADR. The timestamp, exact-count and explicit-refresh rows test keyset, count and ADR-0035 §7 behavior of the Sales Orders wave and belong to its specification; they are listed here only because the wave plan names them.

| WHEN / THEN | Proposed test | Runner |
|---|---|---|
| Static tied timestamps are paged under a non-UTC runtime → tuples round-trip and order correctly | `salesOrders_static_timestamp_roundtrip` | backend e2e |
| 1,000 versus 1,001 authorized matches → the capped count distinguishes them | `salesOrders_exact_count_boundary` | backend e2e |
| An external role assignment (and, once database role definitions exist, a role definition) changes A→B→A with websocket delivery suppressed → the old expected scope is rejected | `salesOrders_missed_event_epoch_replay` | backend e2e |
| A resync invalidates the context before delayed page and count responses resolve → neither repopulates the cache | `cursorScope_resync_rejects_late_results` | web unit |
| Concurrent invalid-cursor failures recover and then fail again in one episode → one automatic restart | `cursorRecovery_shared_episode_budget` | web unit |
| A `SALES_ORDER` realtime event arrives → retained rows stay unchanged until an explicit fresh-chain refresh | `salesOrders_explicit_realtime_refresh` | web unit |

**Supporting coverage for the shared requirements** (unlimited; each is a separate test, per consumer where the consumer differs):

- `CONTEXT_REQUIRED` on omission, for the count request as well as the page request, on each contracted consumer once enforcement is on.
- No automatic retry of 401, 403 and 422, and none of the typed scope or cursor errors.
- Unsupported sort latches offset at offset 0 and keeps filters and sort.
- Replay of an old continuity digest is rejected when ended-lineage or digest rules distinguish it (cross-device and cross-lineage cases per fixed requirement 2; same-second alias is an accepted risk per B3).
- A→B→A on membership, site grant and user or site status, not only on a role definition.
- Fencing and quarantine continue after the budget is exhausted.
- An **external-scope** lifecycle handshake (epochs/policy changed, user session unchanged — §6) flushes and blocks without an automatic restart; user session lifecycle starts a new episode instead (§6, §9).
- User session lifecycle during a pending same-episode recovery abandons the old recovery and starts a new episode (precedence above).
- Invoice, inventory and vehicle-stock consumers keep their existing regressions after the shared change.

New behavior follows the TDD workflow in `agents.md`: each new test must fail against the pre-change code. Characterization baselines are used only to pin existing, correct behavior that the change must not alter.

Before **shared prerequisite** implementation is authorized (existing three consumers):

- **Writer coverage** and transactional coupling of every access-relevant writer.
- **Identity provider**: the measured cost of the handshake revocation check, and that the authentication time stays the same across a token refresh and differs per sign-in (B1 and B3 decided 2026-11-09; implementation still must confirm behavior).
- **Deployment**: behavior while old and new revisions both serve after a policy-digest change.
- **Hosting**: that Firebase Hosting forwards the SC request header; if it does not, requests fail closed with `CONTEXT_REQUIRED` and there is no fallback to a query parameter.
- **Clients**: the 7-day read-only log query on list and count routes (B2 record only, not a gate).
- **Cost**: connection-pool use and query plans of the read-only `REPEATABLE READ` transaction, and that the over-invalidation is acceptable.

Sales Orders–specific query plans, endpoint integration and **released QA** on that wave are **completion evidence** (see Gates and Sequencing), not prerequisites before shared work or Sales implementation starts. Schema, collation, Prisma non-UTC behavior, live URL and mobile card capability belong to the Sales wave specification and its QA, not to authorizing the shared prerequisite alone.

## Gates and Sequencing

The Sales Orders wave (AUT-891) **starts** only after all of the following are documented; **items 1 and 2 are still missing** in repository status (items 3 and 4 are satisfied):

1. AUT-890 pilot QA acceptance.
2. Invoice-wave QA acceptance.
3. Approval of the corrected Sales Orders specification (**done**, Planner + SE, 2026-11-09).
4. This ADR accepted as the shared scope-context design (repository status today).

**Before rollout/completion** of Sales Orders (not before implementation starts): enforcement of this ADR on the Sales Orders cursor list and capped-count endpoints (§7), plus Sales Orders query plans, endpoint integration and released QA on the built wave. Those items cannot be gates on their own not-yet-built endpoints. Approved bounded shared-prerequisite readiness on the three existing consumers remains a pre-start requirement when a separate prerequisite correction is owner-approved.

Merges, reviews and scratch probes do not replace 1–2. If shared defects block the predecessors, a bounded prerequisite correction is proposed separately for explicit owner approval; this ADR authorizes none. Shared changes require renewed relevant regressions before rollout.

## Sales Orders Wave: Settled Scope (planning input)

The approved specification is [Sales Orders Cursor List](../02-Feature-Specs/Sales/sales-orders-cursor-list.md) (`approved (Planner + SE, 2026-11-09)`).

**Preserved behavior:** cursor-only default `createdAt DESC, id DESC`; database text ordering for `order_number`; exact tenant, active-site and null-site visibility and existing permissions; Saved Views and live-URL compatibility; effective legacy `params` computed after the status override, with remaining filters forcing the unchanged offset fallback; raw wire search; exact 1,000 versus 1,001 capped count; an independent 2,000 loaded-row ceiling; no snapshot or no-gap guarantee on mutable data; the existing DRAFT-only Delete with its endpoint, permission, state restriction and confirmation.

**New fixed requirements of the wave, not current behavior (D10, D11):** Mobile card detail line `dd.MM.yyyy · <plate>` (plate, else make + model, else date only) on the shared DataTable `meta.mobile: 'details'` slot (full-width line under the title row). DRAFT Delete becomes registry action `salesOrder.delete` on `EntityActionDefinition` with `destructive: true` and a `confirm` prompt, dispatched via `executeEntityAction` / `EntityActionConfirmHost` (`AlertDialog`; same pattern as `customer.delete`), visible only when status = DRAFT, there is no invoice and the user has `sales.order.delete`; paths: existing row ⋯ menu via `DataTableRowActions` / `getRowContextActions` (mobile visible), detail page header, and Cmd+K; remove the right-click-only path. Endpoint and server rules are unchanged.

No Sales Orders selection is introduced.

## References

- [ADR-0013: Row-level multi-tenancy](2026-04-15-row-level-multi-tenancy.md)
- [ADR-0022: Site operational scope](2026-08-31-site-operational-scope.md)
- [ADR-0034: Custom tenant roles](2026-11-02-custom-tenant-roles.md)
- [ADR-0035: Cursor-based infinite lists](2026-11-02-cursor-based-infinite-lists.md)
- [ADR-0036: Frontend interaction rules](2026-11-02-frontend-interaction-rules.md)

## Linear Tracking

Part of AUT-891. This ADR does not complete the issue or claim QA acceptance.
