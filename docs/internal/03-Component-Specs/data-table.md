---
title: "DataTable Component"
date: "2026-04-12"
tags:
  - component-spec
  - ui
  - tables
---

# DataTable Component

## Purpose

> `DataTable` is the universal, standardized list view component used across the entire Auto Core Platform frontend. It encapsulates TanStack Table v8 functionality, providing robust client-side sorting, global debounced searching, column visibility toggles, and pagination out of the box, ensuring every module looks and behaves identically.

## API / Props

| Prop | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `columns` | `ColumnDef<TData, TValue>[]` | | **Yes** | TanStack Table column definitions. Use `DataTableColumnHeader` inside each column's `header` for sortable headers. |
| `data` | `TData[]` | | **Yes** | Array of data objects to render. |
| `searchKey` | `string` | | No | Enables the global search input. The placeholder label reflects this key, but the filter itself matches against **all visible string columns** via TanStack Table's global filter — not only the named key. |
| `onRowClick` | `(row: Row<TData>) => void` | | No | Callback fired when a user clicks a table row. Per UX Standard, this should navigate to the entity's detail view — never place separate Edit/View icon buttons in rows. |

### Companion Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `DataTableColumnHeader` | `@/components/data-table/` | Wraps column headers to add clickable sort indicators. **Required** on every sortable column per UX Standard. |
| `DataTablePagination` | `@/components/data-table/` | Renders page navigation controls beneath the table. |

## Usage Example

```tsx
import { DataTable } from "@/components/data-table/DataTable"
import { DataTableColumnHeader } from "@/components/data-table/DataTableColumnHeader"
import { StatusBadge } from "@/components/status/StatusBadge"

const columns: ColumnDef<PurchaseOrder>[] = [
  {
    accessorKey: "po_number",
    header: ({ column }) => <DataTableColumnHeader column={column} title="PO #" />,
  },
  {
    accessorKey: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <StatusBadge status={row.getValue("status")} />,
  },
]

export function PurchaseOrderList({ orders }) {
  return (
    <DataTable 
      columns={columns} 
      data={orders} 
      searchKey="po_number"
      onRowClick={(row) => navigate(`/purchase/${row.original.id}`)}
    />
  )
}
```

### Right-Click Context Menu

Per the List Page UI Standard, right-clicking a table row should expose a contextual **Delete** action (when the entity supports deletion). This is implemented by wrapping rows with a `ContextMenu` from shadcn/ui.

The Delete option **must** respect the entity's deletion policy (ADR-0005):

| Deletion Strategy | Context Menu Behavior |
|-------------------|----------------------|
| **Forbidden** | No Delete option shown (e.g., `InventoryTransaction`, finalized `Invoice`). |
| **Draft-Only** | Delete shown only when `status === 'DRAFT'` (e.g., `PurchaseOrder`, `SalesOrder`). |
| **Blocked (Conditional)** | Delete shown but server may reject if relations exist (e.g., `Customer` with orders). |

The frontend mirrors the policy for UX feedback, but the backend is the sole enforcer.

## Design Decisions

> **Row Click Navigation:** We explicitly reject placing "Edit" or "View" icon buttons at the end of every row. The entire row is clickable via `onRowClick` to navigate to the detail view. This reduces visual clutter and is enforced by the List Page UI Standard.
> 
> **Global Search:** Every list must include a search bar. The search leverages TanStack Table's global filter to match against any visible string column, not just a single column. This ensures users can find records by any visible field (name, number, status, etc.).
> 
> **Sortable Headers:** All column headers must use `DataTableColumnHeader` to provide consistent sort indicators. Column sizing follows the Inventory Item list as the reference baseline to prevent layout drift between modules.

## Related

- [[status-badge|StatusBadge]] — Used inside cells for status columns
- [[action-group|ActionGroup]] — Used in the same page header alongside DataTable list views
- ADR-0005: Deletion Policy Enforcement — Governs which entities expose Delete in the right-click context menu
- Feature Specs: All five module specs (Workshop, Sales, Purchase, Finance, Inventory) mandate DataTable for their list views
