import {
  type LegacyColumnDef as ColumnDef,
  getCoreRowModel,
  useLegacyTable as useReactTable,
} from '@tanstack/react-table/legacy'
import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
} from '@tanstack/react-table'
import { useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import type { DataTableDensity } from '@/lib/density-tokens'
import { useIsMobile } from '@/hooks/use-mobile'
import type { DataTableBodyRowModel } from './data-table-body-row'
import { useDataTableContextMenu } from './data-table-context-menu'
import { useDataTableSelection } from './data-table-selection'
import { useDataTablePresentation, type DataTableEmptyState } from './data-table-states'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

export type DataTableViewModelProps<TData extends object> = {
  columns: ColumnDef<TData>[]
  data: TData[]
  pageCount?: number
  isLoading?: boolean
  isFetching?: boolean
  isPlaceholderData?: boolean
  isError?: boolean
  onRetry?: () => void
  bypassSkeleton?: boolean
  hasUsableData?: boolean
  fetchErrorMessage?: string
  presentationLatencyRef?: MutableRefObject<number | null>
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

export function useDataTableViewModel<TData extends object>({
  columns,
  data,
  pageCount = -1,
  isLoading = false,
  isFetching = false,
  isPlaceholderData = false,
  isError = false,
  bypassSkeleton = false,
  hasUsableData: hasUsableDataProp,
  fetchErrorMessage,
  presentationLatencyRef,
  columnFilters,
  setColumnFilters,
  globalFilter,
  setGlobalFilter,
  sorting,
  setSorting,
  pagination,
  setPagination,
  emptyStateMessage,
  bulkActions,
  rowBehaviour,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: DataTableViewModelProps<TData>) {
  const { t } = useTranslation('common')
  const resolvedEmptyStateMessage = emptyStateMessage ?? t('dataTable.noResults')
  const hasUsableData = hasUsableDataProp ?? !isLoading
  const presentation = useDataTablePresentation({
    isLoading,
    isFetching,
    isPlaceholderData,
    isError,
    hasUsableData,
    bypassSkeleton,
  })

  if (presentationLatencyRef && presentation.presentationLatencyMs !== null) {
    presentationLatencyRef.current = presentation.presentationLatencyMs
  }

  const resolvedFetchErrorMessage =
    fetchErrorMessage ??
    (presentation.staleFetchFailed || (isError && !hasUsableData)
      ? t('dataTable.loading.loadFailed')
      : undefined)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const [density, setDensity] = useState<DataTableDensity>('comfortable')
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
    state: { columnFilters, sorting, pagination, globalFilter, rowSelection },
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

  const bodyRowModels = table.getRowModel().rows.map((row) => row as DataTableBodyRowModel<TData>)

  return {
    table,
    data,
    rowBehaviour,
    presentation,
    isLoading,
    hasUsableData,
    isError,
    resolvedEmptyStateMessage,
    resolvedFetchErrorMessage,
    rootRef,
    density,
    setDensity,
    isMobile,
    openRowContextMenu,
    contextMenu,
    bodyRowModels,
    bodyRowCount: bodyRowModels.length,
    pageSizeOptions,
    bulkActions,
  }
}

export type DataTableViewModel<TData extends object> = ReturnType<typeof useDataTableViewModel<TData>>
