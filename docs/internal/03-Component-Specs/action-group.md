---
title: "ActionGroup"
date: "2026-04-12"
tags:
  - component-spec
  - ui
  - layout
---

# ActionGroup

## Purpose

> `ActionGroup` standardizes the layout of page-level actions in document/detail page headers. It enforces the **UX Standard**: all page-level action buttons (`Save`, `Print`, `Delete`, `Export`, etc.) must be placed in the **top-right corner** of the page header. The top-left is strictly reserved for context (titles, breadcrumbs, badges).
>
> When a detail page accumulates multiple actions, `ActionGroup` presents one prominent primary CTA alongside a dropdown menu for secondary and destructive actions, keeping the interface clean.

## API / Props

| Prop | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `primaryAction` | `ReactNode` | | No | The main button to display alongside the group. |
| `children` | `ReactNode` | | **Yes** | The `DropdownMenuItem` components comprising the secondary actions. |
| `label` | `string` | `"Actions"` | No | The label for the trigger button. |

## Usage Example

```tsx
import { ActionGroup } from "@/components/ui/ActionGroup"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

export function WorkshopOrderActions() {
  return (
    <ActionGroup 
      primaryAction={<Button>Save Changes</Button>}
    >
      <DropdownMenuItem onSelect={() => window.print()}>
        Print Job Card
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={handleEmail}>
        Email Customer
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={handleCancel} className="text-red-600">
        Cancel Order
      </DropdownMenuItem>
    </ActionGroup>
  )
}
```

### Destructive Action Convention

Destructive actions (Cancel, Delete, Void) inside the dropdown **must** follow these rules:

1. **Visual separation:** Place a `DropdownMenuSeparator` above all destructive items to visually isolate them.
2. **Red text:** Apply `className="text-red-600"` to destructive menu items.
3. **Confirmation dialog:** Destructive actions must trigger a confirmation dialog (using shadcn/ui `AlertDialog`) before execution — never perform the action directly on click.
4. **Deletion policy:** The action must respect the entity's deletion rules (ADR-0005). If the entity's current state doesn't allow the action, the menu item should be disabled or hidden.

### When NOT to Use ActionGroup

`ActionGroup` is designed for **detail/document pages** with multiple actions. Do **not** use it on:

- **List pages:** The top-right of a list page uses a standalone `+ Entity` button (e.g., `+ Customer`, `+ Purchase Order`) per the List Page UI Standard. No dropdown is needed.
- **Settings pages:** Tab-based settings pages typically use inline save patterns (auto-save or save-on-blur), not header action buttons.
- **Pages with a single action:** If a page has only one action, use a standalone `Button` instead of wrapping it in an ActionGroup.

## Design Decisions

> **Clutter Reduction:** As document interfaces grew more complex (e.g., Workshop Orders having Print, Email, Invoice, Cancel, Delete actions), the top-right corner became cluttered with a row of 5-6 buttons. `ActionGroup` consolidates these into a single primary button plus a dropdown, maintaining the "Rich Aesthetics" goal by keeping the UI breathable.
> 
> **Accessibility:** `ActionGroup` wraps shadcn/ui's `DropdownMenu`, which provides full keyboard navigation (arrow keys, Enter, Escape) and correct ARIA attributes (`role="menu"`, `aria-expanded`) out of the box.

## Related

- [[data-table|DataTable Component]] — List pages pair a DataTable with a standalone create button; detail pages pair DataTable (for sub-items) with ActionGroup
- [[status-badge|StatusBadge]] — The current entity status often determines which actions are available in the ActionGroup dropdown
- ADR-0005: Deletion Policy Enforcement — Governs whether Delete appears in the dropdown
- ADR-0007: Async PDF Pipeline — Print/Download PDF actions in the dropdown trigger the async PDF generation flow
- Feature Specs: Workshop, Sales, and Purchase specs all reference ActionGroup for their detail page headers
