import { useEffect, type RefObject } from 'react'
import type { LegacyReactTable as LegacyTable } from '@tanstack/react-table/legacy'
import { useTranslation } from 'react-i18next'

import { registerShortcutHelpEntries } from '@/features/shortcuts/shortcut-help-entries'
import { useShortcutHandler } from '@/features/shortcuts/shortcut-dispatcher'

const ACTIONABLE_ROW_SELECTOR = 'tr[data-table-row="true"][tabindex]'

function toggleRowSelection<TData extends object>(
  table: LegacyTable<TData>,
  focusedRow: HTMLTableRowElement,
): boolean {
  const rowId = focusedRow.getAttribute('data-row-id')
  const row = rowId ? table.getRowModel().rowsById[rowId] : undefined
  if (!row?.getCanSelect()) return false
  row.toggleSelected()
  return true
}

/** The actionable row that has focus, if it belongs to this table. */
function focusedRowOf(body: HTMLElement | null) {
  const focusedRow = document.activeElement?.closest<HTMLTableRowElement>(ACTIONABLE_ROW_SELECTOR)
  return body && focusedRow && body.contains(focusedRow) ? focusedRow : undefined
}

/**
 * j/k move focus between loaded rows and x toggles selection (ADR-0036 R5). One handler per table,
 * never per row. It only acts when focus is on a row of THIS table, so overlapping lists stay independent.
 * Moving is by record ID (`moveFocusFrom`), so it also reaches rows outside a virtualized render window.
 */
export function useDataTableRowShortcuts<TData extends object>(
  table: LegacyTable<TData>,
  tableBodyRef: RefObject<HTMLTableSectionElement | null>,
  hasActionableRows: boolean,
  moveFocusFrom: (rowKey: string, step: 1 | -1) => void,
) {
  const { t } = useTranslation('common')
  const canSelect = Boolean(table.options.enableRowSelection)
  const moveFocus = (row: HTMLTableRowElement, step: 1 | -1) => {
    moveFocusFrom(row.dataset.rowKey ?? '', step)
    return true
  }

  useEffect(() => {
    if (!hasActionableRows) return undefined
    return registerShortcutHelpEntries([
      { id: 'dataTable.rowNext', keys: ['J'], label: t('shortcuts.entries.rowNext') },
      { id: 'dataTable.rowPrevious', keys: ['K'], label: t('shortcuts.entries.rowPrevious') },
      ...(canSelect
        ? [{ id: 'dataTable.rowToggleSelection', keys: ['X'], label: t('shortcuts.entries.rowToggleSelection') }]
        : []),
    ])
  }, [canSelect, hasActionableRows, t])

  useShortcutHandler('row', (key) => {
    const focusedRow = focusedRowOf(tableBodyRef.current)
    if (!focusedRow) return false
    if (key === 'x') return canSelect && toggleRowSelection(table, focusedRow)
    return (key === 'j' || key === 'k') && moveFocus(focusedRow, key === 'j' ? 1 : -1)
  })
}
