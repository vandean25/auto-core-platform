import type { DataTableRowBehaviour } from './data-table-row-behaviour'
import { isDataTablePendingRow } from './data-table-states'
import { clickableRowClassName } from './data-table-row-styles'
import { cn } from '@/lib/utils'

/** A stale preview and a pending row are both inert: no click, prefetch or clickable styling. */
export function resolveLockedRowBehaviour<TData extends object>(
  interactionLocked: boolean,
  rowBehaviour: DataTableRowBehaviour<TData> | undefined,
  rowData: TData,
) {
  if (interactionLocked || isDataTablePendingRow(rowData)) {
    return { onRowClick: undefined, onRowPrefetch: undefined, showClickableStyles: false }
  }
  const onRowClick = rowBehaviour?.onRowClick
  return {
    onRowClick,
    onRowPrefetch: rowBehaviour?.onRowPrefetch,
    showClickableStyles: Boolean(onRowClick),
  }
}

export function getBodyRowClassName(rowData: object, showClickableStyles: boolean) {
  const isPendingRow = isDataTablePendingRow(rowData)
  return cn(
    isPendingRow && 'bg-muted/40 text-muted-foreground',
    showClickableStyles ? clickableRowClassName : undefined,
  )
}

export function shouldOpenBodyRowContextMenu(interactionLocked: boolean, rowData: object) {
  return !interactionLocked && !isDataTablePendingRow(rowData)
}
