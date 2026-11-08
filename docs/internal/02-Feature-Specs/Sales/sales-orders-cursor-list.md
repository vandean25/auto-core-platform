---
title: "Sales Orders Cursor List (AUT-891 wave 2)"
date: "2026-11-08"
module: "Sales"
status: draft
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - feature-spec
  - sales
  - tables
  - adr-0035
  - adr-0038
---

# Sales Orders Cursor List (AUT-891 wave 2)

## Summary

> Infinite, cursor-paged mode for the Sales Orders list (`/sales-orders`), the planned second wave of AUT-891 after invoices. It adds an opt-in cursor list and capped-count contract, keeps the legacy offset contract unchanged, and relies on the scope-context contract of [ADR-0038](../../01-ADR/2026-11-08-authoritative-scope-context-for-cursor-lists.md) for principal, session and scope safety. It builds on [ADR-0035](../../01-ADR/2026-11-02-cursor-based-infinite-lists.md) and the [list-scrolling concept](../../00-Inbox/concept-list-scrolling.md).

**Status: draft, not approved.** Approval of this specification is itself a gate (see "Gates and Sequencing"). Part of AUT-891; this document does not complete the issue, claim QA acceptance or authorize implementation. It selects no further wave. The Sales Orders list is the only wave candidate named here.

**Evidence labels.** *Observed* facts come from reading `main` at `9284e46` in the AUT-891 session; the Software Engineer re-verifies them. *Measured (disposable)* facts come from a throwaway database migrated from this repository's migrations; they are no evidence for QA or production. *Proposed* items are recommendations. Endpoint names, error-code names and component names are proposals until the implementation is approved.

---

## Scope

In: the Sales Orders list endpoint in cursor mode, its capped count, and the web list at `/sales-orders`.

Out: any other list; removing or changing offset behavior; Sales Orders selection or bulk actions; filter-wide exports; denormalized or new date columns; any change to list/detail visibility, permissions or fiscal rules; a new business action. The shared scope-context work of ADR-0038 is a separate prerequisite with its own approval and PR, not part of this wave.

---

## Observed Baseline

| Area | Finding |
|---|---|
| Endpoint | `GET /api/sales-orders` (`SalesOrderController.findAll`). Query: `status`, `search`, `page`, `pageSize` (default 25), `sortField`, `sortDirection`, and a JSON `params`. Response `{ data, meta: { total, page, pageSize, pageCount } }`. Rows carry the order with `customer`, `vehicle` (identity-resolution fields stripped) and `items`. |
| Sort whitelist | `status`, `order_number`, `total_amount`, `createdAt`, `customer.last_name`, `customer.company_name`. Others are silently dropped. |
| Order | `QueryBuilder.buildOrderBy` adds no `id` tiebreaker. With no sort, the paginated path has no `ORDER BY`, so the default order is unspecified. |
| Search | `contains`, case-insensitive, OR over `order_number`, `customer.last_name`, `customer.company_name`. The controller assigns a truthy `search` as given, so whitespace-only input from a direct caller is literal. The web replaces a whitespace-only search box with the first non-empty `filter_order_number` fallback value and sends it untrimmed; a whitespace-only fallback value is sent as is, and any other search is sent untrimmed. |
| Status and `params` | A `status` query replaces **all** `filters` from `params`. `status` is not validated against the enum. The web sends flat parameters only, never `params`. |
| Visibility | `sales.order.read` (`BACK_OFFICE_DEMO`, site scope). The service calls `getSiteId()`, which throws `ACTIVE_SITE_REQUIRED` (422) without a valid active site. Rows are filtered by `tenant_id` and `site_id = active site`, so null-site rows are excluded. `findOne` uses authorized sites, so list and detail visibility differ; this spec does not change that. |
| `order_number` | Text, unique per tenant, not null. Format `${prefix}${n}` with an unpadded number and a tenant-set prefix. Order is the database text order, not numeric. |
| `createdAt` | Non-null date-time. The UI column "Datum" is `createdAt`; there is no separate order-date field. |
| Measured (disposable) | `createdAt` is `timestamp without time zone` with precision 3; `order_number` is `text`; the database collation was `C.UTF-8` (byte order: `SO-2026-10000` sorts before `SO-2026-1001` and `SO-2026-9999`). Indexes on `sales_orders`: primary key, unique `(tenant_id, id)`, `(tenant_id)`, unique `(tenant_id, order_number)`, `(tenant_id, site_id)`, trigram GIN on `order_number`. |
| Web list | `SalesOrderList` uses `useSalesOrders` with offset paging (default page size 10), `sortFieldMap` `customer` → `customer.last_name`, `exactFilterMap` `status` → `status`, search fallback on `filter_order_number`. No `initialSorting`, no `bulkActions`, no `meta.mobile` on columns. |
| Saved Views | Stored as `{ name, href }` with a normalized query. Date sort key `createdAt`, customer sort key `customer`, status filter key `filter_status`, plus `search`, `page`, `pageSize`. |
| Delete | DRAFT-only Delete is a right-click context action with a browser `confirm()`. The endpoint requires `sales.order.delete` and rejects orders that are not DRAFT or that already have an invoice. It is not a registry action and has no keyboard or visible-mobile path. |
| Realtime and export | `SALES_ORDER` events invalidate `salesOrderKeys.all` and the `sales-orders` dashboard source. CSV export covers loaded rows only. |
| Prefetch baseline | The intent-prefetch baseline lists `pages/sales-orders/SalesOrderList.tsx::DataTable::missing-intent-prefetch`; wiring prefetch removes that line. |

