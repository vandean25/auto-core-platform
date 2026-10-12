import type { LegacyReactTable as Table } from '@tanstack/react-table/legacy'

import { serializeCsv } from '@/lib/csv'
import { getDataTableColumnLabel } from './data-table-column-label'

/**
 * Serialises the rows the table is rendering right now. Server-paged lists therefore export the
 * loaded page, not the full dataset. A column's meta.csvValue, when set, supplies its cell text,
 * for columns whose raw accessor value is an object or only part of the displayed text.
 */
export function buildDataTableCsv<TData extends object>(table: Table<TData>): string {
  const columns = getDataTableExportColumns(table)
  const header = columns.map((column) => getDataTableColumnLabel(column))
  const body = table.getRowModel().rows.map((row) =>
    columns.map((column) => {
      const { csvValue } = (column.columnDef.meta ?? {}) as { csvValue?: (record: TData) => unknown }
      return csvValue ? csvValue(row.original) : row.getValue(column.id)
    }),
  )

  return serializeCsv([header, ...body])
}

/** Visible data columns. Display-only columns such as action buttons have no accessor and are skipped. */
export function getDataTableExportColumns<TData extends object>(table: Table<TData>) {
  return table
    .getVisibleLeafColumns()
    .filter((column) => typeof column.accessorFn !== 'undefined')
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
