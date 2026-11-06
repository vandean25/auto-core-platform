import {
  type LegacyColumnDef as ColumnDef,
  getCoreRowModel,
  useLegacyTable as useReactTable,
} from '@tanstack/react-table/legacy'
import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'

import type { DataTableBodyRowModel } from './data-table-body-row'
import { isDataTablePendingRow } from './data-table-states'
import type { DataTableSelectionMeta } from './data-table-selection'

type UseDataTableInstanceParams<TData extends object> = {
  data: TData[]
  columns: ColumnDef<TData>[]
  pageCount: number
  columnFilters: ColumnFiltersState
  setColumnFilters: OnChangeFn<ColumnFiltersState>
  globalFilter?: string
  setGlobalFilter?: OnChangeFn<string>
  sorting: SortingState
  setSorting: OnChangeFn<SortingState>
  pagination: PaginationState
  setPagination: OnChangeFn<PaginationState>
  hasBulkActions: boolean
  /** A stale preview is not actionable: nothing can be selected until the new result lands (ADR-0036 R2). */
  selectionLocked: boolean
  rowSelection: RowSelectionState
  selectionMeta: DataTableSelectionMeta
  setRowSelection: OnChangeFn<RowSelectionState>
}

export function useDataTableInstance<TData extends object>({
  data,
  columns,
  pageCount,
  columnFilters,
  setColumnFilters,
  globalFilter,
  setGlobalFilter,
  sorting,
  setSorting,
  pagination,
  setPagination,
  hasBulkActions,
  selectionLocked,
  rowSelection,
  selectionMeta,
  setRowSelection,
}: UseDataTableInstanceParams<TData>) {
  const table = useReactTable({
    data,
    columns,
    pageCount,
    getRowId: (row, index) => {
      const id = (row as { id?: unknown }).id
      return typeof id === 'string' && id.length > 0 ? id : String(index)
    },
    meta: selectionMeta,
    state: { columnFilters, sorting, pagination, globalFilter, rowSelection },
    // Pending rows (optimistic creates) are presentation only: never selectable, also not by select-all.
    enableRowSelection: hasBulkActions ? (row) => !selectionLocked && !isDataTablePendingRow(row.original) : false,
    onRowSelectionChange: setRowSelection,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  })

  const bodyRowModels = table.getRowModel().rows.map((row) => row as DataTableBodyRowModel<TData>)

  return { table, bodyRowModels }
}
