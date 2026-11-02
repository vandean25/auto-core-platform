---
title: "ADR-0035: Cursor-Based Infinite Lists With Explicit Refresh"
date: "2026-11-02"
status: accepted
deciders: "Dejan Dosenovic"
tags: [adr, platform, tables, performance]
---

# ADR-0035: Cursor-Based Infinite Lists With Explicit Refresh

## Status

**Accepted — 2026-11-02.** Approved by Dejan Dosenovic. This records the architecture decision; implementation and pilot validation remain outstanding. The [list-scrolling concept](../00-Inbox/concept-list-scrolling.md) supplies the detailed cursor predicates, interaction rules and acceptance cases.

## Context and Decision Drivers

Shared lists use server-side offset pagination and frequently count the full result set. Parts catalogs can contain millions of rows. We want continuous, responsive scrolling without a local sync engine, while preserving tenant/site isolation, existing sorts, record actions and bounded client memory. Virtualization alone reduces rendered elements but does not remove deep-offset or full-count work. Realtime invalidation of an infinite query can refetch every retained page, so refresh behavior must be explicit.

## Decision

1. **Use an optional infinite mode in the shared DataTable.** Combine `useInfiniteQuery` with TanStack Virtual and retain offset mode during migration. Fetch ahead near the end and fill an initially short viewport. Retain at most 2,000 loaded rows per result list, then ask the user to refine filters. Search continues to cover the server-side dataset; this cap is not a complete-result guarantee.
2. **Use scoped, versioned keyset cursors for supported sorts.** Order by one whitelisted field plus unique `id`, both in the same direction, with explicit `NULLS LAST` for ASC and DESC. Use Prisma predicates, preserving existing search/filter conditions through `AND`. Cursor payloads carry version, endpoint, sort/direction, last values, normalized search/filter hash and tenant/authorized-site-context binding. Validate size, structure, types and bindings; reject incompatible cursors with a documented cursor-specific `400` code and offer an explicit page-one restart without retry loops. Obtain tenant and site authorization from the authenticated context on every request, never from cursor contents, following ADR-0013 and ADR-0022.
3. **Keep the API additive and indexed.** Cursor responses use `{ data, meta }` with `meta.nextCursor` (opaque string or `null`) and matching `meta.hasNextPage`. Read the effective limit plus one and build the next cursor from the last delivered row. Preserve each endpoint's existing default, clamping and stricter cap (global ceiling 100; Vehicles 50). Approve sort directions/null placement only with matching indexes and representative query plans, including search filters. Relation, calculated and relevance sorts keep offset until an equivalent replacement is separately approved; no automatic denormalization or relevance truncation.
4. **Treat results as a live list without snapshot guarantees.** Inserts before the cursor appear on refresh; mutable sort values can move records across boundaries. Merge loaded rows by stable record ID to avoid visible duplicates. Do not promise snapshot completeness or infer it from loaded rows or counts.
5. **Count separately and cap the displayed total.** On initial load, search/filter changes and explicit refresh, read at most 1,001 matching IDs under the same authorization and filters. Return `{ count: 0..1000, isCapped: false }` or `{ count: 1000, isCapped: true }`, displayed as “1.000+”. Sorting alone does not recount. Count failure does not block rows; end-of-list follows the cursor. Count and rows are separate observations, and bounded output does not guarantee a cheap unsuccessful search.
6. **Start a fresh chain for changed search, filters or sort.** Abort pending requests, discard the cursor/page chain, clear selection, scroll to the top and fetch page one, including when the selected query key already has cached pages. Suppressing automatic refetches must not suppress this new query. Old rows may remain only as a visibly stale, non-actionable preview until the new result succeeds; errors never reactivate them as current results. Context or permission changes use the central cancel/cache-clear session reset and show no old-context preview.
7. **Use explicit refresh instead of automatic retained-page refetch.** Realtime, local mutations, focus, reconnect, cached remount and periodic refresh paths must not automatically reload every retained page of migrated infinite lists. Mark those list queries stale without refetch and show “Liste aktualisieren”; keep other queries' existing behavior. The action aborts pending loading, discards pages/cursors, clears selection, scrolls to the top and fetches page one plus the separate count. It does not refetch the old chain; normal viewport filling can follow the new first page. Preserve update notifications arriving during loading or refresh. Returning from a detail view may restore cached rows and the record-ID/pixel scroll anchor when context and results are unchanged; missing cache starts at the top without replaying a deep chain.
8. **Preserve explicit-ID selection and action authorization.** Select only loaded IDs explicitly chosen by the user; “select all loaded” captures the currently loaded set and does not silently select future pages. Virtualization preserves selection; search/filter/sort changes, explicit refresh and context changes clear it. Retain server-side authorization and business-rule checks for every selected record and label export scope accurately. Filter-wide bulk actions and new server-side full exports require a separate approved contract; never implement them by loading every page in the browser.
9. **Keep accessibility and mobile behavior part of the shared contract.** Preserve logical keyboard focus across virtual boundaries, Action Registry/Cmd+K parity, semantic headers and logical row indices. Use `aria-rowcount=-1` when the actual total is unknown or capped, announce load/end/error states and provide keyboard-accessible load more. Mobile cards use variable-height measurement and list semantics. Keep search/filter/sort URL state, central scope resets and existing role gating.

