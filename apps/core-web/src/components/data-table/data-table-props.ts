import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
} from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { MutableRefObject, ReactNode } from 'react'

import type { DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import type { DataTableEmptyState } from './data-table-states'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'

export const DEFAULT_DATA_TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

export type DataTableCoreProps<TData extends object> = {
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
