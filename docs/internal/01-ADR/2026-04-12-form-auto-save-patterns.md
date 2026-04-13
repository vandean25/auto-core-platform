---
title: "ADR-0006: Form Auto-Save Patterns"
date: "2026-04-12"
status: accepted
deciders: "Product Owner, Frontend Engineering Team"
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - adr
  - frontend
  - form-handling
  - ux
---

# ADR-0006: Form Auto-Save Patterns

## Status

**Accepted** — 2026-04-12 (Retroactive documentation of existing system)

## Context

Managing form state across large, complex documents (like a 30-item Purchase Order or a multi-tab Settings page) is prone to data loss if users navigate away without hitting an explicit "Save" button. Conversely, aggressively firing API calls on every keystroke overwhelms the backend and causes UI jank.

Furthermore, different UI elements demand different interaction models. A dedicated page for building a large Sales Order feels different from quickly renaming a small task inline.

We needed a standardized approach to mutating data from the frontend to ensure a seamless, data-safe, and performant user experience.

## Decision

We have adopted a **Context-Based Auto-Save approach** with two strict, distinct patterns based on UI complexity. Form state management uses `react-hook-form` as the standard library across all patterns.

### Pattern 1: Debounced Form-Level Auto-Save (Complex Documents)

For multi-field document creation and editing pages, we strictly enforce a debounced auto-save.
- **Trigger:** The form state is observed for changes via `react-hook-form`'s `watch()`. When a change occurs, a timer starts.
- **Debounce Window:** `750ms`. If the user continues typing, the timer resets.
- **Execution:** Once the user stops typing for 750ms, a single API mutation request (e.g., `updatePurchaseOrder`) is fired containing the current form payload.
- **UX Requirement:** A persistent visual indicator must be placed near the form actions showing state: `Saving...` → `Saved` → `Error (Retry)`.

**Entities using Pattern 1:**

| Entity | Form Context |
|--------|-------------|
| `PurchaseOrder` | Purchase Order create/edit page |
| `PurchaseInvoice` | Purchase Bill form |
| `SalesOrder` | Sales Order create/edit page |
| `WorkshopOrder` | Workshop Order create/edit page |
| `Invoice` | Invoice creation (DRAFT stage only) |

### Pattern 2: Field-Level Save-on-Blur (Isolated Inline Edits)

For isolated text edits within lists, detail sidebars, or quick-actions, we utilize a save-on-blur mechanism.
- **Trigger:** The field loses focus (`onBlur` or hitting `Enter`).
- **Execution:** An immediate API mutation is fired for just that specific field (`PATCH`).
- **Component Standard:** This is implemented globally using the shared `InlineEdit` component abstraction.

**Entities using Pattern 2:**

| Entity | Field Context |
|--------|--------------|
| `Customer` | Notes, contact details in detail sidebar |
| `Vendor` | Notes, contact info inline edits |
| `WorkshopTask` | Task description, inline status changes |
| `CatalogItem` | Notes field on item detail |

### Auto-Save and Status Transitions

Auto-save introduces a race condition with explicit status transitions (e.g., clicking "Confirm Order"):

1. **Cancel pending saves before transitions:** When the user triggers an explicit action (status change, delete, finalize), any pending debounced auto-save must be **cancelled immediately** before the transition mutation fires. The transition mutation itself carries the final form state.
2. **Implementation:** The debounce timer is cleared (via `cancel()` on the debounce handle) in the `onClick` handler of any status-transition button, before dispatching the transition mutation.
3. **Guard:** After a status transition succeeds, auto-save must not resume for fields that are now read-only under the new status (e.g., a `CONFIRMED` SalesOrder should not auto-save price changes).

### Concurrent Editing

This system uses a **last-write-wins** strategy. If two users edit the same document simultaneously, the later auto-save silently overwrites the earlier one. This is an accepted tradeoff for the current user base (small teams, low collision probability).

