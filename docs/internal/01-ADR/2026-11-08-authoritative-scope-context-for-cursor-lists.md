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

The open choices of the earlier draft were resolved on 2026-11-08 at the owner's instruction by delegating them to a reviewing model, grounded in a read of `main`. They appear below as recommended resolutions, awaiting the owner's acceptance of this ADR. Two items remain open for lack of evidence (see "Recommended Resolutions"). Acceptance flips the status; nothing is accepted until then.

Observed facts (marked *Observed*) come from reading `main` at `9284e46`. They are not independently audited; the Software Engineer re-verifies them before acceptance. This ADR claims no QA acceptance and no PASS.

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
2. Server-verified session continuity.
3. A coherent authorization decision over permission state, scope epoch and data.
4. One shared safety and recovery contract for the invoice, inventory and vehicle-stock cursor consumers and the later Sales Orders wave.
5. Legacy offset behavior and each consumer's permissions and visibility are preserved.

## Decision (recommended; pending owner acceptance)

### 1. Scope Context

The server mints an opaque *Scope Context* (SC) only after full fresh validation. It is signed with HMAC-SHA-256 under a dedicated secret (recommended name `SCOPE_CONTEXT_HMAC_SECRET`, held in the secret manager); the current and previous key are accepted during rotation, and a rotated key surfaces as `CONTEXT_MISMATCH`. It carries no expiry, because validity is evaluated per request. It binds: principal reference, continuity id, tenant, site, a principal-tenant scope epoch, a tenant-authorization epoch and a policy version. An SC is context metadata, not a credential: normal credentials still authorize every request. Raw credentials and session secrets never appear in cursors or cache keys; both use an SC digest.

### 2. History-sensitive epochs

Monotonic counters advance in the **same transaction** as every database-backed writer of effective access: role assignment, grant-changing role-definition edits (which advance the principal-tenant epoch of every assigned member in the same transaction), membership create/activate/deactivate/remove, and user and site transitions. The tenant-authorization epoch advances only on tenant, legal-entity and site activation changes. Today role definitions are code, so the policy version (§5) covers them. Counters only increase, so A→B→A is detected. Writer coverage uses one shared transactional helper and an inventory test that fails on any unregistered writer (raw SQL, seeds and admin tools included).

ADR-0034's versions are not reused: its `authorization_version` fences a narrower set of writers and does not cover site membership, site status or continuity, and tying this ADR to a Proposed one is avoided. If ADR-0034 is accepted, each authorization writer it adds must also advance the scope epoch through the shared helper and appear in the writer-coverage inventory.

### 3. Session continuity

The continuity id is an HMAC of the identity provider's subject and authentication time taken from the verified token. A normal credential refresh keeps the authentication time, so the id is unchanged; reauthentication sets a new one. Explicit logout calls a new authenticated server endpoint that records the ended lineage in a small user-scoped table (recommended name `ended_session_lineages`: user, lineage digest, authentication time, ended-at), read in the §4 snapshot; a row may be pruned only once a later refresh-token revocation covers its authentication time **and** the maximum ID-token lifetime has passed since that revocation. A refresh-token revocation ends all lineages of the user at the next handshake, and on list and count requests within the token-expiry bound (§5). Each sign-in has its own lineage at one-second resolution; two sign-ins in the same second share one, which is an accepted limit. Continuity means "same lineage"; it never means "currently valid". Validity is evaluated per request.

### 4. Decision point and coherent read

After authentication, the shared cursor list and count helper (and the handshake) opens one read-only `REPEATABLE READ` transaction. It reads membership and activation, the active site membership, site and legal-entity activity, both epochs, the ended-lineage record and the authoritative time (demo and time expiry), compares them with the SC, then reads the data. An ended lineage returns 401 on the list, count and handshake requests and ranks with the 401, 403 and 422 outcomes in the precedence order below. The authentication guard is not rewritten. A validate-after-read design is not used.

- The server compares the bound *components* of the expected SC (principal, continuity id, tenant, site, both epochs, policy version) with the snapshot's, not token bytes, and returns a typed `CONTEXT_MISMATCH` iff any component differs.
- A relevant change committed before the snapshot, meaning one that advanced a component bound in the SC, rejects an old context. A change that advances no bound component does not reject, and a correct new context is not rejected merely because a mutation occurred. The tenant-authorization epoch is tenant-wide, so a tenant, legal-entity or site activation change can reject contexts of members it does not affect; that rare over-invalidation is accepted. Role-definition edits advance only the epochs of assigned members.
- A later commit cannot recall delivered bytes; the next old-context request rejects.
- A second epoch read in the same snapshot is not independent freshness evidence, so none is made.
- Existing 401, 403 and 422 outcomes take precedence when scope is unusable. Precedence is: 401, 403 or 422; then `CONTEXT_REQUIRED` or `CONTEXT_MISMATCH`; then the cursor codes. A `CURSOR_INVALID` response therefore implies that the expected SC matched the snapshot.

### 5. Authorities outside the database snapshot

