import type { LegacyReactTable as LegacyTable } from '@tanstack/react-table/legacy'
import { flexRender } from '@tanstack/react-table'
import { useRef } from 'react'

import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { densityTokens, type DataTableDensity } from '@/lib/density-tokens'
import { getDataTableHeadClassName } from './data-table-column-meta'
import {
  type DataTableBodyRowModel,
} from './data-table-body-row'
import { DataTableGridBody } from './data-table-grid-body'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'
import type { DataTableEmptyState } from './data-table-states'
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
  showSkeleton: boolean
  ariaBusy: boolean
  isStalePreview: boolean
  suppressEmptyState: boolean
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
  showSkeleton,
  ariaBusy,
  isStalePreview,
  suppressEmptyState,
  density,
  hideHeader,
  openRowContextMenu,
  emptyStateMessage,
  emptyState,
}: DataTableGridProps<TData>) {
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null)
  const { pagination } = table.getState()
  const visibleColumnCount = table.getVisibleLeafColumns().length
  const bodyRowModels = table.getRowModel().rows.map((row) => row as DataTableBodyRowModel<TData>)
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
        density === 'compact' && [densityTokens.compactRowClass, densityTokens.compactHeaderClass],
      )}
      data-density={density}
    >
      <Table aria-busy={ariaBusy}>
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
        <DataTableGridBody
          table={table}
          data={data}
          rowBehaviour={rowBehaviour}
          showSkeleton={showSkeleton}
          isStalePreview={isStalePreview}
          suppressEmptyState={suppressEmptyState}
          hideHeader={hideHeader}
          visibleColumnCount={visibleColumnCount}
          pageSize={pagination.pageSize}
          emptyStateMessage={emptyStateMessage}
          emptyState={emptyState}
          tableBodyRef={tableBodyRef}
          tabIndexForRow={tabIndexForRow}
          handleArrowFocus={handleArrowFocus}
          onRowFocus={onRowFocus}
          openRowContextMenu={openRowContextMenu}
        />
      </Table>
    </div>
  )
}
