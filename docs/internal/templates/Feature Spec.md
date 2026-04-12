---
title: "{{title}}"
date: "{{date}}"
module: ""
status: draft
linear-project: ""
linear-milestone: ""
tags:
  - feature-spec
---

# {{title}}

## Summary

> One-paragraph description of the feature, its business purpose, and the problem it solves.

---

## User Stories

- As a **[role]**, I want to **[action]** so that **[outcome]**.

---

## Database Impact

### New Tables / Columns

| Table | Column | Type | Nullable | Notes |
|-------|--------|------|----------|-------|
|       |        |      |          |       |

### Modified Tables

| Table | Change | Migration Required? |
|-------|--------|---------------------|
|       |        |                     |

### Deletion Policy Impact

> Does this feature introduce new entities? Update `docs/deletion-policy.md` accordingly.

---

## API Contract Changes

### New Endpoints

| Method | Route | Request Body | Response | Auth |
|--------|-------|-------------|----------|------|
|        |       |             |          |      |

### Modified Endpoints

| Method | Route | Change Description |
|--------|-------|--------------------|
|        |       |                    |

### OpenAPI Regeneration

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

### Layout & Actions

- [ ] Page-level actions (Create, Save, Delete) are **top-right aligned**.
- [ ] Top-left reserved for breadcrumbs / title / badges only.
- [ ] Uses `text-2xl font-semibold tracking-tight` for page header.
- [ ] Subtitle uses `text-slate-500`.

### List Pages (if applicable)

- [ ] Create button format: `+ <Entity>` (no "Add", "New", "Create" prefix).
- [ ] Search bar searches across all visible columns.
- [ ] Sortable column headers via `DataTable` / `DataTableColumnHeader`.
- [ ] Status cells use shared `StatusBadge` component.
- [ ] Row click opens detail view.
- [ ] Right-click row → contextual Delete (if supported).

### Form Handling

- [ ] Multi-field forms use **debounced auto-save (750 ms)** with Saving/Saved indicator.
- [ ] Single-field edits use **save-on-blur** via `InlineEdit`.

### Real-Time Sync

- [ ] New entity type added to `SUPPORTED_ENTITY_TYPES` in Prisma extension.
- [ ] Frontend `dashboard-entity-map.ts` updated with new query key.

---

## Component Design

> List new or modified React components.

| Component | Location | Purpose |
|-----------|----------|---------|
|           |          |         |

---

## Testing Plan

### Backend E2E

- [ ] Happy-path test in `apps/core-api/test/`.
- [ ] Error/edge-case coverage.

### Frontend

- [ ] Visual QA in browser after implementation.

---

## Open Questions

1. 

---

## References

- [[README|Vault Conventions]]

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | <!-- Linear project URL --> |
| Milestone | <!-- Milestone name --> |
| Issues | <!-- AUT-XX, AUT-YY --> |