- **Time expiry is not a writer.** It is evaluated against authoritative time at the snapshot, not by an epoch increment.
- **Identity-provider revocation and claim freshness** is separate and not atomic with the database: per request the bound is the existing ID-token expiry check, which already fails closed; the handshake additionally checks revocation and fails closed (a blocked list) when the identity provider is unreachable. Revocations that change the database are caught immediately by the epochs. A bound tighter than token expiry is deferred pending measured cost.
- **Policy deployment**: the policy version is a content digest computed at boot over the operation entries of the contracted routes, the permission catalogue version and the demo request mask for those routes. It ships with the image, so it is not tied to the deploy pipeline. While old and new revisions both serve after a digest change, a request can see a mismatch, take the one restart and end blocked; that fails closed.
- An epoch covers revocation or policy invalidation only where it is demonstrably coupled to that authority; otherwise separate freshness requirements apply. No global external atomicity is claimed.

### 6. Handshake and quarantine

A handshake endpoint (proposed) performs fresh authentication (including an identity-provider revocation check) and authorization, then returns the SC. On resume, focus, reconnect and online, protected cached content stays quarantined until the handshake succeeds. An unchanged epoch alone does not release it: current credential validity, ended lineage, membership, activation and expiry are re-evaluated. A handshake failure leaves content blocked with manual retry. Offline revocation is not instant, and delivered bytes are not recalled.

A lifecycle handshake is not a recovery of a failed request and does not spend the episode budget in §9:

- It returns the same SC: the quarantined content is released.
- It returns a different SC for the same tenant and site (an external scope change): pages, counts, selection and anchors are flushed, late results fenced, and the list stays blocked until an explicit user refresh (ADR-0035 §7). No page-one restart runs automatically.
- It returns an SC for a different tenant or site, or a different principal: this is a genuine context switch. The central session reset runs (ADR-0035 §6) and a new episode starts.

### 7. Requests and rollout

The expected SC is mandatory on the cursor list **and** the count request of every contracted consumer. Omission returns a typed `CONTEXT_REQUIRED`. There is no compatibility window by default: enforcement starts in the release in which the web app sends the SC, and a client without it receives the typed, documented `CONTEXT_REQUIRED` rather than a silent failure. A window is granted only on log evidence of other callers (see "Still open for lack of evidence" under "Recommended Resolutions"). Offset endpoints are unaffected.

No consumer counts as covered by this contract, and the Sales Orders gate in "Gates and Sequencing" is not met, before enforcement is on for both the cursor and the count endpoint of that consumer.

### 8. Binding

The SC travels in a request header (recommended name `X-ACP-Scope-Context`) on the cursor list and count requests, never in the query string, which would reach request logs and error-tracking URLs. Responses return the SC digest in the body (`meta` for pages, a sibling field for the count) and are `Cache-Control: private, no-store`. A cursor binds the SC digest, endpoint, sort, direction and the resolver fingerprint; the cursor payload moves to version 2 and stays unsigned, because the server compares its digest with the digest of the presented, verified SC and authorizes freshly on every request. Version 1 cursors return `CURSOR_INVALID` and take the budgeted restart. Cache keys use the SC digest. OpenAPI and generated types are regenerated (ADR-0010). A response whose echoed context differs from the client's validated context is discarded.

### 9. One shared recovery contract

```
Episode key = semantic user query + genuine context switch
  (user-initiated, or a different tenant, site or principal revealed by any handshake)
Recovery contexts that keep tenant, site and principal, recovery epochs,
generations and successes never rearm it

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
LOADING -UNSUPPORTED_SORT-> OFFSET (latched for the episode, offset 0, keep sort and filters)
LOADING -network error or 5xx (after at most one identical retry, same generation) | other 4xx-> ERROR (not a restart or resync)
ERROR -manual retry-> LOADING (same episode, budget unchanged)
BLOCKED -manual retry | explicit user refresh | new semantic query | user context switch-> new episode
```

- One total automatic action per episode is shared by page and count and by all scope and cursor-recovery failure types (`CONTEXT_MISMATCH`, `CONTEXT_REQUIRED`, `CURSOR_INVALID`), so alternating errors cannot multiply attempts. The unsupported-sort latch is a one-way mode switch for the episode, not a budgeted action. A realtime event, focus or lifecycle refresh never starts a new episode by itself. The one exception is a handshake that reveals a genuine context switch (different tenant, site or principal), which runs the central session reset and starts a new episode.
- Lifecycle and recovery share one singleflight handshake per client context. A tenant, site or principal change revealed by it takes precedence over a restart or a block. For a different SC with the same tenant, site and principal: if a recovery is pending when the handshake completes, the recovery rule applies (one restart, budget 0) and the handshake counts as that recovery's handshake; otherwise the lifecycle rule in §6 applies (flush and block, no budget spent).
- The asymmetry is intended: a failed request interrupts a load the user just started, so one budgeted automatic restart finishes that load. A lifecycle handshake runs while the user may be reading or mid-action, so an external scope change there blocks until an explicit user refresh (ADR-0035 §7) instead of replacing the list underneath them.
- Quarantine, flush and late-result fencing remain mandatory when the budget is spent.
- `LIST_CURSOR_STOCK_FILTER_REQUIRED` (vehicle stock) is not a recovery case. It keeps its existing handling and is outside this contract.
- `CONTEXT_REQUIRED` reaching a web client that always sends the SC signals version skew. It follows the context-mismatch path once and then stops.
- Library-level automatic retry is disabled for every typed scope or cursor error (`CONTEXT_MISMATCH`, `CONTEXT_REQUIRED`, the cursor codes) and for 401, 403 and 422, overriding the one-retry default. The only automatic scope or cursor action is the budgeted one. A network error or 5xx gets at most one retry of the identical GET with the same cursor, SC and generation; it is never a restart or resync and does not use the budget. No 4xx is retried automatically. The web hook must throw an error that carries status and code, which the current generic error does not.