> ⚠️ **Future consideration:** If concurrent editing becomes a real-world problem, introduce optimistic locking via an `updatedAt` comparison. The backend would reject a save where the client's `updatedAt` is older than the server's, and the frontend would prompt the user to reload. This is deferred — not a blocker for the current architecture.

### Error Handling and Offline Recovery

When an auto-save mutation fails:

| Scenario | Behavior |
|----------|----------|
| **Transient network error** | The save indicator shows `Error`. The system retries once after 3 seconds. If the retry fails, the indicator shows `Error (Retry)` with a manual retry button. Local form state is preserved — the user does not lose data. |
| **Backend validation error (e.g., fiscal lock date)** | The save indicator shows `Error` with the backend's error message surfaced in a toast notification. No automatic retry — the user must fix the validation issue. See ADR-0003 for lock date specifics. |
| **Entity deleted by another user** | The save returns HTTP 404. The frontend shows a "This document has been deleted" notice and disables the form. See ADR-0005 for deletion policy. |
| **Extended offline** | Pending changes remain in the `react-hook-form` dirty state. When connectivity resumes (detected via `navigator.onLine` + a health-check ping), the system fires a single save with the accumulated dirty state. No background queue — the form state IS the queue. |

## Consequences

### Positive

- **Data Safety:** Users rarely lose data. System crashes or mistaken navigation don't destroy minutes of manual entry.
- **UX Parity:** Modern web app feel (similar to Notion or Linear) rather than an old-fashioned "Submit Form" model.
- **Performance:** 750ms debounce for complex forms significantly reduces unnecessary backend load compared to naive onChange saving.

### Negative

- **Implementation Complexity:** Managing `react-hook-form` state, debouncing hooks (`useDebounce`), cancel-on-transition logic, and tracking dirty state is significantly more complex than standard form submission.
- **Error Handling Friction:** If an auto-save fails (e.g., network drop, lock date violation), the UI must smoothly handle reconciling local dirty state against the server state when it comes back online. Backend validation errors (ADR-0003) must be surfaced clearly through the save indicator, not silently swallowed.

### Neutral

- Requires strict adherence to TanStack Query mutation `onMutate` (optimistic updates) to keep the UI snappy while the background save happens.
- The `last-write-wins` concurrent editing strategy is acceptable at current scale but may need revisiting if multi-user editing of the same document becomes common.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Explicit "Save" Buttons Everywhere | Easiest to build. Predictable backend load. | High risk of user data loss. High interaction friction. |
| Save-on-Change (No Debounce) | Instantly safe. | Too chatty. Generates hundreds of useless database writes and revision histories per minute. |
| Draft/Publish Model (edit locally, explicit publish) | Clear separation between work-in-progress and committed state. Common in CMS systems. | Requires maintaining two conceptual states (local draft vs server state), adding UI complexity. Poor fit for our existing status-based workflows where `DRAFT` already serves as the editable state. |
| Command-Based Save (Save button + `Ctrl+S` shortcut) | Familiar to desktop-app users. Predictable save points. | Does not prevent data loss from accidental navigation. Less modern UX feel. Inconsistent with mobile/touch contexts. |

## References

- `apps/core-web/src/components/ui/InlineEdit.tsx` — shared component for Pattern 2
- `apps/core-web/src/hooks/useAutoSave.ts` — debounced auto-save hook for Pattern 1
- `apps/core-web/src/components/ui/SaveIndicator.tsx` — persistent Saving/Saved/Error visual indicator
- `agents.md` — Form Handling & UX section
- ADR-0003: `2026-04-12-fiscal-lock-date.md` — auto-save mutations on financial documents are subject to lock date validation; backend 422 errors must be surfaced through the save indicator
- ADR-0005: `2026-04-12-deletion-policy-enforcement.md` — concurrent entity deletion during active auto-save editing results in a 404 that the error handler must detect
- ADR-0011: `2026-04-12-atomic-status-transition-guards.md` — auto-save must be cancelled before status transitions to prevent the race condition described in this ADR

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | N/A |
| Issues | N/A |
