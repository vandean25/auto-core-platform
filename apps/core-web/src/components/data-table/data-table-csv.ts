import type { LegacyReactTable as Table } from '@tanstack/react-table/legacy'

import { serializeCsv } from '@/lib/csv'
import { getDataTableColumnLabel } from './data-table-column-label'

/**
 * Serialises the rows the table is rendering right now. Only visible data columns are included;
 * display-only columns such as action buttons have no accessor and are skipped. Server-paged lists
 * therefore export the loaded page, not the full dataset.
 */
export function buildDataTableCsv<TData extends object>(table: Table<TData>): string {
  const columns = table
    .getVisibleLeafColumns()
    .filter((column) => typeof column.accessorFn !== 'undefined')
  const header = columns.map((column) => getDataTableColumnLabel(column))
  const body = table
    .getRowModel()
    .rows.map((row) => columns.map((column) => row.getValue(column.id)))

  return serializeCsv([header, ...body])
}

/** An explicit file name wins; otherwise the saved-view title is the base name, e.g. "Invoices" becomes invoices.csv. */
export function getDataTableCsvFileName(csvFileName: string | undefined, title: string | undefined): string {
  if (csvFileName) return csvFileName

  const base = (title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'export'}.csv`
}
