import type { LegacyColumn as Column } from '@tanstack/react-table/legacy'

import { getDataTableColumnTitle } from "./data-table-column-header"

function humanizeColumnId(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Name shown in the Columns menu and used as the CSV header: meta.label, then the DataTableColumnHeader title, then a plain-text header, then the humanized id. */
export function getDataTableColumnLabel<TData extends object>(column: Column<TData, unknown>): string {
  const meta = column.columnDef.meta as { label?: string } | undefined
  if (meta?.label) return meta.label
  const title = getDataTableColumnTitle(column)
  if (title) return title
  if (typeof column.columnDef.header === "string") return column.columnDef.header
  return humanizeColumnId(column.id)
}
