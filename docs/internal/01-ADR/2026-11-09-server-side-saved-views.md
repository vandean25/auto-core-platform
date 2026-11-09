---
title: "ADR-0039: Server-Side Saved Views"
date: "2026-11-09"
status: accepted
deciders: "Product Planner, ACP Software Engineer (under delegation of Dejan Dosenovic)"
tags: [adr, platform, tables, permissions, saved-views]
---

# ADR-0039: Server-Side Saved Views

## Status

**Accepted — 2026-11-09.** Decided by Product Planner + ACP Software Engineer under Dejan Dosenovic's delegation of 2026-11-09. Replaces localStorage as the source of truth for AUT-880 saved views after a committed import. Linear: AUT-885.

## Context

Saved views (AUT-880) live in localStorage per user and tenant: they are lost across devices and cannot be shared. AUT-880 caps **30 views per user per tenant across all lists** (`MAX_SAVED_VIEWS`); this ADR raises the steady-state cap to **50 PERSONAL views per user per list** (and 50 TENANT per tenant per list) so dense list-specific filters are not constrained by the old global total. Shared views need a server-side model, a marker for one-time import, and a new permission.

## Decision

### Data model

1. Table `saved_views` (tenant-scoped per [ADR-0013](2026-04-15-row-level-multi-tenancy.md)): `id`, `tenant_id`, `owner_user_id`, `list_path`, `name`, `href`, `visibility` (`PERSONAL` | `TENANT`), `version`, timestamps. `owner_user_id` is **non-null** when `visibility = PERSONAL`; it is **nullable** only for `TENANT` rows after membership removal nulls the former owner.
2. Partial unique names (case-insensitive): PERSONAL per `(tenant_id, owner_user_id, list_path, lower(name))`; TENANT per `(tenant_id, list_path, lower(name))`.
3. Table `saved_view_imports` (tenant-scoped): primary key `(tenant_id, user_id)`, column `imported_at`. Unique per member; not per list path.

### Scope and opening views

4. No site dimension. Opening a view hits the normal list route; data is re-authorized with the viewer's own role and site ([ADR-0022](2026-08-31-site-operational-scope.md)).

### Authorization

5. **TENANT:** list, get-by-id, copy, and realtime delivery return a view only when the viewer currently holds the read permission for its `list_path`, via a server-side `list_path → permission` registry on every request.
6. **PERSONAL:** list, get-by-id, update, delete, and realtime are limited to rows where `owner_user_id` equals the viewer inside the tenant. No API returns another member's PERSONAL views. Palette and Cmd+K aggregates apply the same `list_path` read permission as TENANT rows (a view the owner kept after losing list access is omitted).
7. Permission `views.shared.manage` (default OWNER, ADMIN; catalogue lands with [ADR-0034](2026-11-02-custom-tenant-roles.md)) for create, edit, delete, and unshare of TENANT views. **Share** (PERSONAL → TENANT) requires `owner_user_id` equal to the caller **and** `views.shared.manage`. PERSONAL update and delete require `owner_user_id` equal to the caller only (`views.shared.manage` does not bypass ownership). Copy of a permitted TENANT view inserts a new **PERSONAL** row for the caller (new server id, name/href derived from the source).

### Validation

8. `list_path` must be in the registry; otherwise 400 `SAVED_VIEW_INVALID`.
9. `href` must be a relative path whose pathname equals `list_path` and whose query keys are a subset of that list's allow-list (including keys AUT-880 already persists after stripping transient `page`, `peek`, and `action` — e.g. `pageSize` and sort/filter params registered for that list). Absolute, protocol-relative, and `javascript:` URLs are rejected. The same rules apply to create, update, share, and import.

### Limits and locking