---

## User Stories

- As a **back-office user**, I want to **scroll through all sales orders without pages** so that **I can find and open an order quickly**.
- As a **back-office user on a phone**, I want a **readable card with the vehicle and date** so that **I can identify an order without opening it**.
- As a **user with a saved view**, I want **my saved search, status and sort to keep working** so that **migration does not change my views**.

---

## Requirements / Scenarios (WHEN/THEN)

Six focused ticket scenarios, each one named proposed test and one runner. File names are proposals, not claims that the files exist. They are not a cap on total coverage; see the supporting matrix.

1. **WHEN** static tied `createdAt` values are paged under a non-UTC runtime **THEN** the `(createdAt, id)` tuples round-trip and order correctly. Test `salesOrders_static_timestamp_roundtrip`; backend e2e, proposed `sales-orders-cursor.e2e-spec.ts`.
2. **WHEN** 1,000 versus 1,001 authorized matches exist **THEN** the capped count reports `{1000, isCapped: false}` versus `{1000, isCapped: true}`. Test `salesOrders_exact_count_boundary`; backend e2e, same file.
3. **WHEN** an external role assignment (and, once database role definitions exist, a role definition) changes A→B→A with websocket delivery suppressed **THEN** a request carrying the old expected scope is rejected. Test `salesOrders_missed_event_epoch_replay`; backend e2e, same file. Depends on the ADR-0038 prerequisite.
4. **WHEN** a resync invalidates the context before delayed page and count responses resolve **THEN** neither repopulates the cache. Test `cursorScope_resync_rejects_late_results`; web unit, proposed `cursor-scope.test.tsx`. Shared behavior (ADR-0038).
5. **WHEN** concurrent invalid-cursor failures recover successfully and then fail again in one episode **THEN** only one automatic restart occurred. Test `cursorRecovery_shared_episode_budget`; web unit, proposed `cursor-recovery.test.tsx`. Shared behavior (ADR-0038).
6. **WHEN** a `SALES_ORDER` realtime event arrives **THEN** retained rows stay unchanged until an explicit fresh-chain refresh. Test `salesOrders_explicit_realtime_refresh`; web unit, proposed `SalesOrderList.test.tsx`.

Scenarios 1, 2 and 6 exercise the Sales Orders keyset, count and ADR-0035 §7 behavior; 3 to 5 exercise the ADR-0038 contract on this consumer.

---

## Contract

### Mode and eligibility

Cursor mode is opt-in (`pagination=cursor` or a `cursor` parameter). A request without them gets the unchanged offset response. The web chooses one mode per list state and never mixes them.

