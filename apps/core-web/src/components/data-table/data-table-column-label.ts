import type { LegacyColumn as Column } from '@tanstack/react-table/legacy'

import { formatDataTableColumnId } from '@/lib/i18n/enum-labels'

import { getDataTableColumnTitle } from "./data-table-column-header"

/** Name shown in the Columns menu and used as the CSV header: meta.label, then the DataTableColumnHeader title, then a plain-text header, then the localized column id. */
export function getDataTableColumnLabel<TData extends object>(column: Column<TData, unknown>): string {
  const meta = column.columnDef.meta as { label?: string } | undefined
  if (meta?.label) return meta.label
  const title = getDataTableColumnTitle(column)
  if (title) return title
  if (typeof column.columnDef.header === "string") return column.columnDef.header
  return formatDataTableColumnId(column.id)
}
