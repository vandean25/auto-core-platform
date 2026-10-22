import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { TableCell, TableRow } from '@/components/ui/table'
import { flexRender } from '@tanstack/react-table'
import { getDataTableCellClassName } from './data-table-column-meta'
import { DataTableRowDetailLink, isDataTableRowLinkColumn } from './data-table-row-link'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'

export const clickableRowClassName =
  'cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }

  return Boolean(
    target.closest('button, a, input, select, textarea, [role="button"], [data-column-id="select"]'),
  )
}

export function getTableRowId(record: object): string | undefined {
  const id = (record as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

export function resolveRowFromElement<TData extends object>(
  element: HTMLTableRowElement,
  data: TData[],
  fallback: TData,
): TData {
  const rowId = element.getAttribute('data-row-id')
  if (!rowId) return fallback

  const match = data.find((record) => getTableRowId(record) === rowId)
  return match ?? fallback
}

function activateRow<TData extends object>(
  event: ReactMouseEvent | ReactKeyboardEvent,
  fallback: TData,
  data: TData[],
  onRowClick?: (row: TData) => void,
) {
  if (!onRowClick || isInteractiveTarget(event.target)) {
    return
  }

  const rowElement = (event.currentTarget as HTMLElement).closest('tr')
  if (!(rowElement instanceof HTMLTableRowElement)) {
    return
  }

  onRowClick(resolveRowFromElement(rowElement, data, fallback))
}

function handleRowClick<TData extends object>(
  event: React.MouseEvent<HTMLTableRowElement>,
  data: TData[],
  fallback: TData,
  onRowClick?: (row: TData) => void,
) {
  if (event.target !== event.currentTarget) {
    return
  }

  activateRow(event, fallback, data, onRowClick)
}

export type DataTableBodyRowModel<TData extends object> = {
  id: string
  original: TData
  getIsSelected: () => boolean
  getVisibleCells: () => Array<{
    id: string
    column: { id: string; columnDef: { meta?: unknown; cell?: unknown } }
    getContext: () => unknown
  }>
}

export type RowInteractionState = {
  rowUsesDetailLink: boolean
  rowIsRovingFocusable: boolean
  rowHref?: string
  rowAccessibleName?: string
}

export function getRowInteraction<TData extends object>(
  row: DataTableBodyRowModel<TData>,
  rowBehaviour: DataTableRowBehaviour<TData> | undefined,
): RowInteractionState {
  const rowData = row.original
  const rowHref = rowBehaviour?.getRowHref?.(rowData)
  const rowAccessibleName = rowBehaviour?.getRowAccessibleName?.(rowData)
  const rowUsesDetailLink = Boolean(
    rowHref &&
      rowAccessibleName &&
      row.getVisibleCells().some((cell) => isDataTableRowLinkColumn(cell.column.columnDef)),
  )
  const hasContextActions = Boolean(rowBehaviour?.getRowContextActions?.(rowData)?.length)
  const rowIsRovingFocusable = Boolean(rowBehaviour?.onRowClick || hasContextActions)

  return {
    rowUsesDetailLink,
    rowIsRovingFocusable,
    rowHref,
    rowAccessibleName,
  }
}

function openDetailFromRow(rowElement: HTMLTableRowElement) {
  const link = rowElement.querySelector('a[href]')
  if (link instanceof HTMLAnchorElement) {
    link.click()
  }
}

type RowKeyHandlerArgs<TData extends object> = {
  event: ReactKeyboardEvent<HTMLTableRowElement>
  rowData: TData
  data: TData[]
  interaction: RowInteractionState
  rowBehaviour: DataTableRowBehaviour<TData> | undefined
  openRowContextMenu: (row: TData, x: number, y: number) => boolean
  onArrowFocus: (direction: 'up' | 'down') => void
}

export function handleDataTableBodyRowKeyDown<TData extends object>({
  event,
  rowData,
  data,
  interaction,
  rowBehaviour,
  openRowContextMenu,
  onArrowFocus,
}: RowKeyHandlerArgs<TData>) {
  const resolvedRow = resolveRowFromElement(event.currentTarget, data, rowData)
  const onRowClick = rowBehaviour?.onRowClick

  if (event.key === 'ArrowDown') {
    if (isInteractiveTarget(event.target)) return
    event.preventDefault()
    onArrowFocus('down')
    return
  }

  if (event.key === 'ArrowUp') {
    if (isInteractiveTarget(event.target)) return
    event.preventDefault()
    onArrowFocus('up')
    return
  }

  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    const rect = event.currentTarget.getBoundingClientRect()
    event.preventDefault()
    openRowContextMenu(resolvedRow, rect.left + 12, rect.top + rect.height / 2)
    return
  }

  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }

  if (isInteractiveTarget(event.target)) {
    return
  }

  if (interaction.rowUsesDetailLink) {
    event.preventDefault()
    if (onRowClick) {
      onRowClick(resolvedRow)
      return
    }
    openDetailFromRow(event.currentTarget)
    return
  }

  if (!onRowClick) {
    return
  }

  event.preventDefault()
  activateRow(event, resolvedRow, data, onRowClick)
}

