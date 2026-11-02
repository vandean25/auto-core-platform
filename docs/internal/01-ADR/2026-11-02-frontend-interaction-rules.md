---
title: "ADR-0036: Predictable Frontend Interaction and Safe Optimistic Updates"
date: "2026-11-02"
status: proposed
deciders: ""
tags: [adr, frontend, interaction, accessibility]
---

# ADR-0036: Predictable Frontend Interaction and Safe Optimistic Updates

## Status

**Proposed — 2026-11-02.** This documentation PR reviews the [original interaction draft](../00-Inbox/concept-frontend-interaction-rules.md) and proposes the rules below. The draft's approval note is source context, not approval of this revised ADR. No runtime behavior, agent instructions or CI guards change through this PR. Acceptance and implementation require separate review.

## Context and Decision Drivers

ACP should acknowledge everyday edits immediately while preserving server authority over shared resources, financial operations and access. Current patterns differ between pages. The goal is predictable feedback, safe recovery and keyboard parity without a local sync engine or a large frontend rewrite.

The existing [optimistic mutation helper](../../../apps/core-web/src/lib/optimistic-mutation.ts) cancels reads, patches caches, rolls back and coordinates settlement. The [realtime invalidator](../../../apps/core-web/src/features/realtime/echo-safe-invalidator.ts) defers invalidation while matching mutations are pending. Neither implements a general entity-version protocol. The [event payload](../../../apps/core-api/src/dashboard-realtime/dashboard-events.types.ts) has an event timestamp, not a committed entity revision. The shared table already exposes `rowBehaviour.onRowPrefetch`, and the Action Registry already has optional `shortcutKey` metadata; consistent scheduling and dispatch remain implementation work.

The rules must compose with accepted ADR-0005 (entity-specific deletion), ADR-0006 (save triggers and unsaved form recovery), ADR-0013/0022 (tenant/site isolation) and ADR-0035 (explicit infinite-list refresh). Proposed ADR-0034 supplies the intended explicit-save exception for authorization changes; it is not deployed behavior established by this ADR.

## Decision

### R1. Optimistic updates depend on the operation's contract

Use `lib/optimistic-mutation.ts` for a new mutation when the client can predict the complete visible patch, rejection is exceptional, and rollback/reconciliation is safe. Examples include a non-financial label, note, simple assignment or ordering change **without** shared-resource validation. A status change is eligible only after reviewing that transition's effects. Client validation gives early feedback; it never replaces server validation, authorization, fiscal checks or atomic state guards.

Classify each operation as optimistic or server-confirmed in one machine-readable mutation inventory, identified by its stable operation/action ID and owning hook. Server-confirmed entries carry the business reason; conditional entries identify the tested eligibility predicate. Review gray areas once per operation. An absent inventory entry is a gap, never implicit approval to optimistically mutate.

| Server-confirmed operation | Reason |
|---|---|
| Posting, payment, fiscal finalization and cancellation | Authoritative financial effects and lock dates |
| Price/tax calculation, document numbering, stock, reservation and contested resource allocation | Client cannot safely predict authoritative values or availability |
| Planner moves involving shared bays, mechanics or appointment conflicts | Availability can change after the client reads it |
| Authorization and membership changes | Intermediate local edits must not appear to grant access; explicit Save/Apply |
| Customer delivery, external side effects, imports | Irreversible or long-running effects; use operation-specific progress |
| Any operation lacking safe rollback, required concurrency protection or a predictable patch | Keep confirmation semantics until its contract is ready |

**Pending and rollback.** Patch only the affected fields/records and all relevant cached projections through domain query-key factories. Do not snapshot-restore an entire list over unrelated changes. Coordinate writes touching the same entity across hooks and mutation keys, either by serializing them or by an explicitly tested ordering strategy. Existing helper serialization is by mutation key; it is not proof of entity-wide ordering. Do not override helper lifecycle callbacks or introduce an immediate success refetch that overwrites another pending patch. Reconcile normalized server values after settlement without clobbering newer edits.

