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
7. Permission `views.shared.manage` (default OWNER, ADMIN; catalogue lands with [ADR-0034](2026-11-02-custom-tenant-roles.md)) for create, edit, delete, or unshare of TENANT views. Others may copy permitted TENANT views read-only.

### Validation

8. `list_path` must be in the registry; otherwise 400 `SAVED_VIEW_INVALID`.
9. `href` must be a relative path whose pathname equals `list_path` and whose query keys are a subset of that list's allow-list (including keys AUT-880 already persists after stripping transient `page`, `peek`, and `action` — e.g. `pageSize` and sort/filter params registered for that list). Absolute, protocol-relative, and `javascript:` URLs are rejected. The same rules apply to create, update, share, and import.

### Limits and locking

10. Limits: 50 PERSONAL per `(tenant, owner, list_path)`, 50 TENANT per `(tenant, list_path)`; `name` ≤ 60 characters, `href` ≤ 2,000 characters; 422 `SAVED_VIEW_LIMIT`; name clash 409 `SAVED_VIEW_DUPLICATE`.
11. Before counting or writing, take `pg_advisory_xact_lock` on `(tenant_id, bucket, list_path)` where `bucket` is the owner user id for PERSONAL and the literal tenant bucket for TENANT. This applies to **create**, **import** (per affected list path in the batch), **share** (TENANT bucket on the target list path), **unshare** (PERSONAL bucket for the target owner and list path), and **membership removal** (every PERSONAL bucket and TENANT list path touched in that transaction). Share into TENANT must take the TENANT list lock, not only the sharer's PERSONAL lock.
12. Before any PERSONAL insert (create, import row, unshare), re-check that the owner still has an active `TenantMember` for the tenant under that PERSONAL lock.

### Concurrency and realtime

13. Optimistic concurrency via `version` (409 `SAVED_VIEW_CHANGED`). Creates are server-confirmed ([ADR-0036](2026-11-02-frontend-interaction-rules.md)).
14. Realtime event `SAVED_VIEW` carries `id` and `list_path` only; clients refetch through the permission-filtered GET.

### Lifecycle

15. **Membership removal** (same transaction): under the advisory locks in §11, delete the member's PERSONAL views and set `owner_user_id = null` on their TENANT views. Deactivation keeps views; tenant deletion cascades.
16. **Unshare** (TENANT → PERSONAL): under the PERSONAL bucket lock, count toward the 50 PERSONAL cap; reject with `SAVED_VIEW_LIMIT` or `SAVED_VIEW_DUPLICATE` when applicable.

### One-time import (copy, not rename)

17. The client reads import status from the server and posts **at most 30** local rows per request (AUT-880 export size), unchanged from today's storage shape (`id`, `name`, `href`, `createdAt`). The localStorage key `acp:saved-views:<user>:<tenant>` stays **intact** for web rollback; the server never deletes or rewrites it.
18. **Single transaction per import attempt:**
    - If a `saved_view_imports` row already exists for `(tenant_id, user_id)`, return **409 `ALREADY_IMPORTED`** (committed marker only; no in-flight partial marker).
    - Otherwise acquire a transaction-scoped advisory lock on `(tenant_id, user_id)` for import idempotency.
    - For each row: normalize href like AUT-880 (strip `page` / `peek` / `action`, sort query). Reject rows that fail §8–9 or length limits; they are counted as `rejected` in the response body and are not inserted.
    - For each remaining row on a list path: under that list's PERSONAL lock, enforce the 50 cap. **Same list, same case-insensitive name, different href** (allowed in AUT-880 add but not in server uniqueness): keep the row with the latest `createdAt`, skip the others as `skippedDuplicateName`.
    - If **no** row would insert, roll back and return **400 `SAVED_VIEW_IMPORT_EMPTY`** without creating a marker.
    - Insert all accepted rows, then insert `saved_view_imports`, and commit atomically.
19. **Source of truth after import:** once `saved_view_imports` exists for the member, server-backed clients load and mutate views **only** through the API (no merge or fallback read from localStorage). Pre-import clients may still use localStorage only.

### Rollout

20. No feature flag: core platform behavior with a non-destructive migration.

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
- AUT-880: `apps/core-web/src/features/saved-views/SavedViewsProvider.tsx`

## Linear Tracking

| Field | Value |
| --- | --- |
| Parent | AUT-885 |
| Issues | AUT-880 (local views), AUT-885 (concept), AUT-935 (this ADR) |
