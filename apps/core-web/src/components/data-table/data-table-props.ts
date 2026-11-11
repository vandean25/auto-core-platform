import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
} from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { QueryKey } from '@tanstack/react-query'
import type { MutableRefObject, ReactNode } from 'react'

import type { DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import type { DataTableEmptyState } from './data-table-states'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'

export const DEFAULT_DATA_TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

/**
 * Optional infinite mode (ADR-0035). `data` is the flattened rows of the consumer's `useInfiniteQuery` (spread
 * `infiniteListQueryOptions` into it); the table virtualizes them, loads ahead and owns restart and refresh.
 */
export type DataTableInfiniteProps = {
  /** Key of that query. A different key (search, filter or sort changed) restarts the list at page one. */
  queryKey: QueryKey
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  fetchNextPage: () => unknown
  /** From the separate capped count query; leave out while unknown. */
  totalCount?: { count: number; isCapped: boolean }
  /** The count request failed: the rows stay usable, the table offers "Anzahl nicht verfügbar" with a retry. */
  isCountError?: boolean
  retryCount?: () => void
}

/** Handed to `bulkActions` so an action that finished can drop the selection it worked on, or keep only what is left to do. */
export type DataTableBulkControls = { clearSelection: () => void; selectOnly: (ids: string[]) => void }

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
  bulkActions?: (selectedRows: TData[], controls: DataTableBulkControls) => ReactNode
  rowBehaviour?: DataTableRowBehaviour<TData>
  pageSizeOptions?: readonly number[]
  infinite?: DataTableInfiniteProps
  enableCsvExport?: boolean
  csvFileName?: string
}