## Consequences

### Positive

- Bounds rendering and retained rows while avoiding deep offsets and repeated full counts for migrated sorts.
- Reuses the shared table, query factories and authorization paths, with explicit behavior for concurrent changes and refresh.
- Allows additive rollout and rollback per endpoint/sort without removing existing capabilities.

### Negative

- Requires per-sort index/query-plan work and changes to all invalidation paths targeting migrated lists.
- Results and counts can be stale until explicit refresh; refresh resets scroll to the top. The 2,000-row limit requires filtering to browse further.
- Offset exceptions remain maintained until a suitable replacement is approved; no snapshot or offline-sync guarantee is introduced.

### Neutral

- No new business entity, deletion rule, ledger writer, status transition, numbering series or fiscal rule is introduced. Accepted design does not mean deployed behavior.

## Alternatives Considered

| Option | Benefit | Reason not chosen as the target |
|---|---|---|
| Keep offset paging and add `keepPreviousData` | Smallest UI improvement; retained as migration fallback | Does not address deep offsets, repeated full counts or continuous scrolling |
| Virtualize offset-backed infinite lists | Fewer DOM elements with limited API changes | Keeps deep-offset costs and offset-shift behavior under concurrent inserts/deletes |
| Local sync engine or preload all results | Immediate local browsing after synchronization | Unbounded synchronization/storage for catalog-scale data and unnecessary architecture |
| Automatically refetch all retained pages | Freshens the loaded chain | Work grows with retained pages and event frequency; disrupts the scrolling goal |
| Snapshot browsing or unlimited bidirectional retention | Stronger completeness or browsing guarantees | Adds lifecycle and cache complexity outside the bounded pilot requirement |

## Implementation and Validation

Inventory each endpoint, consumer, sort direction, export and invalidation path before its migration. Introduce the helper, additive indexes/count API and optional table mode; pilot Vehicles and Parts/Inventory first, then invoices and further waves. Remove offset **per endpoint and sort** only after all corresponding consumers, saved views and tests migrate; retain exceptions. Regenerate and commit backend OpenAPI and frontend generated types with every contract change under ADR-0010.

Pilot acceptance must cover cursor ties/nulls/last pages and deleted cursor rows, tenant/site isolation, concurrent updates, capped counts, stale previews, selection/export scope, keyboard and mobile/zoom behavior. Specifically prove that changed or reused cached filters/sorts start at page one/top, explicit refresh discards the old chain, and automatic triggers do not refetch all retained pages. Validate representative query plans and browser states; run focused local checks and full suites in CI under repository rules. The concept's acceptance checklist is the detailed reference.

## Pragmatic Enforcer Analysis

Necessity **8/10**: catalog scale and continuous-scroll requirements justify the decision now. Complexity **5/10**: adds cursor/index and invalidation work but reuses existing infrastructure; ratio **0.63**, below 1.5. The simpler offset-plus-placeholder option remains the fallback. Recommendation: **approve the bounded, phased design**, without a sync engine, global offset removal or filter-wide bulk semantics. Waiting preserves page navigation and deep-offset/full-count costs; no measured latency improvement is claimed before the pilot. Follow-on capabilities are recorded in the [deferral log](../.architecture/deferrals.md#infinite-list-follow-ons-adr-0035).

## References

- [Detailed concept and pilot acceptance](../00-Inbox/concept-list-scrolling.md)
- [ADR-0001: Realtime sync](2026-04-12-prisma-extends-realtime-sync.md)
- [ADR-0010: OpenAPI contract](2026-04-12-openapi-contract-first.md)
- [ADR-0013: Tenant isolation](2026-04-15-row-level-multi-tenancy.md)
- [ADR-0022: Site scope](2026-08-31-site-operational-scope.md)

## Linear Tracking

No implementation issue is assigned by this ADR. Tickets follow the phased rollout above; acceptance of this document does not claim their completion.