On a definite rejection, restore this operation's affected cache values and keep a visible, non-color-only error marker until the user retries, edits that field or dismisses it. A localized error names the record and a useful next step. Show Retry only when it is safe. On `409`, read the current authorized server state and show the conflict; never automatically replay the stale write. Preserve unsaved form input separately from the authoritative cache.

**Network uncertainty and retries.** A timeout or lost response does not prove the server rejected the write. Roll back the speculative display, label the outcome unconfirmed, and reconcile through an authorized read or operation-status contract. Do not blindly retry creates or external effects. Reuse the same idempotency key for retries of the same logical operation; a changed payload is a new operation. An eligible optimistic create requires a backend deduplication contract binding principal, tenant, authorized site where applicable, operation, key and payload, with atomic effect/result storage and defined retention. Receipt replay still requires current authorization. Limit retries to that retention window; after expiry reconcile the original outcome rather than issuing a new create. A client header alone provides no such guarantee. Safe idempotent updates may retry under their documented preconditions. Add no offline mutation queue or background replay; keep ADR-0006's existing form recovery behavior.

**Creates.** Default to server-confirmed creation until that endpoint has the deduplication contract and predictable fields. Where eligible, use `generateId()` for a temporary client identity; mark the row pending, prevent dependent actions/navigation that need a server ID, and replace every temporary cache/selection reference with the returned ID exactly once. Do not invent authoritative numbers, prices or stock. If the row's membership or sort position cannot be predicted, show separate pending feedback rather than inserting a misleading result row.

**Realtime and context.** Reuse pending-mutation-aware invalidation; events are invalidation signals, not row patches. Do not compare event timestamps or arbitrary `updatedAt` values as monotonic entity revisions, and do not drop other users' events as presumed echoes. A future version protocol needs a separate API/event contract and tests for responses, deletes and out-of-order events. Refresh normal queries after settlement; migrated infinite lists follow R7 instead. On tenant/site/user change or access loss, the central cancel/cache-clear reset wins immediately: discard optimistic snapshots, undo entries, prefetched data and sensitive toast content; fence late callbacks with the client session generation so they cannot repopulate the new context.

### R2. Keep useful content visible while loading

Use content-shaped skeletons for the first load with no usable data, delayed 150–300 ms to avoid flashing. Do not replace an existing page/list with a spinner during an ordinary refetch. Use one shared, non-blocking refresh indicator, with a textual/accessibility status and reduced-motion behavior, rather than page-specific bars. Preserve error, empty and loaded states as distinct outcomes.

Within unchanged context/results, keep rows and focus during refresh. After a filter, sort or offset-page change, old rows may remain only as an explicitly stale preview: disable row, selection and bulk actions until the new result succeeds, and keep them disabled on failure. Mark the result region busy and announce completion or failure without repeatedly announcing every row. Infinite-list chain resets follow ADR-0035. Permission/context changes show no old-context preview; the shell's session-reset loading boundary is a deliberate exception to content retention.

For server-confirmed actions, retain the button label, add pending feedback and prevent duplicate submission of that action; preserve the rest of the page. Imports and other long-running work may additionally use inline progress. Keep ADR-0006's 750 ms form auto-save and isolated-field save-on-blur triggers plus persistent Saving/Saved/Error indication. A cache rollback must not erase a dirty form or change its recovery policy. Failed speculative updates must never be presented as saved.

### R3. Undo only a committed, safely reversible operation

Prefer immediate commit plus an explicit inverse mutation when the backend can safely undo the exact change. The inverse rechecks current tenant/site permissions, lifecycle and business constraints, and atomically compares the expected post-operation entity version. A later edit, including one that changed a value back, must make stale Undo fail rather than overwrite it. Last-write-wins endpoints do not qualify merely because they accept a reverse PATCH. Until the inverse contract exists, retain the current interaction and confirmations.