type DataTableBodyRowProps<TData extends object> = {
  row: DataTableBodyRowModel<TData>
  data: TData[]
  rowBehaviour?: DataTableRowBehaviour<TData>
  interaction: RowInteractionState
  tabIndex: number | undefined
  openRowContextMenu: (row: TData, x: number, y: number) => boolean
  onArrowFocus: (direction: 'up' | 'down') => void
  onRowFocus: () => void
}

export function DataTableBodyRow<TData extends object>({
  row,
  data,
  rowBehaviour,
  interaction,
  tabIndex,
  openRowContextMenu,
  onArrowFocus,
  onRowFocus,
}: DataTableBodyRowProps<TData>) {
  const rowData = row.original
  const rowId = getTableRowId(rowData)
  const onRowClick = rowBehaviour?.onRowClick
  const showClickableStyles = Boolean(onRowClick)

  return (
    <TableRow
      key={row.id}
      data-table-row="true"
      data-row-id={rowId}
      data-state={row.getIsSelected() && 'selected'}
      onClick={(event) => handleRowClick(event, data, rowData, onRowClick)}
      onPointerEnter={() => rowBehaviour?.onRowPrefetch?.(rowData)}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          onRowFocus()
        }
        rowBehaviour?.onRowPrefetch?.(rowData)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        openRowContextMenu(resolveRowFromElement(event.currentTarget, data, rowData), event.clientX, event.clientY)
      }}
      onKeyDown={(event) =>
        handleDataTableBodyRowKeyDown({
          event,
          rowData,
          data,
          interaction,
          rowBehaviour,
          openRowContextMenu,
          onArrowFocus,
        })
      }
      tabIndex={tabIndex}
      className={showClickableStyles ? clickableRowClassName : undefined}
    >
      {row.getVisibleCells().map((cell) => {
        const cellContent = flexRender(
          cell.column.columnDef.cell as never,
          cell.getContext() as never,
        )
        const shouldRenderRowLink =
          interaction.rowUsesDetailLink && isDataTableRowLinkColumn(cell.column.columnDef)

        return (
          <TableCell
            key={cell.id}
            data-column-id={cell.column.id}
            className={getDataTableCellClassName(cell.column.columnDef, Boolean(onRowClick))}
            onClick={onRowClick ? (event) => activateRow(event, rowData, data, onRowClick) : undefined}
          >
            {shouldRenderRowLink && interaction.rowHref && interaction.rowAccessibleName ? (
              <DataTableRowDetailLink
                href={interaction.rowHref}
                accessibleName={interaction.rowAccessibleName}
                tabIndex={-1}
              >
                {cellContent}
              </DataTableRowDetailLink>
            ) : (
              cellContent
            )}
          </TableCell>
        )
      })}
    </TableRow>
  )
}