10. Limits: 50 PERSONAL per `(tenant, owner, list_path)`, 50 TENANT per `(tenant, list_path)`; `name` ≤ 60 characters, `href` ≤ 2,000 characters; 422 `SAVED_VIEW_LIMIT`; name clash (including a rename that loses the partial unique index) 409 `SAVED_VIEW_DUPLICATE`.
11. **Advisory lock namespace:** cap and import locks use dedicated `pg_advisory_xact_lock(int4, int4)` class ids (`SAVED_VIEW_CAP_LOCK_CLASS`, `SAVED_VIEW_IMPORT_LOCK_CLASS`) disjoint from the per-tenant authorization lock in [ADR-0034](2026-11-02-custom-tenant-roles.md). The second key hashes `(tenant_id, owner_user_id, list_path)` for PERSONAL caps, `(tenant_id, list_path)` for TENANT caps, and `(tenant_id, user_id)` for import idempotency.
12. Before counting or writing, take the cap lock for the target bucket and `list_path` (**create**, **copy**, **claim**, **import**, **share**, **unshare**, **membership removal**). When a transaction needs more than one cap lock, use one **total order**: ascending `list_path`, and for the same `list_path` **PERSONAL before TENANT**. **Share** and **unshare** acquire the relevant PERSONAL lock then the TENANT lock for that path (unshare adjusts both buckets). **Membership removal** acquires, for each affected path in ascending order, the member's PERSONAL lock then the TENANT lock. **Import**, **create**, **copy**, and **claim** acquire PERSONAL locks only, in ascending `list_path` order when multiple paths apply.
13. Before any PERSONAL insert (**create**, **copy**, **claim**, **import** row, **unshare**), re-check under that PERSONAL lock that the target `owner_user_id` still has an active `TenantMember` for the tenant, then count and write.

### Concurrency and realtime

14. Optimistic concurrency via `version` (409 `SAVED_VIEW_CHANGED`). Creates are server-confirmed ([ADR-0036](2026-11-02-frontend-interaction-rules.md)).
15. Realtime event `SAVED_VIEW` carries `id` and `list_path` only. After each mutation, notify the **union** of members who would receive the row under §5–6 from its **pre-change** state and its **post-change** state, so list, palette, and Cmd+K stay consistent. **PERSONAL-only** creates, updates, and deletes notify **only** `owner_user_id`. **Unshare**, **TENANT hard-delete**, and **deletes from membership removal** (PERSONAL or TENANT) notify every member who currently holds `list_path` read permission; for deletes, derive the audience from **pre-delete visibility** (include viewers who still had the row cached). **Share** and other TENANT writes notify the post-image TENANT audience. Clients refetch through the permission-filtered GET.

### Lifecycle

16. **Membership removal** (same transaction): acquire cap locks per §12 (PERSONAL then TENANT per path), delete the member's PERSONAL views, and set `owner_user_id = null` on their TENANT views. Do **not** delete or reset their `saved_view_imports` row (rejoin must not run a second one-time import). Deactivation keeps views; tenant deletion cascades views and import markers.
17. **Orphan TENANT rows** (`owner_user_id` null): remain visible to members who pass the `list_path` read filter. Only holders of `views.shared.manage` may edit or hard-delete them in place. **Unshare to PERSONAL** is forbidden while `owner_user_id` is null. **Claim** is the §6 **copy** of an orphan TENANT view into the caller's PERSONAL rows: requires `list_path` read permission on the source **and** `views.shared.manage`. Runs under the caller's PERSONAL lock with membership re-check, cap, and duplicate rules (§12–13). Leaves the TENANT row orphaned (no owner restore, no unshare).
18. **Unshare** (TENANT → PERSONAL, `owner_user_id` non-null): caller must hold `views.shared.manage` and need not be the row owner. `owner_user_id` is unchanged; visibility becomes PERSONAL. Acquire the **row owner's** PERSONAL lock then the TENANT lock for that `list_path` (§12); count under the PERSONAL lock (§13). Reject with `SAVED_VIEW_LIMIT` or `SAVED_VIEW_DUPLICATE` when applicable.

### One-time import (copy, not rename)