Do not delay a business write in a client timer to offer Undo. A browser lifecycle callback is not a durability guarantee: [`pagehide` is not reliably fired](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event#usage_notes). If no safe inverse exists, use the server-confirmed action with its existing confirmation. Closing the tab after a successful write never discards that write.

Offer Undo only after commit is confirmed. A roughly six-second toast is a discoverability aid, never the only time-limited access to the inverse. The same registry action remains reachable through the record UI and Cmd+K while its preconditions hold; keep the latest eligible undo entry in memory for the active session/context and replace it only with another eligible committed action. The shortcut and toast resolve to the exact same action, permission checks and confirmation. Prevent concurrent/double Undo; an inverse does not create a redo stack. Context changes clear the entry; reload does not promise restored shortcut history.

Keep confirmations for deletion, fiscal actions, external side effects and every action currently classified as destructive by the registry. Removing a confirmation requires an explicit per-action review and registry/type update; this ADR does not silently relax that invariant. ADR-0005 and `docs/deletion-policy.md` remain authoritative: hard delete, draft-only delete, archive and forbidden deletion retain their existing meanings. Restoration is available only for an entity with a reviewed restore contract; there is no blanket soft-delete migration.

`Cmd/Ctrl+Z` invokes the latest eligible entry only when focus is outside editable controls and no dialog or other focused component owns the keystroke. Never intercept native text undo, composition, or a keystroke with no eligible action. No browser history or global multi-step undo engine is introduced.

### R4. Prefetch on intent, within authorization and a bounded cache

Navigable new DataTable lists wire `rowBehaviour.onRowPrefetch` to the same detail query options and key factory used by navigation. Lists without an authorized detail target have a reasoned inventory exception. Prefetch after about 100 ms of sustained pointer hover or keyboard focus; pointerdown may start it immediately. Cancel a pending timer on leave/blur/unmount, deduplicate in-flight requests, and set a domain-appropriate `staleTime` and finite `gcTime`. Do not fetch on render, touch scrolling, every virtual row mount, or unlimited hover accumulation; bound speculative concurrency and retained detail entries in the shared scheduler.

Prefetch uses ordinary read endpoints under current server authorization, never a side-effecting GET. Client role gating avoids needless requests, not authorization checks. Skip prefetch on an explicit data-saving connection preference where available. Failures do not block navigation or produce an unsolicited toast; navigation renders its own error state. Central session/context reset cancels and clears speculative work just like visible queries.

### R5. Keyboard actions share the Action Registry

Frequently used desktop record actions declare `shortcutKey`, unique in the scope where they can be simultaneously active. Define scope and precedence in the shared dispatcher; only the focused list/record or topmost open interaction surface handles a key. Reserve j/k for next/previous loaded row, x for toggling selection where supported, and ? for the shortcut sheet. Preserve arrow/Enter/Space navigation, explicit loaded-ID selection and stable record focus across virtualization. A global action and a row action must not both execute from one key.

Character shortcuts run only while their component owns focus; any global character shortcut must be switchable off or remappable with a non-character modifier, following [WCAG character-key guidance](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html). Ignore editable inputs, textareas, selects, contenteditable elements, composition, already-handled events and modifier combinations owned by the browser or assistive technology. Do not fire destructive/repeated mutations from key repeat. The shortcut sheet has an ordinary accessible trigger as well as ?, and lists effective shortcuts for the current scope.

Keyboard, Cmd+K, buttons and context menus use the same allowed/enabled predicates, record identity and confirmations. Mobile and mechanic touch views keep equivalent visible actions through their existing interaction patterns; long-press is an optional addition, never the only route. AUT-783 is a draft-supplied dependency for the mobile action sheet, not implementation delivered here.

### R6. Motion and notifications reinforce state

Default finite UI transitions to 150 ms and sheet/dialog transitions to 200 ms. Honor `prefers-reduced-motion` with immediate or reduced transitions and static progress feedback. The 200 ms maximum applies to finite interaction transitions, not request timeouts, the 750 ms save debounce, skeleton delay, toast lifetime, progress duration or the cycle of a functional loading indicator. Indefinite indicators still need reduced-motion behavior and an accessible status.

Use the shared notification surface with polite live announcements by default. Avoid duplicate announcements from toast and inline status. Errors remain dismissible until closed; consolidate repeated errors by operation/record and clear sensitive content on context reset. A persistent inline indicator retains unresolved failure state after toast dismissal. Do not force focus to a toast or automatically remove a focused action. An urgent assertive announcement needs a documented accessibility reason. A six-second toast must not remove the only available recovery action; provide an untimed equivalent or the controls required by [WCAG timing guidance](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html). Product copy uses German/English locale keys under the ACP i18n rules.

### R7. Infinite-list refresh remains explicit

New compatible lists adopt the shared infinite/virtualized mode when ADR-0035's implementation is available; unsupported sorts and pre-migration lists retain offset behavior. Do not hand-build a second infinite implementation or assume accepted means shipped.

For migrated infinite lists, realtime, mutation settlement, Undo, prefetch completion, focus and reconnect must not trigger a refetch of all retained pages. Use the shared stale-without-refetch path and explicit refresh notice. A field-only optimistic patch is permitted only if it preserves current result membership/order; otherwise keep the list as a visibly stale snapshot and offer refresh. Never silently insert, remove or reorder rows in a retained cursor chain as if it were complete. Detail queries may reconcile independently. Refresh aborts pending work, discards the cursor chain, clears selection and fetches page one/count under ADR-0035, with no old-context preview.

The current optimistic helper's unconditional settlement invalidation needs an explicit infinite-list integration before such lists use it; current behavior is not compliant by declaration.

### Enforcement and source of truth

This ADR owns the rationale and contract. After acceptance, the root `AGENTS.md` section “Frontend interaction rules” becomes the single coding-agent entry point, linking here and to the shared APIs; do not copy the rules to `.cursor/rules`, CLAUDE.md or skills. Reconcile overlapping skill guidance by linking to that entry point. Add one interaction-compliance item to the PR checklist and Definition of Done. This proposal does not make those repository edits or claim new CI enforcement exists.

Implement guards alongside the shared capabilities, before applying them to new consumers:

| Guard | Enforceable boundary |
|---|---|
| Mutation classification | Discover direct `useMutation` calls and registered generated/custom wrapper definitions and consumers; require the operation inventory classification and trace optimistic entries to the shared helper. Test alias imports and wrapper escapes; a rationale comment alone is not an exemption. Static analysis proves wiring, not business safety. |
| Intent prefetch | Check navigable DataTable consumers, including shared wrappers, for the shared callback/scheduler or a reasoned non-navigable exception. Fake-timer tests prove intent delay, cancellation and deduplication. |
| Keyboard uniqueness | Extend registry parity to scopes, reserved keys, simultaneous availability and dispatcher precedence. Include dynamic child actions if assigned shortcuts; do not assert global uniqueness across unrelated row scopes. |
| Transition duration | Cover new Tailwind duration classes, CSS and motion/JS APIs used in the repo, resolving shared duration tokens. Unknown dynamic durations require review rather than silently passing. Classify functional repeating indicators separately. |

Each guard has a checked-in baseline of existing violation identities at activation. CI rejects new identities and baseline growth relative to the PR base, and also rejects stale entries for violations already removed. A migration removes its exact baseline entry in the same change. Renaming, suppressions, broad directory exemptions and helper stubs cannot manufacture compliance. Legitimate server-confirmed classifications are a separate reviewed inventory, not legacy debt that must shrink. Any new mutation wrapper must be registered with guard coverage before use.

For each guard, prove at least: a new violation fails; baseline growth fails; removing a violation without its baseline entry fails; removing both passes. Also test the claimed discovery boundaries. Unsupported static forms remain explicit review gaps until covered, never a claim that every mutation is automatically proven safe. QA treats violations as bugs after the corresponding capability/guard is active.

## Implementation and Validation

1. **Approve and inventory.** Accept or amend this ADR, classify mutation/query families and current violations, identify owners, and reconcile the root agent entry point and checklist/DoD locations. Verify tracking dependencies before assigning implementation scope.
2. **Shared foundation and pilot.** Extend the existing helper/realtime paths for entity ordering, context fencing and ADR-0035 stale marking; introduce shared loading, recovery, intent-prefetch and shortcut behavior. Pilot a reversible non-financial edit with the backend inverse/version contract before expanding Undo. No new general create/version platform is a prerequisite for ordinary eligible updates.
3. **Guards and new consumers.** Activate independently tested guards/baselines with the capabilities they check. New code uses them once available; unavailable features remain documented server-confirmed/offset behavior, not per-page substitutes.
4. **Module migration.** Migrate orders, invoices, vehicles and inventory in separate reviewed changes. Financial/authorization exceptions stay server-confirmed. Per-endpoint optimistic creates and Undo require their own backend acceptance evidence.

Implementation acceptance must exercise these concrete cases in the owning existing specs:

| Case | Required outcome |
|---|---|
| Two edits on one record through different hooks; one fails; another row succeeds | No rollback or late response overwrites a newer edit or unrelated row; final cache agrees with authorized server state. |
| Own realtime echo, another user's event, reconnect during pending writes | No flicker or lost external update; normal queries reconcile and infinite queries only mark stale. |
| Timeout after a committed create; retry; changed payload/site or expired receipt | No duplicate creation or cross-context receipt disclosure; mismatched bindings rejected; no blind retry after retention; temporary IDs replaced once after confirmed reconciliation. |
| Validation rejection, conflict, offline form edit | Localized persistent recovery; current server value on conflict; dirty input preserved under ADR-0006; no unsafe automatic replay. |
| Undo after another user edits, access is revoked, or a fiscal lock changes; double Undo | Atomic rejection without overwriting; current authorization/business checks; no duplicate inverse. |
| Filter/sort/page change, refresh failure, tenant/site switch during request | Stale previews never become actionable; context reset clears data and late patches/undo cannot restore it. |
| Hover then leave, focus then blur, touch scroll, repeated hover | No render-driven requests; canceled timers; shared in-flight deduplication and bounded speculative cache/work. |
| j/k/x/?, Cmd/Ctrl+Z, editable content, IME, key repeat and overlapping scopes | One authorized action at most; native text undo preserved; focus and visible alternatives retained. |
| Reduced motion, screen reader, expired toast with keyboard focus | Static progress remains perceivable; no duplicate live announcements or lost sole recovery action. |
| Migrated infinite list mutation, Undo, reconnect and explicit refresh | No retained-chain refetch or implicit cursor reordering; explicit refresh starts a fresh chain/count. |

This PR has no new entities, lifecycle changes, migrations, API contracts or product strings. It therefore does not change the deletion policy or regenerate OpenAPI. Follow-on inverse/idempotency endpoints and DTOs must regenerate both contract artifacts under ADR-0010; any entity lifecycle change must update `docs/deletion-policy.md` in that implementation PR. Focused local tests and full CI suites follow repository policy; the scenarios above are required future evidence, not test results from this documentation review.

## Draft Review Record

The imported draft is preserved unchanged for comparison. These are sequential self-review passes, not independent reviewer approvals.

| Pass | Findings and resulting revision |
|---|---|
| 1 — Existing contracts | Removed blanket soft-delete, preserved ADR-0006 triggers/recovery, distinguished existing helpers from missing version/idempotency contracts, and made ADR-0035 refresh precedence explicit. |
| 2 — Failure and concurrency | Removed delayed writes/unload-flush guarantees; separated rejection from unknown commit outcome; required atomic versioned inverse, entity-wide ordering, safe retry and context-generation fencing. |
| 3 — Accessibility and enforceability | Added focused/disableable character shortcuts, untimed recovery access, non-actionable stale previews, bounded prefetch, precise transition scope and baseline/discovery tests instead of a universal lint guarantee. |

## Consequences

### Positive

- Common edits feel immediate without pretending shared-resource or financial decisions have succeeded.
- Recovery, loading, keyboard and prefetch behavior reuse shared components and the Action Registry.
- New work can be checked incrementally while existing modules migrate without rewriting every screen.

### Negative

- Correct rollback, inverse operations and cache/context fencing require integration tests, not only lint.
- Server-confirmed exceptions remain slower; some creates and Undo cannot be offered until backend contracts exist.
- Guard discovery and shrinking baselines need maintenance as wrappers and styling APIs evolve.

### Neutral

- No local synchronization engine, general offline write queue or universal version migration is introduced.
- Proposed authorization work in ADR-0034 and accepted list architecture in ADR-0035 retain their own rollout gates.

## Alternatives Considered

| Option | Benefit | Reason not selected |
|---|---|---|
| Optimistic everything with snapshot rollback | Uniform instant feedback | Unsafe for authoritative calculations, contested resources and overlapping edits. |
| Server-confirm every edit | Smallest implementation; retained for exceptions | Unnecessary latency for predictable low-conflict updates already supported by the helper. |
| Delayed commit plus unload flush | Simple-looking Undo window | Browser exit cannot guarantee persistence; timers postpone visibility to other users. |
| Universal soft-delete, versioning and local sync | Broad recovery potential | Conflicts with lifecycle policies and adds backend/storage scope beyond this interaction proposal. |
| One lint rule proves every interaction safe | Attractive CI promise | Syntax cannot establish reversibility, authorization or concurrency correctness; needs inventory plus behavioral tests. |

## Pragmatic Enforcer Analysis

Necessity **8/10**: existing helpers and inconsistent interactions justify a common contract. Complexity **5/10**: shared capabilities and incremental guards add work without a new sync architecture; ratio **0.63**, below 1.5. The simpler alternative is server confirmation everywhere, retained wherever safety contracts are missing. Recommendation: approve the phased proposal after human review. Waiting preserves inconsistent feedback; no measured latency benefit is claimed. General versioning, broader restoration and durable undo history remain [conditional follow-ons](../.architecture/deferrals.md#frontend-interaction-follow-ons-adr-0036).

## References

- [Original draft](../00-Inbox/concept-frontend-interaction-rules.md)
- [ADR-0001: Realtime](2026-04-12-prisma-extends-realtime-sync.md), [ADR-0005: Deletion](2026-04-12-deletion-policy-enforcement.md), [deletion policy](../../deletion-policy.md)
- [ADR-0006: Auto-save](2026-04-12-form-auto-save-patterns.md), [ADR-0010: OpenAPI](2026-04-12-openapi-contract-first.md)
- [ADR-0013: Tenant isolation](2026-04-15-row-level-multi-tenancy.md), [ADR-0022: Site scope](2026-08-31-site-operational-scope.md)
- [ADR-0034: Custom roles — proposed](2026-11-02-custom-tenant-roles.md), [ADR-0035: Infinite lists — accepted](2026-11-02-cursor-based-infinite-lists.md)
- [Action Registry](../../../apps/core-web/src/features/actions/entity-action.ts), [table row behavior](../../../apps/core-web/src/components/data-table/data-table-row-behaviour.ts), [client session reset](../../../apps/core-web/src/auth/client-session-reset.ts)
- [TanStack Query optimistic updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)

## Linear Tracking

The supplied draft names “Frontend: Linear feeling”, AUT-875 through AUT-893, and AUT-783 for mobile actions. These are source-supplied references; this documentation review does not verify their current scope/status or create/update issues. Map approved phases to the live project before implementation.
