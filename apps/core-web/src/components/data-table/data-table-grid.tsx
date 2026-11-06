import type { LegacyReactTable as LegacyTable } from '@tanstack/react-table/legacy'
import { flexRender } from '@tanstack/react-table'
import { useRef } from 'react'

import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { densityTokens, type DataTableDensity } from '@/lib/density-tokens'
import { getDataTableHeadClassName } from './data-table-column-meta'
import { DataTableGridBody } from './data-table-grid-body'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'
import type { DataTableEmptyState } from './data-table-states'
import type { DataTableInfiniteView } from './use-data-table-infinite'
import { useDataTableGridRows } from './use-data-table-grid-rows'

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
  /** Present in infinite mode: only the rows near the viewport (and the focused one) are rendered. */
  infiniteView?: DataTableInfiniteView
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
  infiniteView,
}: DataTableGridProps<TData>) {
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null)
  const tableRef = useRef<HTMLTableElement | null>(null)
  const { pagination } = table.getState()
  const visibleColumnCount = table.getVisibleLeafColumns().length
  const { virtual, moveFocusFrom, tabIndexForRow, onRowFocus } = useDataTableGridRows({
    table,
    rowBehaviour,
    infiniteView,
    density,
    hideHeader,
    tableRef,
    tableBodyRef,
  })

  return (
    <div
      className={cn(
        'max-w-full overflow-x-auto rounded-md border [&>div]:max-h-[70vh]',
        density === 'compact' && [densityTokens.compactRowClass, densityTokens.compactHeaderClass],
      )}
      data-density={density}
    >
      <Table ref={tableRef} aria-busy={ariaBusy} aria-rowcount={infiniteView?.ariaRowCount}>
        <TableHeader className={cn('sticky top-0 z-10 bg-background', hideHeader && 'hidden')}>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} data-table-header="true" aria-rowindex={infiniteView ? 1 : undefined}>
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
          handleArrowFocus={(rowKey, direction) => moveFocusFrom(rowKey, direction === 'down' ? 1 : -1)}
          onRowFocus={onRowFocus}
          openRowContextMenu={openRowContextMenu}
          virtual={virtual}
        />
      </Table>
    </div>
  )
}
