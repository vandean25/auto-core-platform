---
title: "ADR-0039: Server-Side Saved Views"
date: "2026-11-09"
status: accepted
deciders: "Product Planner, ACP Software Engineer (under delegation of Dejan Dosenovic)"
tags: [adr, platform, tables, permissions, saved-views]
---

# ADR-0039: Server-Side Saved Views

## Status

**Accepted — 2026-11-09.** Decided by Product Planner + ACP Software Engineer under Dejan Dosenovic's delegation of 2026-11-09. Replaces localStorage as the source of truth for AUT-880 saved views. Linear: AUT-885.

## Context

Saved views (AUT-880) live in localStorage per user and tenant: they are lost across devices and cannot be shared. Shared views need a server-side model and a new permission.

## Decision

1. Table `saved_views` (tenant-scoped per [ADR-0013](2026-04-15-row-level-multi-tenancy.md)): id, tenant_id, owner_user_id (nullable), list_path, name, href, visibility PERSONAL | TENANT, version, timestamps. Partial unique names per (tenant, owner, list_path) for PERSONAL and per (tenant, list_path) for TENANT, case-insensitive.
2. No site dimension. Opening a view re-authorizes the list with the viewer's own role and site.
3. Read-time permission filter: TENANT views (list, copy, realtime handling) are returned only when the viewer currently holds the read permission for the view's list_path, per a server-side list_path → permission registry checked on every request.
4. Validation: list_path must be in that registry; href must be a relative path whose pathname equals list_path, with known query parameters only; absolute, protocol-relative and `javascript:` URLs are rejected. Imports use the same validation.
5. Permission `views.shared.manage` (default OWNER, ADMIN) for creating, editing, deleting or unsharing TENANT views. Others may copy permitted TENANT views.
6. Limits: 50 PERSONAL per user per list, 50 TENANT per tenant per list; name ≤ 60, href ≤ 2,000 characters. Create, import and share serialize on a transaction-scoped advisory lock per (tenant, owner or TENANT, list_path) before counting. Name clashes return 409 `SAVED_VIEW_DUPLICATE`.
7. Optimistic concurrency via `version` (409 `SAVED_VIEW_CHANGED`). Creates are server-confirmed ([ADR-0036](2026-11-02-frontend-interaction-rules.md)).
8. Lifecycle: membership removal deletes the member's PERSONAL views and nulls the owner of their TENANT views in the same transaction; deactivation keeps views.
9. Realtime event `SAVED_VIEW` carries id and list_path only.
10. One-time import per (tenant, user): the import marker row is inserted first (duplicate → 409 `ALREADY_IMPORTED`); local views are copied, never renamed or deleted, so a web rollback keeps its data.
11. No feature flag: core platform behavior with a non-destructive migration.

## Consequences

**Positive:** views follow users across devices; teams share standard views without widening data access.

**Negative:** one table, one permission, CRUD routes, one event; a policy-digest change triggers one list restart under [ADR-0038](2026-11-08-authoritative-scope-context-for-cursor-lists.md) after deploy.

**Neutral:** list data visibility unchanged.

## Alternatives Considered

| Option | Reason not chosen |
| --- | --- |
| Keep localStorage | No sharing across users or devices |
| Per-site sharing | Adds scope rules with no current need |
| Per-user sharing | More UI and permissions, no current need |

## References

- [ADR-0013: Row-level multi-tenancy](2026-04-15-row-level-multi-tenancy.md)
- [ADR-0034: Custom tenant roles](2026-11-02-custom-tenant-roles.md) — default grants for `views.shared.manage`
- [ADR-0036: Frontend interaction rules](2026-11-02-frontend-interaction-rules.md)
- [ADR-0038: Authoritative scope context for cursor lists](2026-11-08-authoritative-scope-context-for-cursor-lists.md)

## Linear Tracking

| Field | Value |
| --- | --- |
| Parent | AUT-885 |
| Issues | AUT-880 (local views), AUT-885 (concept), AUT-935 (this ADR) |
