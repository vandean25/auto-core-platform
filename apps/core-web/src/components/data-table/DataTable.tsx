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
  flexRender,
} from '@tanstack/react-table'
import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import { TableSkeleton } from '@/components/ui/skeleton-presets'
import { cn } from '@/lib/utils'
import { getDataTableHeadClassName } from './data-table-column-meta'
import { DataTableDensityContext, type DataTableDensity } from './data-table-density-toggle'
import { useDataTableContextMenu } from './data-table-context-menu'
import { DataTableSelectionBar, useDataTableSelection } from './data-table-selection'
import { DataTableEmptyRow, type DataTableEmptyState } from './data-table-states'
import { DataTableToolbar } from './data-table-toolbar'
import { DataTablePagination } from './data-table-pagination'
import {
  DataTableBodyRow,
  type DataTableBodyRowModel,
  getRowInteraction,
} from './data-table-body-row'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'
import { useDataTableRovingFocus } from './use-data-table-roving-focus'

// Only header render functions (the DataTableColumnHeader pattern) expose a sort control.
// Plain-text headers do not, so they must not advertise sorting.
function getAriaSort(column: { columnDef: { header?: unknown }; getCanSort: () => boolean; getIsSorted: () => false | 'asc' | 'desc' }) {
  if (typeof column.columnDef.header !== 'function' || !column.getCanSort()) return undefined

  const sorted = column.getIsSorted()
  if (sorted === 'asc') return 'ascending' as const
  if (sorted === 'desc') return 'descending' as const
  return 'none' as const
}

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
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null)
  const [density, setDensity] = useState<DataTableDensity>('normal')
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

  const visibleColumnCount = table.getVisibleLeafColumns().length
  const bodyRows = table.getRowModel().rows

  const bodyRowModels = bodyRows.map((row) => row as DataTableBodyRowModel<TData>)
  const paginationKey = `${pagination.pageIndex}:${pagination.pageSize}`
  const { handleArrowFocus, tabIndexForRow, onRowFocus } = useDataTableRovingFocus(
    bodyRowModels,
    rowBehaviour,
    data,
    paginationKey,
    tableBodyRef,
  )

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
      <div
        className={cn(
          'max-w-full overflow-x-auto rounded-md border [&>div]:max-h-[70vh]',
          'data-[density=compact]:[&_td]:py-1.5 data-[density=compact]:[&_th]:h-9',
        )}
        data-density={density}
      >
        <Table aria-busy={isLoading}>
          <TableHeader className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} data-table-header="true">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={getAriaSort(header.column)}
                      className={getDataTableHeadClassName(header.column.columnDef)}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody ref={tableBodyRef}>
            {isLoading ? (
              <TableSkeleton rows={Math.min(pagination.pageSize, 8)} cols={visibleColumnCount} />
            ) : bodyRows.length ? (
              bodyRows.map((row, visibleRowIndex) => {
                const bodyRow = row as DataTableBodyRowModel<TData>
                const interaction = getRowInteraction(bodyRow, rowBehaviour)

                return (
                  <DataTableBodyRow
                    key={row.id}
                    row={bodyRow}
                    data={data}
                    rowBehaviour={rowBehaviour}
                    interaction={interaction}
                    tabIndex={tabIndexForRow(visibleRowIndex, interaction.rowIsRovingFocusable)}
                    openRowContextMenu={openRowContextMenu}
                    onArrowFocus={(direction) => handleArrowFocus(visibleRowIndex, direction)}
                    onRowFocus={() => onRowFocus(visibleRowIndex)}
                  />
                )
              })
            ) : (
              <DataTableEmptyRow
                colSpan={visibleColumnCount}
                fallbackMessage={resolvedEmptyStateMessage}
                emptyState={emptyState}
                columnFilters={columnFilters}
                globalFilter={globalFilter}
              />
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />

      <DataTableSelectionBar table={table} bulkActions={bulkActions} />

      {contextMenu}
    </div>
  )
}