The web uses cursor mode only when **all** hold: the sort is none, `order_number` or `createdAt`; no filter other than `status` and the existing search fallback is present; and nothing else has effect or unknown or ambiguous semantics. Otherwise it keeps the unchanged offset mode with the same sort, filters and search; it never deletes a filter to become eligible. `customer`, `customer.last_name`, `customer.company_name`, `status`, `total_amount` and unknown sorts stay offset.

### Sorts and comparator

| Sort | Directions | Notes |
|---|---|---|
| none (cursor only) | `createdAt DESC, id DESC` | The legacy default is unchanged and unspecified. |
| `createdAt` | ASC, DESC | Non-null. |
| `order_number` | ASC, DESC | Non-null; database text order, never numeric. |

The unique `id` tiebreaker always runs in the same direction as the primary sort. For ASC a row follows the cursor `(cv, cid)` when `v > cv`, or `v = cv` and `id > cid`; DESC mirrors with `<`. Comparison and `ORDER BY` run in the database with the same operators and collation for `order_number` and `id`, never in application code. The deployed collation is unproven (see evidence), so the contract is "the database's text order".

### Timestamp interpretation

The cursor carries `createdAt` in a canonical UTC form at the stored precision. Parsing is strict: a value that does not round-trip exactly is rejected as an invalid cursor. The disposable database showed precision 3; precision on QA and production, and Prisma behavior under a non-UTC runtime, are unproven. Final approval must not rely on precision until that evidence exists.

### Parameters and the single resolver

One pure resolver takes the untrusted query (search, status, `params`, sort, limit, cursor) and the trusted context (principal, tenant, site, scope context) as separate inputs. It produces the effective search, status and filter semantics used identically for the SQL rows, the SQL count and the cursor fingerprint. There is no trim-only fingerprint.

Cursor-mode rules for direct API callers:

1. `page` and `pageSize` are forbidden: documented `400`.
2. The legacy override is applied first: a `status` query replaces `params.filters`. The effective filters are computed after it.
3. Any `params` component that is still effective after flat parameters override it (`filters` without `status`, `search` without a flat `search`, `sorting` without a flat `sortField`), or that is unknown or ambiguous, returns a documented `400`. `params.page` and `params.pageSize` are always forbidden.
4. An invalid `status` returns a documented `400`. Legacy handling is unchanged.
5. `search` is used as given. Direct whitespace stays literal. The web's search resolution is the existing `resolveListSearch` behavior (see the baseline) and is not changed.
6. In cursor mode any `sortField` other than `createdAt` or `order_number`, including one outside the legacy whitelist, and a `sortDirection` without a `sortField`, returns `LIST_CURSOR_SORT_UNSUPPORTED`; nothing is silently dropped or replaced by the default order. Only a request with neither returns the default `createdAt DESC, id DESC`.

The web never sends `params` today, so for web requests rule 3 reduces to the eligibility rule above.

### Scope context, errors and recovery

The scope-context contract is [ADR-0038](../../01-ADR/2026-11-08-authoritative-scope-context-for-cursor-lists.md): the expected scope context is mandatory on the cursor list and the count request, a cursor binds the scope-context digest, requests are authorized at a single snapshot, and typed context errors rank after 401/403/422 and before the cursor codes. Sales Orders is not covered by that contract before enforcement is on for both of its endpoints.

Precedence on this endpoint: 401/403/422; then `CONTEXT_REQUIRED` / `CONTEXT_MISMATCH`; then the parameter-validation 400s (forbidden parameter, effective or unknown `params`, invalid `status`); then `LIST_CURSOR_SORT_UNSUPPORTED`; then `LIST_CURSOR_INVALID`. The parameter-validation 400s are "other 4xx" in ADR-0038 §9: an error state, no automatic retry, not budgeted. A request that fails both context and parameter validation therefore returns the context error.

Error classes on this endpoint: `401/403/422` (unchanged, never auto-retried); `CONTEXT_REQUIRED` and `CONTEXT_MISMATCH` (ADR-0038); `LIST_CURSOR_INVALID`; `LIST_CURSOR_SORT_UNSUPPORTED`; and the documented `400` codes for forbidden parameters and an invalid `status` (code names proposed).

