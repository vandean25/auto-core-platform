import { useMemo, useState, type ReactNode } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef, LegacyReactTable as Table } from '@tanstack/react-table/legacy'
import { useTranslation } from 'react-i18next'

import { Checkbox } from '@/components/ui/checkbox'
import { DataTableActionBar } from './data-table-action-bar'

// Header and cell are components (TanStack renders function renderers as components), so they may call hooks.
function createSelectColumn<TData extends object>(): ColumnDef<TData> {
  return {
    id: 'select',
    header: function SelectAllHeader({ table }) {
      const { t } = useTranslation('common')
      return (
        <Checkbox
          aria-label={t('dataTable.selectAll')}
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
        />
      )
    },
    cell: function SelectRowCell({ row }) {
      const { t } = useTranslation('common')
      return (
        <Checkbox
          aria-label={t('dataTable.selectRow')}
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(value === true)}
        />
      )
    },
    enableSorting: false,
    enableHiding: false,
  }
}

/** Row selection state plus the checkbox column, which is only added when `enabled`. */
export function useDataTableSelection<TData extends object>(enabled: boolean, resetKey: string) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  // Selected rows belong to one page of one result set, so any change of sort, filter, search or page drops them.
  const [seenResetKey, setSeenResetKey] = useState(resetKey)
  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey)
    setRowSelection({})
  }
  // Stable identity: header and cell are components, which would remount on every render otherwise.
  const selectColumn = useMemo(() => createSelectColumn<TData>(), [])

  return {
    rowSelection,
    setRowSelection,
    withSelectColumn: (columns: ColumnDef<TData>[]) => (enabled ? [selectColumn, ...columns] : columns),
  }
}

interface DataTableSelectionBarProps<TData extends object> {
  table: Table<TData>
  bulkActions?: (selectedRows: TData[]) => ReactNode
}

export function DataTableSelectionBar<TData extends object>({ table, bulkActions }: DataTableSelectionBarProps<TData>) {
  const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original as TData)
  if (!bulkActions || selectedRows.length === 0) return null

  return (
    <DataTableActionBar selectedCount={selectedRows.length} onClear={() => table.toggleAllRowsSelected(false)}>
      {bulkActions(selectedRows)}
    </DataTableActionBar>
  )
}
