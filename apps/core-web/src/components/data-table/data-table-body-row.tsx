import {
  useEffect,
  useId,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { TableCell, TableRow } from '@/components/ui/table'
import { flexRender } from '@tanstack/react-table'
import {
  cancelIntentPrefetch,
  scheduleIntentPrefetch,
  startImmediateIntentPrefetch,
} from '@/lib/intent-prefetch'
import { cn } from '@/lib/utils'
import { getDataTableCellClassName } from './data-table-column-meta'
import { isDataTablePendingRow } from './data-table-states'
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
  if (isDataTablePendingRow(rowData)) {
    return {
      rowUsesDetailLink: false,
      rowIsRovingFocusable: false,
    }
  }
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

function handleDataTableRowArrowKey(
  event: ReactKeyboardEvent<HTMLTableRowElement>,
  onArrowFocus: (direction: 'up' | 'down') => void,
): boolean {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
    return false
  }
  if (isInteractiveTarget(event.target)) {
    return true
  }
  event.preventDefault()
  onArrowFocus(event.key === 'ArrowDown' ? 'down' : 'up')
  return true
}

function handleDataTableRowContextMenuKey<TData extends object>(
  event: ReactKeyboardEvent<HTMLTableRowElement>,
  resolvedRow: TData,
  openRowContextMenu: (row: TData, x: number, y: number) => boolean,
): boolean {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
    return false
  }
  const rect = event.currentTarget.getBoundingClientRect()
  event.preventDefault()
  openRowContextMenu(resolvedRow, rect.left + 12, rect.top + rect.height / 2)
  return true
}

function handleDataTableRowActivateKey<TData extends object>(
  event: ReactKeyboardEvent<HTMLTableRowElement>,
  resolvedRow: TData,
  data: TData[],
  interaction: RowInteractionState,
  onRowClick: ((row: TData) => void) | undefined,
): boolean {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return false
  }
  if (isInteractiveTarget(event.target)) {
    return true
  }
  if (interaction.rowUsesDetailLink) {
    event.preventDefault()
    if (onRowClick) {
      onRowClick(resolvedRow)
      return true
    }
    openDetailFromRow(event.currentTarget)
    return true
  }
  if (!onRowClick) {
    return false
  }
  event.preventDefault()
  activateRow(event, resolvedRow, data, onRowClick)
  return true
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

  if (handleDataTableRowArrowKey(event, onArrowFocus)) return
  if (handleDataTableRowContextMenuKey(event, resolvedRow, openRowContextMenu)) return
  handleDataTableRowActivateKey(event, resolvedRow, data, interaction, onRowClick)
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
  interactionLocked?: boolean
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
  interactionLocked = false,
}: DataTableBodyRowProps<TData>) {
  const fallbackRowId = useId()
  const rowData = row.original
  const rowId = getTableRowId(rowData)
  const targetId = rowId ?? `${fallbackRowId}:${row.id}`
  const hoverIntentKey = `row-hover:${targetId}`
  const focusIntentKey = `row-focus:${targetId}`
  const onRowClick = interactionLocked ? undefined : rowBehaviour?.onRowClick
  const onRowPrefetch = interactionLocked ? undefined : rowBehaviour?.onRowPrefetch
  const showClickableStyles = Boolean(onRowClick) && !interactionLocked
  const isPendingRow = isDataTablePendingRow(rowData)

  useEffect(() => {
    return () => {
      cancelIntentPrefetch(hoverIntentKey)
      cancelIntentPrefetch(focusIntentKey)
    }
  }, [focusIntentKey, hoverIntentKey])

  return (
    <TableRow
      key={row.id}
      data-table-row="true"
      data-row-id={rowId}
      data-state={row.getIsSelected() && 'selected'}
      onClick={(event) => handleRowClick(event, data, rowData, onRowClick)}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch' || !onRowPrefetch) return
        scheduleIntentPrefetch(hoverIntentKey, () => onRowPrefetch(rowData))
      }}
      onPointerLeave={() => {
        cancelIntentPrefetch(hoverIntentKey)
      }}
      onPointerDown={(event) => {
        if (
          event.pointerType === 'touch' ||
          !onRowPrefetch ||
          isInteractiveTarget(event.target)
        ) {
          return
        }
        cancelIntentPrefetch(focusIntentKey)
        startImmediateIntentPrefetch(hoverIntentKey, () => onRowPrefetch(rowData))
      }}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          onRowFocus()
          if (onRowPrefetch) {
            scheduleIntentPrefetch(focusIntentKey, () => onRowPrefetch(rowData))
          }
        }
      }}
      onBlur={(event) => {
        if (event.target === event.currentTarget) {
          cancelIntentPrefetch(focusIntentKey)
        }
      }}
      onContextMenu={(event) => {
        if (interactionLocked || isPendingRow) return
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
      tabIndex={interactionLocked ? -1 : tabIndex}
      className={cn(isPendingRow && 'bg-muted/40 text-muted-foreground', showClickableStyles ? clickableRowClassName : undefined)}
      aria-disabled={interactionLocked || isPendingRow ? true : undefined}
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
