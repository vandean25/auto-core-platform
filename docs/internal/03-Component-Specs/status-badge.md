---
title: "StatusBadge"
date: "2026-04-12"
tags:
  - component-spec
  - ui
  - aesthetics
---

# StatusBadge

## Purpose

> `StatusBadge` provides a unified visual representation for state machine statuses across all entities in Auto Core Platform — including Sales Orders, Invoices, Purchase Orders, Purchase Invoices, Workshop Orders, and Workshop Tasks. It maps raw database enum strings to user-friendly labels and distinct Tailwind CSS color schemes, guaranteeing consistency across every module.

## API / Props

| Prop | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `status` | `string` | | **Yes** | The raw enum status value from the database. |
| `className` | `string` | | No | Additional classes for layout overriding (rarely needed). |

## Usage Example

```tsx
import { StatusBadge } from "@/components/status/StatusBadge"

export function StatusCell({ status }: { status: string }) {
  return <StatusBadge status={status} />;
}
```

### Label Formatting

`StatusBadge` automatically converts raw database enum strings to human-readable labels by replacing underscores with spaces and applying title case:

| Raw Enum | Rendered Label |
|----------|---------------|
| `DRAFT` | Draft |
| `IN_PROGRESS` | In Progress |
| `WAITING_PARTS` | Waiting Parts |
| `COMPLETED` | Completed |

### Known Status Color Groups

The `statusClassMap` inside `StatusBadge.tsx` contains the authoritative mapping of every status to its color scheme. The current groups are:

| Color | Statuses |
|-------|----------|
| **Gray** (neutral/initial) | `DRAFT`, `NOT_STARTED`, `SCHEDULED` |
| **Blue** (active/in-flight) | `SENT`, `CONFIRMED`, `IN_PROGRESS`, `INTAKE` |
| **Amber** (waiting/partial) | `PARTIAL`, `WAITING_PARTS` |
| **Green** (success/terminal) | `COMPLETED`, `DONE`, `PAID`, `POSTED` |
| **Indigo** (invoiced) | `INVOICED`, `FINALIZED`, `ISSUED` |
| **Red** (cancelled/error) | `CANCELLED`, `VOIDED` |

> **Note:** This table is a documentation reference. The `statusClassMap` in source code is the runtime source of truth. Keep both in sync.

### Adding a New Status

When a new status is introduced (e.g., via a new state machine or a new entity):

1. **Update `statusClassMap`** in `StatusBadge.tsx` — add the new enum string and assign it to the appropriate color group.
2. **Update this spec** — add the status to the color group table above.
3. **Never** create inline status styling elsewhere. If a developer renders `className={status === 'NEW_STATUS' ? 'bg-purple-200' : ...}` instead of using `StatusBadge`, it violates the architecture.

## Design Decisions

> **Centralized `statusClassMap`:** We explicitly forbid developers from rendering their own raw styling for statuses inline (e.g., `className={status === 'DRAFT' ? 'bg-gray-200' : 'bg-green-500'}`). All mappings must occur inside the `statusClassMap` within `StatusBadge.tsx`. This ensures that changing the color of `COMPLETED` updates identically across the Sales, Purchase, and Workshop modules.
> 
> **shadcn/ui Foundation:** We use the `Badge` primitive from shadcn/ui but heavily override its variants to support our specific state machine colors.
> 
> **Enum-Agnostic:** The component accepts any `string` rather than a typed union. This makes it safe to use with statuses from any entity without type gymnastics, at the cost of silently rendering an unstyled badge for unknown values. An unknown status renders with default gray styling and a `console.warn` in development.

## Related

- [[data-table|DataTable Component]] — StatusBadge is rendered inside DataTable status columns
- [[action-group|ActionGroup]] — Action buttons often depend on the current status
- Feature Specs: Workshop, Sales, Purchase, and Inventory specs all define state machines rendered by this component
- ADR-0005: Deletion Policy Enforcement — Deletion availability often depends on the status displayed by this badge
