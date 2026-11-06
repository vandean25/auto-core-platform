import { useEffect, useRef, useState, type RefObject } from 'react'

import type { DataTableBodyRowModel } from './data-table-body-row'
import { getRowInteraction } from './data-table-body-row'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'

export function findRowElement(body: HTMLElement | null, rowKey: string) {
  return [...(body?.querySelectorAll<HTMLElement>('tr[data-row-key]') ?? [])].find(
    (element) => element.dataset.rowKey === rowKey,
  )
}

/**
 * Roving focus by record ID, so it survives virtualization: the row that is not mounted yet is scrolled to and focused
 * once it renders. `scrollToRow` is set by the virtualizer (undefined for offset tables, where every row is mounted).
 */
export function useDataTableRovingFocus<TData extends object>(
  bodyRows: DataTableBodyRowModel<TData>[],
  rowBehaviour: DataTableRowBehaviour<TData> | undefined,
  tableBodyRef: RefObject<HTMLTableSectionElement | null>,
  scrollToRow?: RefObject<((index: number) => void) | null>,
) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  // The row to focus once it has rendered (virtualized: after the scroll brought it into the window).
  const pendingKey = useRef<string | null>(null)

  const rovingKeys = bodyRows
    .filter((row) => getRowInteraction(row, rowBehaviour).rowIsRovingFocusable)
    .map((row) => row.id)
  // The one tab stop: the focused record, or the first one while it is gone (new filter, other page).
  const activeKey = focusedKey !== null && rovingKeys.includes(focusedKey) ? focusedKey : (rovingKeys[0] ?? null)

  const focusRow = (rowKey: string) => {
    setFocusedKey(rowKey)
    const element = findRowElement(tableBodyRef.current, rowKey)
    if (element) {
      element.focus()
      return
    }
    pendingKey.current = rowKey
    scrollToRow?.current?.(bodyRows.findIndex((row) => row.id === rowKey))
  }

  // Runs after every render, because the render that mounts the target is the virtualizer's, not ours.
  useEffect(() => {
    if (pendingKey.current === null) return
    const element = findRowElement(tableBodyRef.current, pendingKey.current)
    if (!element) return
    pendingKey.current = null
    element.focus()
  })

  const moveFocusFrom = (rowKey: string, step: 1 | -1) => {
    const position = rovingKeys.indexOf(rowKey)
    if (position < 0) return
    focusRow(rovingKeys[Math.max(0, Math.min(position + step, rovingKeys.length - 1))])
  }

  const tabIndexForRow = (rowKey: string, rowIsRovingFocusable: boolean) =>
    rowIsRovingFocusable && rovingKeys.includes(rowKey) ? (rowKey === activeKey ? 0 : -1) : undefined

  const onRowFocus = (rowKey: string) => {
    if (rovingKeys.includes(rowKey)) setFocusedKey(rowKey)
  }

  return {
    moveFocusFrom,
    tabIndexForRow,
    onRowFocus,
    activeKey,
    hasRovingRows: rovingKeys.length > 0,
  }
}