Recovery follows ADR-0038 §9: one total automatic action per stable query episode shared by page and count; singleflight; quarantine, flush and late-result fencing always; no automatic retry of 401/403/422; a valid-context `LIST_CURSOR_INVALID` allows one restart that preserves all effective parameters. Recovery-generated continuity after a budgeted restart does not rearm the shared episode budget. The API returns `LIST_CURSOR_SORT_UNSUPPORTED` for an unsupported cursor sort; only the UI latches the existing offset mode at offset 0 for that episode, keeping sort and filters, with no repeated cursor attempts. Filters are never removed to recover.

### Visibility

Unchanged after validation: `tenant_id`, `site_id = active site`, null-site rows excluded, `sales.order.read`, `ACTIVE_SITE_REQUIRED` (422) without an active site. A cursor never replaces fresh authorization. List and detail visibility are not harmonized, and no date field is invented.

### Count

The same resolver feeds the count: effective search and status, tenant and active site, no keyset predicate and no sort. It reads at most 1,001 ids: exactly 1,000 matches returns `{ count: 1000, isCapped: false }`; 1,001 or more returns `{ count: 1000, isCapped: true }`, displayed "1.000+" only then. The independent 2,000 loaded-row ceiling is unaffected by count semantics. Count identity binds the resolved filters and the scope-context digest, not sort. A sort-only change keeps a safe count under the ADR-0038 conditions; otherwise it refetches. Rows and count are separate observations.

### Limits

Default limit 25 (set per endpoint, as for invoices) and the shared ceiling 100 (`GLOBAL_LIST_LIMIT_MAX`); the web loads blocks of 50 and stops at 2,000 loaded rows (ADR-0035 §1).

### Examples (proposed)

```
GET /api/sales-orders?pagination=cursor&sortField=order_number&sortDirection=asc&status=CONFIRMED&search=Meier&limit=50
X-ACP-Scope-Context: <opaque>
200 { "data": [ { "id": "…", "order_number": "SO-2026-1001", "status": "CONFIRMED",
        "createdAt": "2026-11-07T10:00:00.123Z", "customer": {…}, "vehicle": {…}, "items": […] } ],
      "meta": { "nextCursor": "<opaque>", "hasNextPage": true, "limit": 50,
                "scopeContextDigest": "<digest>" } }

GET /api/sales-orders/capped-count?status=CONFIRMED&search=Meier
200 { "count": 1000, "isCapped": true, "scopeContextDigest": "<digest>" }

(with a valid X-ACP-Scope-Context header)
GET /api/sales-orders?pagination=cursor&page=2        → 400 (forbidden parameter)
GET /api/sales-orders?pagination=cursor&sortField=total_amount → 400 LIST_CURSOR_SORT_UNSUPPORTED
(without the header)
GET /api/sales-orders?pagination=cursor&page=2        → CONTEXT_REQUIRED (context ranks first)
(offset mode, unchanged)
GET /api/sales-orders?page=2&pageSize=25&sortField=status      → unchanged offset response
```

---

## Ordering Guarantees and Limits

- At one instant the order is total: `(createdAt, id)` or `(order_number, id)`.
- No-gap and no-repeat apply to **stable fixtures only**, not mutable live data. There is no snapshot guarantee.
- Inserts beyond a cursor boundary can appear in the chain, in either direction including ASC. There is no promise that new orders appear at the top.
- A row whose sort value or scope changes can be skipped or seen again. Deduplication by id cannot recover a skipped row.
- A deleted cursor row does not invalidate continuation, because the cursor holds a tuple, not a row reference. This is the intended behavior and is to be verified.
- Pages and counts are separate observations.

---

## Database Impact

### New Tables / Columns

None from this wave. ADR-0038 adds its own table and counters under its separate prerequisite.

### Modified Tables

| Table | Change | Migration Required? |
|-------|--------|---------------------|
| `sales_orders` | Candidate additive indexes `(tenant_id, site_id, "createdAt", id)` and `(tenant_id, site_id, order_number, id)`; one ascending index per sort may serve both directions by backward scan | Yes, if plans justify them |

Indexes remain candidates. Existing indexes are not claimed to be unable to serve the ordering, filtering or search. Future real endpoint and Prisma-emitted plans are required, before completion, for first page and continuation, both directions, search and status, and the count probe. The customer-name search is a join and may not be index-served.

