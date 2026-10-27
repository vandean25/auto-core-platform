import type { LegacyReactTable as LegacyTable } from '@tanstack/react-table/legacy'
import { flexRender } from '@tanstack/react-table'
import { useRef } from 'react'

import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TableSkeleton } from '@/components/ui/skeleton-presets'
import { cn } from '@/lib/utils'
import { getDataTableHeadClassName } from './data-table-column-meta'
import type { DataTableDensity } from './data-table-density-toggle'
import { DataTableEmptyRow, type DataTableEmptyState } from './data-table-states'
import {
  DataTableBodyRow,
  type DataTableBodyRowModel,
  getRowInteraction,
} from './data-table-body-row'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'
import { useDataTableRovingFocus } from './use-data-table-roving-focus'

// Only header render functions (the DataTableColumnHeader pattern) expose a sort control.
// Plain-text headers do not, so they must not advertise sorting.
function getAriaSort(column: { columnDef: { header?: unknown }; getCanSort: () => boolean; getIsSorted: () => false | 'asc' | 'desc' }) {
  if (typeof column.columnDef.header !== 'function' || !column.getCanSort()) return undefined

  const sorted = column.getIsSorted()
  if (sorted === 'asc') return 'ascending' as const
  if (sorted === 'desc') return 'descending' as const
  return 'none' as const
}

type DataTableGridProps<TData extends object> = {
  table: LegacyTable<TData>
  data: TData[]
  rowBehaviour?: DataTableRowBehaviour<TData>
  isLoading: boolean
  density: DataTableDensity
  hideHeader: boolean
  openRowContextMenu: (row: TData, x: number, y: number) => boolean
  emptyStateMessage: string
  emptyState?: DataTableEmptyState
}

/** The scrollable table of {@link DataTable} (desktop, tablet, and the loading / empty states on phone). */
export function DataTableGrid<TData extends object>({
  table,
  data,
  rowBehaviour,
  isLoading,
  density,
  hideHeader,
  openRowContextMenu,
  emptyStateMessage,
  emptyState,
}: DataTableGridProps<TData>) {
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null)
  const { pagination, columnFilters, globalFilter } = table.getState()
  const visibleColumnCount = table.getVisibleLeafColumns().length
  const bodyRows = table.getRowModel().rows
  const bodyRowModels = bodyRows.map((row) => row as DataTableBodyRowModel<TData>)
  const paginationKey = `${pagination.pageIndex}:${pagination.pageSize}`
  const { handleArrowFocus, tabIndexForRow, onRowFocus } = useDataTableRovingFocus(
    bodyRowModels,
    rowBehaviour,
    data,
    paginationKey,
    tableBodyRef,
  )

  return (
    <div
      className={cn(
        'max-w-full overflow-x-auto rounded-md border [&>div]:max-h-[70vh]',
        'data-[density=compact]:[&_td]:py-1.5 data-[density=compact]:[&_th]:h-9',
      )}
      data-density={density}
    >
      <Table aria-busy={isLoading}>
        <TableHeader className={cn('sticky top-0 z-10 bg-background', hideHeader && 'hidden')}>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} data-table-header="true">
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={getAriaSort(header.column)}
                    className={getDataTableHeadClassName(header.column.columnDef)}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody ref={tableBodyRef}>
          {isLoading ? (
            <TableSkeleton rows={Math.min(pagination.pageSize, 8)} cols={hideHeader ? 2 : visibleColumnCount} />
          ) : bodyRows.length ? (
            bodyRows.map((row, visibleRowIndex) => {
              const bodyRow = row as DataTableBodyRowModel<TData>
              const interaction = getRowInteraction(bodyRow, rowBehaviour)

              return (
                <DataTableBodyRow
                  key={row.id}
                  row={bodyRow}
                  data={data}
                  rowBehaviour={rowBehaviour}
                  interaction={interaction}
                  tabIndex={tabIndexForRow(visibleRowIndex, interaction.rowIsRovingFocusable)}
                  openRowContextMenu={openRowContextMenu}
                  onArrowFocus={(direction) => handleArrowFocus(visibleRowIndex, direction)}
                  onRowFocus={() => onRowFocus(visibleRowIndex)}
                />
              )
            })
          ) : (
            <DataTableEmptyRow
              colSpan={visibleColumnCount}
              fallbackMessage={emptyStateMessage}
              emptyState={emptyState}
              columnFilters={columnFilters}
              globalFilter={globalFilter}
            />
          )}
        </TableBody>
      </Table>
    </div>
  )
}
