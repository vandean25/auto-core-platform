import { useMemo, useState, type ReactNode } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef, LegacyReactTable as Table } from '@tanstack/react-table/legacy'
import { useTranslation } from 'react-i18next'

import { Checkbox } from '@/components/ui/checkbox'
import { isDataTablePendingRow } from './data-table-states'
import { DataTableActionBar } from './data-table-action-bar'
import type { DataTableBulkControls } from './data-table-props'

/** The row a Shift-click extends from (the last row selected by click), handed to the cells through table `meta`. */
export type DataTableSelectionMeta = { anchorId: string | null; setAnchorId: (id: string | null) => void }

// Header and cell are components (TanStack renders function renderers as components), so they may call hooks.
function createSelectColumn<TData extends object>(infinite: boolean): ColumnDef<TData> {
  return {
    id: 'select',
    header: function SelectAllHeader({ table }) {
      const { t } = useTranslation('common')
      // An infinite list selects only what is loaded; later pages are never selected silently (ADR-0035 §8).
      const label = infinite
        ? t('dataTable.selectAllLoaded', { count: table.getRowModel().rows.length })
        : t('dataTable.selectAll')
      return (
        <Checkbox
          aria-label={label}
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
          disabled={!table.getRowModel().rows.some((candidate) => candidate.getCanSelect())}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
        />
      )
    },
    cell: function SelectRowCell({ row, table }) {
      const { t } = useTranslation('common')
      if (isDataTablePendingRow(row.original)) {
        return null
      }
      return (
        <Checkbox
          aria-label={t('dataTable.selectRow')}
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onClick={(event) => {
            const { anchorId, setAnchorId } = table.options.meta as DataTableSelectionMeta
            const loaded = table.getRowModel().rows
            const from = loaded.findIndex((candidate) => candidate.id === anchorId && candidate.getIsSelected())
            const to = loaded.findIndex((candidate) => candidate.id === row.id)
            if (event.shiftKey && from >= 0 && to >= 0) {
              // Ranges run over the loaded rows in display order, so they also cover rows virtualized out of the DOM.
              event.preventDefault()
              const range = loaded.slice(Math.min(from, to), Math.max(from, to) + 1).filter((candidate) => candidate.getCanSelect())
              table.setRowSelection((previous) => ({ ...previous, ...Object.fromEntries(range.map((candidate) => [candidate.id, true])) }))
              setAnchorId(row.id)
              return
            }
            setAnchorId(row.getIsSelected() ? null : row.id)
          }}
          onCheckedChange={(value) => row.toggleSelected(value === true)}
        />
      )
    },
    enableSorting: false,
    enableHiding: false,
  }
}

/** Row selection state plus the checkbox column, which is only added when `enabled`. */
export function useDataTableSelection<TData extends object>(enabled: boolean, resetKey: string, infinite: boolean) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  // Selected rows belong to one page of one result set, so any change of sort, filter, search or page drops them.
  const [seenResetKey, setSeenResetKey] = useState(resetKey)
  const [anchorId, setAnchorId] = useState<string | null>(null)
  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey)
    setRowSelection({})
    setAnchorId(null)
  }
  // Stable identity: header and cell are components, which would remount on every render otherwise.
  const selectColumn = useMemo(() => createSelectColumn<TData>(infinite), [infinite])

  return {
    rowSelection,
    setRowSelection,
    selectionMeta: { anchorId, setAnchorId } satisfies DataTableSelectionMeta,
    withSelectColumn: (columns: ColumnDef<TData>[]) => (enabled ? [selectColumn, ...columns] : columns),
  }
}

interface DataTableSelectionBarProps<TData extends object> {
  table: Table<TData>
  bulkActions?: (selectedRows: TData[], controls: DataTableBulkControls) => ReactNode
  disabled?: boolean
}

export function DataTableSelectionBar<TData extends object>({
  table,
  bulkActions,
  disabled = false,
}: DataTableSelectionBarProps<TData>) {
  if (disabled) return null
  const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original as TData)
  if (!bulkActions || selectedRows.length === 0) return null

  const clearSelection = () => table.toggleAllRowsSelected(false)
  const selectOnly = (ids: string[]) => table.setRowSelection(Object.fromEntries(ids.map((id) => [id, true])))
  const selectableCount = table.getRowModel().rows.filter((row) => row.getCanSelect()).length
  return (
    <DataTableActionBar
      selectedCount={selectedRows.length}
      onClear={clearSelection}
      selectAllLoaded={
        selectableCount > selectedRows.length
          ? { count: selectableCount, onSelect: () => table.toggleAllPageRowsSelected(true) }
          : undefined
      }
    >
      {bulkActions(selectedRows, { clearSelection, selectOnly })}
    </DataTableActionBar>
  )
}