### Deletion Policy Impact

None: no entity or lifecycle rule changes.

---

## API Contract Changes

### New Endpoints

| Method | Route | Request | Response | Auth |
|--------|-------|---------|----------|------|
| GET | `/api/sales-orders/capped-count` | `search`, `status`, scope-context header | `{ count, isCapped, scopeContextDigest }` | `sales.order.read`, site scope |

### Modified Endpoints

| Method | Route | Change Description |
|--------|-------|--------------------|
| GET | `/api/sales-orders` | Additive cursor mode (`pagination=cursor` / `cursor`, `limit`); offset behavior unchanged |

### OpenAPI Regeneration

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

### Mobile card

Order number is the title, customer the subtitle, then status, with the amount trailing, plus the date **and** the vehicle when present. Targets are at least 44px and text stays compact. If the existing card supports several compact details, use them. Whether it does is unverified; if not, a bounded additive slot is proposed, which must change no other list and needs separate review. A broader primitive change is out of scope. The vehicle is never silently dropped.

### DRAFT Delete parity

The existing DRAFT-only Delete becomes a registry action with a stable `<entity>.<action>` id (for example `salesOrder.delete`), gated through the existing role predicates, reachable through Cmd+K with identical role gating and confirmation, and with a visible mobile path through an existing pattern. The endpoint, `sales.order.delete` permission, the rejection of non-draft or invoiced orders and the confirmation requirement are unchanged. There is no right-click-only or long-press-only path, no new business action and no new permission. The confirmation mechanism follows the registry convention, to be verified. Migrating an existing action may require removing its baseline entry, which may only shrink (`agents.md`).

### Saved Views and URL

Stored hrefs are never rewritten. `page` and `pageSize` are stripped only from the network requests of an eligible infinite list. Compatibility with the live URL, table-state and request pipeline is unproven and needs evidence. The `customer` → `customer.last_name` mapping and the unsupported-sort offset fallbacks are preserved; there is no silent key migration.

### List and interaction rules

- [ ] Standard list header, `+ Order`/`New order` action unchanged, search across the existing fields, sortable headers via `DataTable`.
- [ ] Status cells use `StatusBadge`; row click opens the detail view.
- [ ] No Sales Orders selection is introduced.
- [ ] Row prefetch is wired through `scheduleDetailPrefetch` (ADR-0036 R4); the baseline may only shrink.
- [ ] Any new user-facing text exists in German and English (i18n skill).
- [ ] Keyboard navigation across virtualization boundaries; loading, empty and error states; 375px and 320px with 200% zoom.

### Real-Time Sync

`SALES_ORDER` marks the retained cursor list stale without refetching and shows "Liste aktualisieren". Refresh restarts at page one and scrolls to the top without refetching the old chain. Nothing reshuffles automatically.

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `SalesOrderList` | `apps/core-web/src/pages/sales-orders/` | Mode choice, mobile card roles, registry Delete, prefetch |
| `useSalesOrderListState` (proposed) | `apps/core-web/src/api/` | Chooses cursor or offset per state, like the invoice list state |
| `salesOrderKeys` | `apps/core-web/src/api/sales-orders.ts` | Add cursor-list and count keys; keys include the scope-context digest |
| Sales order cursor helper (proposed) | `apps/core-api/src/sales/sales-order/` | Resolver, sort config, cursor binding, capped count |

---

## Testing Plan

New behavior follows the TDD workflow in `agents.md`: each new test must fail against the pre-change code. Characterization baselines pin only existing correct behavior. No test fabricates its own expected state.

### Backend E2E

- [ ] Scenarios 1, 2 and 3 in the proposed `sales-orders-cursor.e2e-spec.ts`, plus coherent-authorization races, all epoch writers, principal and site transitions, denied access (no `sales.order.read`, no active site, other tenant or site, null-site rows), resolver cases (canonical `params` after the status override, search with whitespace, status, forbidden and invalid parameters), late counts, and the unchanged legacy offset responses.

### Frontend

