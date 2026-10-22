import type { LegacyReactTable as Table } from '@tanstack/react-table/legacy'

import { getDataTableColumnMeta } from './data-table-column-meta'
import { DataTableDateRangeFilter } from './data-table-date-range-filter'
import { DataTableFacetedFilter } from './data-table-faceted-filter'

/** One toolbar control per column that declares `meta.filter`. */
export function DataTableColumnFilters<TData extends object>({ table }: { table: Table<TData> }) {
  return table.getAllColumns().map((column) => {
    const filter = getDataTableColumnMeta(column.columnDef).filter
    if (filter?.type === 'faceted') return <DataTableFacetedFilter key={column.id} column={column} filter={filter} />
    if (filter?.type === 'dateRange') return <DataTableDateRangeFilter key={column.id} column={column} filter={filter} />
    return null
  })
}
