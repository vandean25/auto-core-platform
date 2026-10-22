import { useEffect, useState, type RefObject } from 'react'

import type { DataTableBodyRowModel } from './data-table-body-row'
import { getRowInteraction } from './data-table-body-row'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'

export function useDataTableRovingFocus<TData extends object>(
  bodyRows: DataTableBodyRowModel<TData>[],
  rowBehaviour: DataTableRowBehaviour<TData> | undefined,
  data: TData[],
  paginationKey: string,
  tableBodyRef: RefObject<HTMLTableSectionElement | null>,
) {
  const [focusedRowIndex, setFocusedRowIndex] = useState(0)

  const rovingRowIndices = bodyRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => getRowInteraction(row, rowBehaviour).rowIsRovingFocusable)
    .map(({ index }) => index)

  useEffect(() => {
    setFocusedRowIndex(0)
  }, [data, paginationKey])

  const focusRowAtRovingIndex = (rovingIndex: number) => {
    if (rovingRowIndices.length === 0) return
    const clamped = Math.max(0, Math.min(rovingIndex, rovingRowIndices.length - 1))
    setFocusedRowIndex(clamped)
    const domIndex = rovingRowIndices[clamped]
    const rowElement = tableBodyRef.current?.querySelectorAll<HTMLTableRowElement>(
      'tr[data-table-row="true"]',
    )[domIndex]
    rowElement?.focus()
  }

  const handleArrowFocus = (visibleRowIndex: number, direction: 'up' | 'down') => {
    const rovingPosition = rovingRowIndices.indexOf(visibleRowIndex)
    if (rovingPosition < 0) return
    const next =
      direction === 'down'
        ? Math.min(rovingPosition + 1, rovingRowIndices.length - 1)
        : Math.max(rovingPosition - 1, 0)
    focusRowAtRovingIndex(next)
  }

  const tabIndexForRow = (visibleRowIndex: number, rowIsRovingFocusable: boolean) => {
    const rovingPosition = rovingRowIndices.indexOf(visibleRowIndex)
    if (!rowIsRovingFocusable || rovingPosition < 0) return undefined
    return rovingPosition === focusedRowIndex ? 0 : -1
  }

  const onRowFocus = (visibleRowIndex: number) => {
    const rovingPosition = rovingRowIndices.indexOf(visibleRowIndex)
    if (rovingPosition >= 0) {
      setFocusedRowIndex(rovingPosition)
    }
  }

  return { handleArrowFocus, tabIndexForRow, onRowFocus }
}