### 10. Page and count identity

Page and count acceptance use separate generations. Count identity binds **all** resolved effective filters and the SC digest, but not sort. A sort-only change keeps the count only while filters and validated context are unchanged, no invalidation or explicit refresh occurred, and the echoed context matches. The page fingerprint adds endpoint, sort and direction. One resolver feeds rows, count and fingerprint. Scope invalidation flushes protected pages, counts, selection and anchors.

## Recommended Resolutions (pending owner acceptance)

The earlier open choices were resolved on 2026-11-08 at the owner's instruction, grounded in a read of `main` at `9284e46`. Nothing has been run, measured or approved; acceptance of this ADR adopts them.

| Choice | Resolution | Basis |
|---|---|---|
| Token form | HMAC-signed, self-contained SC; current and previous key accepted; no expiry (§1) | Validity is checked per request, so a server-side reference only adds a lookup; the API already has an HMAC token pattern |
| Epoch granularity for role definitions | A grant-changing edit advances the epoch of each assigned member; the tenant epoch covers only tenant, legal-entity and site activation (§2) | Avoids tenant-wide over-invalidation and a role list inside the SC |
| Snapshot isolation | Read-only `REPEATABLE READ` transaction in the shared cursor helper and the handshake; the guard is not rewritten (§4) | One snapshot without a global rewrite; validate-after-read rejected |
| Identity-provider freshness | Token-expiry check per request, revocation check at the handshake, fail closed (§5) | Database-visible revocations are caught by the epochs; a tighter bound needs measured cost |
| Policy-version derivation | Boot-time content digest of the contracted routes' operation entries, catalogue version and demo mask (§5) | Policy ships in the image, so no pipeline coupling is needed |
| Transport of the SC | Request header on list and count, digest echoed in the body, `private, no-store`, cursor version 2 (§8) | A query string would reach logs and error-tracking URLs; requests are same-origin |
| Storage of continuity ids | Stateless HMAC lineage from the verified token's subject and authentication time, plus a small ended-lineage table written by a new logout endpoint (§3) | Logout is client-only today; second-resolution limit accepted |
| Relationship to ADR-0034 | Separate epoch; ADR-0037 does not wait for ADR-0034; its writers must also advance the epoch (§2) | Its versions cover fewer writers and it is Proposed |
| Transport and 5xx retry | At most one identical retry for a network error or 5xx; none for 4xx; not a restart or resync (§9) | Keeps today's behavior for transient failures only |

**Still open for lack of evidence** (fail-closed defaults apply meanwhile):

1. **Identity-provider staleness tighter than token expiry.** Needs the measured latency and quota cost of a revocation check on the list and count path under representative load, and an owner tolerance for a disabled identity-provider user who still has a membership. Default: token expiry per request, revocation check at the handshake.
2. **Compatibility window for direct clients.** Needs a Cloud Logging query over the three cursor list routes and three count routes, grouped by user agent and origin, for a period the owner picks. API keys cannot reach these routes, and `core-web` is the only in-repo caller. Default: no window; unknown clients receive `CONTEXT_REQUIRED`.

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

- Positive: stale or foreign-principal content is rejected by the server even when events are missed; recovery cannot loop; old-session replay is rejected.
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
- Replay of an old continuity id is rejected, including from another device.
- A→B→A on membership, site grant and user or site status, not only on a role definition.
- Fencing and quarantine continue after the budget is exhausted.
- A lifecycle handshake that returns a changed SC flushes and blocks without an automatic restart.
- Invoice, inventory and vehicle-stock consumers keep their existing regressions after the shared change.

New behavior follows the TDD workflow in `agents.md`: each new test must fail against the pre-change code. Characterization baselines are used only to pin existing, correct behavior that the change must not alter.

Before acceptance:

- **Writer coverage** and transactional coupling of every access-relevant writer.
- **Identity provider**: the measured cost of the handshake revocation check, and that the authentication time stays the same across a token refresh and differs per sign-in.
- **Deployment**: behavior while old and new revisions both serve after a policy-digest change.
- **Hosting**: that Firebase Hosting forwards the SC request header; if it does not, requests fail closed with `CONTEXT_REQUIRED` and there is no fallback to a query parameter.
- **Clients**: the log evidence behind the compatibility-window item.
- **Cost**: connection-pool use and query plans of the read-only `REPEATABLE READ` transaction, and that the over-invalidation is acceptable.
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