19. The client reads import status from the server and posts **at most 30** local rows per request (AUT-880 export size), unchanged from today's storage shape (`id`, `name`, `href`, `createdAt`). AUT-880 stores names with no length cap; **name ≤ 60** is deliberate and rejects long names on import. After a committed marker, those local names cannot be imported later (owners must rename locally and ask support only if the product adds a manual path — out of scope here). Ignore client `id`, owner, and visibility; every imported row is **PERSONAL** with `owner_user_id` = the caller. The localStorage key `acp:saved-views:<user>:<tenant>` stays **intact** for web rollback; the server never deletes or rewrites it.
20. **Single transaction per import attempt:**
    - Acquire the import idempotency lock (§11) **first**.
    - Re-read `saved_view_imports`; if a row exists, return **409 `ALREADY_IMPORTED`**.
    - For each posted row: normalize href like AUT-880 (strip `page` / `peek` / `action`, sort query). Rows that fail §8–9 or length limits are omitted; the response lists each as `rejected` with `{ name, href, reason }`.
    - **Same list, same case-insensitive name, different href:** keep the row with the latest `createdAt`, skip the others as `skippedDuplicateName` (response lists them).
    - **Same list, same case-insensitive name, same normalized href:** dedupe like AUT-880 add (keep latest `createdAt`, skip others as `skippedDuplicateExact`); a batch that would still collide with an existing server row rolls back with **409 `SAVED_VIEW_DUPLICATE`** and no marker.
    - Sort the distinct `list_path` values of rows to insert; acquire PERSONAL cap locks in that order (§12); under each lock run the membership re-check (§13) and enforce the 50 cap. A cap miss (422 `SAVED_VIEW_LIMIT`) or failed active-member re-check (**403**) **rolls back the entire import** and does **not** write `saved_view_imports` (no partial marker).
    - If **no** row would insert, roll back and return **400 `SAVED_VIEW_IMPORT_EMPTY`** without a marker (partial `rejected` / `skippedDuplicateName` counts do not commit a marker).
    - Insert accepted `saved_views` rows, insert `saved_view_imports`, commit atomically (marker and rows share one outcome).
21. **Source of truth after import:** once `saved_view_imports` exists for the member, server-backed clients load and mutate views **only** through the API (no merge or fallback read from localStorage). Pre-import clients may still use localStorage only.

### Rollout

22. No feature flag: core platform behavior with a non-destructive migration.

## Consequences

**Positive:** views follow users across devices; teams share standard views without widening data access.

**Negative:** one table, one import marker table, one permission, CRUD routes, one event; adding `views.shared.manage` changes the [ADR-0038](2026-11-08-authoritative-scope-context-for-cursor-lists.md) policy digest, so mixed client revisions can mismatch scope, restart a list once, then fail closed; an external-scope handshake flush leaves lists blocked until a manual refresh (§5–6 of ADR-0038).

**Neutral:** list **data** visibility unchanged (views store filter hrefs, not row payloads).

## Alternatives Considered

| Option | Reason not chosen |
| --- | --- |
| Keep localStorage | No sharing across users or devices |
| Per-site sharing | Adds scope rules with no current need |
| Per-user sharing | More UI and permissions, no current need |

## References

- [ADR-0013: Row-level multi-tenancy](2026-04-15-row-level-multi-tenancy.md)
- [ADR-0022: Site operational scope](2026-08-31-site-operational-scope.md)
- [ADR-0034: Custom tenant roles](2026-11-02-custom-tenant-roles.md)
- [ADR-0036: Frontend interaction rules](2026-11-02-frontend-interaction-rules.md)
- [ADR-0038: Authoritative scope context for cursor lists](2026-11-08-authoritative-scope-context-for-cursor-lists.md)
- [Deletion policy](../../deletion-policy.md) — `saved_views` / `saved_view_imports` matrix (ADR-0039)
- AUT-880: `apps/core-web/src/features/saved-views/SavedViewsProvider.tsx`

## Linear Tracking

| Field | Value |
| --- | --- |
| Parent | AUT-885 |
| Issues | AUT-880 (local views), AUT-885 (concept), AUT-935 (this ADR) |
