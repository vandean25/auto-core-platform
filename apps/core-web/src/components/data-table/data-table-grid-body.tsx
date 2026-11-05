import type { LegacyReactTable as LegacyTable } from '@tanstack/react-table/legacy'

import { TableSkeleton } from '@/components/ui/skeleton-presets'
import { TableBody } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  DataTableBodyRow,
  type DataTableBodyRowModel,
  getRowInteraction,
} from './data-table-body-row'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'
import { DataTableEmptyRow, type DataTableEmptyState } from './data-table-states'

type DataTableGridBodyProps<TData extends object> = {
  table: LegacyTable<TData>
  data: TData[]
  rowBehaviour?: DataTableRowBehaviour<TData>
  showSkeleton: boolean
  isStalePreview: boolean
  suppressEmptyState: boolean
  hideHeader: boolean
  visibleColumnCount: number
  pageSize: number
  emptyStateMessage: string
  emptyState?: DataTableEmptyState
  tableBodyRef: React.RefObject<HTMLTableSectionElement | null>
  tabIndexForRow: (visibleRowIndex: number, rowIsRovingFocusable: boolean) => number | undefined
  handleArrowFocus: (visibleRowIndex: number, direction: 'up' | 'down') => void
  onRowFocus: (visibleRowIndex: number) => void
  openRowContextMenu: (row: TData, x: number, y: number) => boolean
}

type DataTableGridBodyRowsProps<TData extends object> = Pick<
  DataTableGridBodyProps<TData>,
  | 'data'
  | 'rowBehaviour'
  | 'isStalePreview'
  | 'tabIndexForRow'
  | 'handleArrowFocus'
  | 'onRowFocus'
  | 'openRowContextMenu'
> & {
  bodyRows: ReturnType<LegacyTable<TData>['getRowModel']>['rows']
}

function DataTableGridBodyRows<TData extends object>({
  bodyRows,
  data,
  rowBehaviour,
  isStalePreview,
  tabIndexForRow,
  handleArrowFocus,
  onRowFocus,
  openRowContextMenu,
}: DataTableGridBodyRowsProps<TData>) {
  return bodyRows.map((row, visibleRowIndex) => {
    const bodyRow = row as DataTableBodyRowModel<TData>
    const interaction = getRowInteraction(bodyRow, rowBehaviour)
    return (
      <DataTableBodyRow
        key={row.id}
        row={bodyRow}
        data={data}
        rowBehaviour={rowBehaviour}
        interaction={interaction}
        interactionLocked={isStalePreview}
        tabIndex={tabIndexForRow(visibleRowIndex, interaction.rowIsRovingFocusable && !isStalePreview)}
        openRowContextMenu={openRowContextMenu}
        onArrowFocus={(direction) => handleArrowFocus(visibleRowIndex, direction)}
        onRowFocus={() => onRowFocus(visibleRowIndex)}
      />
    )
  })
}

function DataTableGridBodyContent<TData extends object>(props: DataTableGridBodyProps<TData>) {
  const { columnFilters, globalFilter } = props.table.getState()
  const bodyRows = props.table.getRowModel().rows

  if (props.showSkeleton) {
    return (
      <TableSkeleton
        rows={Math.min(props.pageSize, 8)}
        cols={props.hideHeader ? 2 : props.visibleColumnCount}
        delayMs={0}
      />
    )
  }

  if (bodyRows.length === 0) {
    if (props.suppressEmptyState) return null
    return (
      <DataTableEmptyRow
        colSpan={props.visibleColumnCount}
        fallbackMessage={props.emptyStateMessage}
        emptyState={props.emptyState}
        columnFilters={columnFilters}
        globalFilter={globalFilter}
      />
    )
  }

  return (
    <DataTableGridBodyRows
      bodyRows={bodyRows}
      data={props.data}
      rowBehaviour={props.rowBehaviour}
      isStalePreview={props.isStalePreview}
      tabIndexForRow={props.tabIndexForRow}
      handleArrowFocus={props.handleArrowFocus}
      onRowFocus={props.onRowFocus}
      openRowContextMenu={props.openRowContextMenu}
    />
  )
}

export function DataTableGridBody<TData extends object>({
  tableBodyRef,
  isStalePreview,
  ...contentProps
}: DataTableGridBodyProps<TData>) {
  return (
    <TableBody ref={tableBodyRef} className={cn(isStalePreview && 'opacity-60')}>
      <DataTableGridBodyContent isStalePreview={isStalePreview} {...contentProps} />
    </TableBody>
  )
}
