import {
  type LegacyColumnDef as ColumnDef,
  getCoreRowModel,
  useLegacyTable as useReactTable,
} from '@tanstack/react-table/legacy'
import {
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type OnChangeFn,
} from '@tanstack/react-table'
import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useIsMobile } from '@/hooks/use-mobile'
import type { DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import { DataTableDensityContext, type DataTableDensity } from './data-table-density-toggle'
import { DataTableGrid } from './data-table-grid'
import { DataTableList } from './data-table-list'
import { useDataTableContextMenu } from './data-table-context-menu'
import { DataTableSelectionBar, useDataTableSelection } from './data-table-selection'
import type { DataTableEmptyState } from './data-table-states'
import { DataTableToolbar } from './data-table-toolbar'
import { DataTablePagination } from './data-table-pagination'
import type { DataTableBodyRowModel } from './data-table-body-row'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

interface DataTableProps<TData extends object> {
  columns: ColumnDef<TData>[]
  data: TData[]
  pageCount?: number
  isLoading?: boolean
  saveViewTitle?: string
  dashboardSource?: DashboardWidgetTableSource
  columnFilters: ColumnFiltersState
  setColumnFilters: OnChangeFn<ColumnFiltersState>
  globalFilter?: string
  setGlobalFilter?: OnChangeFn<string>
  sorting: SortingState
  setSorting: OnChangeFn<SortingState>
  pagination: PaginationState
  setPagination: OnChangeFn<PaginationState>
  searchColumn?: string
  searchPlaceholder?: string
  emptyStateMessage?: string
  emptyState?: DataTableEmptyState
  bulkActions?: (selectedRows: TData[]) => ReactNode
  rowBehaviour?: DataTableRowBehaviour<TData>
  pageSizeOptions?: readonly number[]
  enableCsvExport?: boolean
  csvFileName?: string
}

export function DataTable<TData extends object>({
  columns,
  data,
  pageCount = -1,
  isLoading = false,
  saveViewTitle,
  dashboardSource,
  columnFilters,
  setColumnFilters,
  globalFilter,
  setGlobalFilter,
  sorting,
  setSorting,
  pagination,
  setPagination,
  searchColumn,
  searchPlaceholder,
  emptyStateMessage,
  emptyState,
  bulkActions,
  rowBehaviour,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  enableCsvExport,
  csvFileName,
}: DataTableProps<TData>) {
  const { t } = useTranslation('common')
  const resolvedEmptyStateMessage = emptyStateMessage ?? t('dataTable.noResults')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [density, setDensity] = useState<DataTableDensity>('normal')
  const isMobile = useIsMobile()
  const hasBulkActions = Boolean(bulkActions)
  const { rowSelection, setRowSelection, withSelectColumn } = useDataTableSelection<TData>(
    hasBulkActions,
    JSON.stringify([sorting, columnFilters, globalFilter, pagination]),
  )

  const { openRowContextMenu, menu: contextMenu } = useDataTableContextMenu(
    rowBehaviour?.getRowContextActions,
  )

  const table = useReactTable({
    data,
    columns: withSelectColumn(columns),
    pageCount,
    getRowId: (row, index) => {
      const id = (row as { id?: unknown }).id
      return typeof id === 'string' && id.length > 0 ? id : String(index)
    },
    state: {
      columnFilters,
      sorting,
      pagination,
      globalFilter,
      rowSelection,
    },
    enableRowSelection: hasBulkActions,
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

  const bodyRows = table.getRowModel().rows

  const bodyRowModels = bodyRows.map((row) => row as DataTableBodyRowModel<TData>)

  return (
    <div className="space-y-4" ref={rootRef}>
      <DataTableDensityContext.Provider value={{ density, setDensity }}>
        <DataTableToolbar
          table={table}
          searchColumn={searchColumn}
          placeholder={searchPlaceholder}
          saveViewTitle={saveViewTitle}
          dashboardSource={dashboardSource}
          enableCsvExport={enableCsvExport}
          csvFileName={csvFileName}
          getRoot={() => rootRef.current}
          isLoading={isLoading}
        />
      </DataTableDensityContext.Provider>
      {isMobile && !isLoading && bodyRows.length ? (
        <DataTableList columns={table.getVisibleLeafColumns()} rows={bodyRowModels} rowBehaviour={rowBehaviour} />
      ) : (
        <DataTableGrid
          table={table}
          data={data}
          rowBehaviour={rowBehaviour}
          isLoading={isLoading}
          density={density}
          hideHeader={isMobile}
          openRowContextMenu={openRowContextMenu}
          emptyStateMessage={resolvedEmptyStateMessage}
          emptyState={emptyState}
        />
      )}
      <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />

      <DataTableSelectionBar table={table} bulkActions={bulkActions} />

      {contextMenu}
    </div>
  )
}
