import type { LegacyReactTable as LegacyTable } from '@tanstack/react-table/legacy'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { ReactNode } from 'react'

import { TableSkeleton } from '@/components/ui/skeleton-presets'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
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
  tabIndexForRow: (rowKey: string, rowIsRovingFocusable: boolean) => number | undefined
  handleArrowFocus: (rowKey: string, direction: 'up' | 'down') => void
  onRowFocus: (rowKey: string) => void
  openRowContextMenu: (row: TData, x: number, y: number) => boolean
  /** The render window of a virtualized (infinite) table; offset tables render every row. */
  virtual?: DataTableVirtualRows
}

export type DataTableVirtualRows = {
  items: VirtualItem[]
  /** Where the first row starts inside the scroll box (the sticky header above it). */
  startOffset: number
  totalSize: number
  measureElement: (element: Element | null) => void
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
  | 'virtual'
  | 'visibleColumnCount'
> & {
  bodyRows: ReturnType<LegacyTable<TData>['getRowModel']>['rows']
}

/** Empty rows stand in for the unrendered ones, so the scrollbar and the sticky header keep their real proportions. */
function VirtualSpacer({ height, colSpan }: { height: number; colSpan: number }) {
  return (
    <TableRow aria-hidden="true" data-virtual-spacer="true" className="border-0 hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0" style={{ height }} />
    </TableRow>
  )
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
  virtual,
  visibleColumnCount,
}: DataTableGridBodyRowsProps<TData>) {
  const renderRow = (row: (typeof bodyRows)[number], virtualIndex?: number) => {
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
        tabIndex={tabIndexForRow(row.id, interaction.rowIsRovingFocusable && !isStalePreview)}
        openRowContextMenu={openRowContextMenu}
        onArrowFocus={(direction) => handleArrowFocus(row.id, direction)}
        onRowFocus={() => onRowFocus(row.id)}
        virtual={
          virtual && virtualIndex !== undefined
            ? { index: virtualIndex, measureRef: virtual.measureElement }
            : undefined
        }
      />
    )
  }

  if (!virtual) return bodyRows.map((row) => renderRow(row))

  const rendered: ReactNode[] = []
  let cursor = virtual.startOffset
  for (const item of virtual.items) {
    const row = bodyRows[item.index]
    if (!row) continue
    if (item.start > cursor) {
      rendered.push(<VirtualSpacer key={`before-${item.key}`} height={item.start - cursor} colSpan={visibleColumnCount} />)
    }
    rendered.push(renderRow(row, item.index))
    cursor = item.end
  }
  const end = virtual.startOffset + virtual.totalSize
  if (end > cursor) {
    rendered.push(<VirtualSpacer key="after" height={end - cursor} colSpan={visibleColumnCount} />)
  }
  return rendered
}

function DataTableGridBodyContent<TData extends object>(
  props: Omit<DataTableGridBodyProps<TData>, 'tableBodyRef'>,
) {
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
      virtual={props.virtual}
      visibleColumnCount={props.visibleColumnCount}
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
