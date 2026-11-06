import { useEffect, type RefObject } from 'react'
import type { LegacyReactTable as LegacyTable } from '@tanstack/react-table/legacy'
import { useTranslation } from 'react-i18next'

import { registerShortcutHelpEntries } from '@/features/shortcuts/shortcut-help-entries'
import { useShortcutHandler } from '@/features/shortcuts/shortcut-dispatcher'

const ACTIONABLE_ROW_SELECTOR = 'tr[data-table-row="true"][tabindex]'

function moveRowFocus(body: HTMLElement, focusedRow: HTMLTableRowElement, step: 1 | -1) {
  const rows = [...body.querySelectorAll<HTMLTableRowElement>(ACTIONABLE_ROW_SELECTOR)]
  const next = rows.indexOf(focusedRow) + step
  rows[Math.max(0, Math.min(next, rows.length - 1))]?.focus()
}

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

/**
 * j/k move focus between loaded rows and x toggles selection (ADR-0036 R5). One handler per table,
 * never per row. It only acts when focus is on a row of THIS table, so overlapping lists stay independent.
 */
export function useDataTableRowShortcuts<TData extends object>(
  table: LegacyTable<TData>,
  tableBodyRef: RefObject<HTMLTableSectionElement | null>,
  hasActionableRows: boolean,
) {
  const { t } = useTranslation('common')
  const canSelect = Boolean(table.options.enableRowSelection)

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
    const body = tableBodyRef.current
    const focusedRow = document.activeElement?.closest<HTMLTableRowElement>(ACTIONABLE_ROW_SELECTOR)
    if (!body || !focusedRow || !body.contains(focusedRow)) {
      return false
    }
    if (key === 'j' || key === 'k') {
      moveRowFocus(body, focusedRow, key === 'j' ? 1 : -1)
      return true
    }
    return key === 'x' && canSelect && toggleRowSelection(table, focusedRow)
  })
}