- [ ] Scenarios 4, 5 and 6, plus: unsupported-sort latch, no automatic retry of 401/403/422, Saved View and live-URL compatibility (including legacy `page`/`pageSize`), mobile date and vehicle, Delete parity (registry, Cmd+K, visible mobile), generic selection behavior on an existing list, keyboard navigation across virtualization, 320 and 375px, 200% zoom, DE/EN, loading, empty and error states, concurrent mutable data, large data, and the existing invoice, inventory and vehicle-stock regressions after shared changes.
- [ ] Full PR E2E in CI. Visual QA in a browser.

---

## Gates and Sequencing

**Pre-start** (implementation of this wave begins only after all are documented):

1. AUT-890 pilot QA acceptance. **Missing.**
2. Invoice-wave QA acceptance. **Missing.**
3. Approval of this corrected specification. **Missing.**
4. ADR-0038 accepted as the shared scope-context design (repository status today).

Approved bounded shared-prerequisite readiness on the three existing ADR-0038 consumers remains a pre-start gate when a separately owner-approved prerequisite correction exists; this spec does not authorize that correction.

**Completion / rollout** (not pre-start): implementation and integration of the Sales Orders cursor list and capped-count endpoints; ADR-0038 enforcement turned on for both; query plans on representative data; and released QA acceptance for this wave. Those items cannot require their own endpoints to exist before implementation starts.

Merges, reviews and scratch probes do not substitute for 1–2. If shared defects block the predecessors, a bounded prerequisite correction is proposed separately for explicit owner approval; this document authorizes none. Shared changes need renewed relevant regressions before rollout. QA owns released verification; Infra owns releases. This wave stops after its own PR for owner review.

## Evidence Still Needed

- Schema, collation and timestamp precision on QA and production; Prisma behavior under a non-UTC runtime.
- Real endpoint and Prisma-emitted plans (see Database Impact), and QA search plans on representative data.
- Live URL, table-state and request pipeline for `page`/`pageSize`; mobile card capability; the registry confirmation convention.
- Released-build QA: keyboard navigation across virtualization boundaries, 320px and 200% zoom, the 403 in the UI, site-switch and cursor reset, a real websocket refresh, invalid-cursor recovery.

---

## Remaining-View Inventory (not part of this wave)

The ADR-0035 shared list cursor (`LIST_CURSOR_ENDPOINT`) exists today on three endpoints: vehicle stock, inventory and invoices. Some log and feed endpoints have their own cursor pagination, outside this inventory. About thirty files import the shared `DataTable`; that count is a preliminary `grep`, not an approved rollout list, and includes component-level tables. Besides the migrated lists and Sales Orders, the list pages seen are customers, vehicles, purchase orders, purchase bills, vendors, credit notes, stock transfers, workshop orders, estimates, loaner vehicles, pick list, tyre storage, Gewährleistung-due, HR clock and leave, platform tenants, accounting export readiness and employees. For customers, purchase orders, vendors, credit notes and vehicles only the web hook's offset parameters were seen; the rest are unexamined. Settings and admin tables are neither exempt nor examined. No other view or wave is selected.

---

## Open Questions

1. The documented error-code names and status for forbidden parameters, invalid `status`, `CONTEXT_REQUIRED` and `CONTEXT_MISMATCH`.
2. Whether the mobile card supports several details or needs the bounded additive slot.
3. The confirmation convention for the registry Delete.
4. The compatibility window and identity-provider staleness items left open in ADR-0038.

---

## References

- [ADR-0035: Cursor-based infinite lists](../../01-ADR/2026-11-02-cursor-based-infinite-lists.md)
- [ADR-0036: Frontend interaction rules](../../01-ADR/2026-11-02-frontend-interaction-rules.md)
- [ADR-0038: Authoritative scope context](../../01-ADR/2026-11-08-authoritative-scope-context-for-cursor-lists.md)
- [ADR-0022: Site operational scope](../../01-ADR/2026-08-31-site-operational-scope.md)
- [Concept: list scrolling](../../00-Inbox/concept-list-scrolling.md)
- [Endpoint inventory](../../04-Database/list-endpoint-inventory-adr0035.md)
- [Sales & CRM workflows](sales-and-crm.md)
