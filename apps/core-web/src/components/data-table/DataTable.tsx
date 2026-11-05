import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
} from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { MutableRefObject, ReactNode } from 'react'

import type { DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import { DataTableSurface } from './data-table-surface'
import type { DataTableEmptyState } from './data-table-states'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'
import { useDataTableViewModel } from './use-data-table-view-model'

interface DataTableProps<TData extends object> {
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

export function DataTable<TData extends object>(props: DataTableProps<TData>) {
  const viewModel = useDataTableViewModel(props)
  return (
    <DataTableSurface
      {...viewModel}
      searchColumn={props.searchColumn}
      searchPlaceholder={props.searchPlaceholder}
      saveViewTitle={props.saveViewTitle}
      dashboardSource={props.dashboardSource}
      enableCsvExport={props.enableCsvExport}
      csvFileName={props.csvFileName}
      emptyState={props.emptyState}
      onRetry={props.onRetry}
    />
  )
}
