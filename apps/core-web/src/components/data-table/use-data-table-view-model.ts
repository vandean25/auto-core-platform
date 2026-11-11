import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DataTableDensity } from '@/lib/density-tokens'
import { useClientSessionGeneration } from '@/auth/client-session-reset'
import { useIsMobile } from '@/hooks/use-mobile'
import { useDataTableContextMenu } from './data-table-context-menu'
import { useDataTableSelection } from './data-table-selection'
import {
  buildDataTablePresentationInput,
  mergeRefreshingInfinitePresentation,
  resolveDataTableFetchErrorMessage,
  useDataTablePresentation,
  usePresentationLatencyRef,
} from './data-table-loading'
import type { DataTableCoreProps } from './data-table-props'
import { DEFAULT_DATA_TABLE_PAGE_SIZE_OPTIONS } from './data-table-props'
import { useDataTableInfinite } from './use-data-table-infinite'
import { useDataTableInstance } from './use-data-table-instance'

export type DataTableViewModelProps<TData extends object> = DataTableCoreProps<TData>

export function useDataTableViewModel<TData extends object>({
  columns,
  data,
  pageCount = -1,
  isLoading = false,
  isPending: isPendingProp,
  isFetching = false,
  isPlaceholderData = false,
  isError = false,
  bypassSkeleton = false,
  hasUsableData: hasUsableDataProp,
  listSnapshotResolved: listSnapshotResolvedProp,
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
  pageSizeOptions = DEFAULT_DATA_TABLE_PAGE_SIZE_OPTIONS,
  infinite,
}: DataTableViewModelProps<TData>) {
  const { t } = useTranslation('common')
  const resolvedEmptyStateMessage = emptyStateMessage ?? t('dataTable.noResults')
  const hasUsableData = hasUsableDataProp ?? !isLoading
  const { rows, infiniteView } = useDataTableInfinite(infinite, data)
  const resolvedTotalCount = infiniteView?.totalCount ?? infinite?.totalCount
  const basePresentation = useDataTablePresentation(
    buildDataTablePresentationInput({
      isLoading,
      isPending: isPendingProp,
      isFetching,
      isPlaceholderData,
      isError,
      hasUsableData,
      resolvedTotalCount,
      listSnapshotResolvedProp,
      bypassSkeleton,
    }),
  )
  // While page one of a restarted or refreshed list loads, the rows on screen are a locked preview (ADR-0035 §6-7).
  const presentation = mergeRefreshingInfinitePresentation(basePresentation, Boolean(infiniteView?.isRefreshing))

  // An infinite list has no pages: an old `?page=3` link starts at the top and drops the page from the URL (ADR-0035).
  // Keyed on the state object, not the index: the URL sync of the table state can put the old index back on mount.
  const inInfiniteMode = infiniteView !== undefined
  useEffect(() => {
    if (inInfiniteMode && pagination.pageIndex > 0) setPagination((previous) => ({ ...previous, pageIndex: 0 }))
  }, [inInfiniteMode, pagination, setPagination])

  usePresentationLatencyRef(presentationLatencyRef, presentation.presentationLatencyMs)

  const resolvedFetchErrorMessage = resolveDataTableFetchErrorMessage(
    t,
    fetchErrorMessage,
    presentation,
    isError,
    hasUsableData,
  )

  const rootRef = useRef<HTMLDivElement | null>(null)
  const [density, setDensity] = useState<DataTableDensity>('comfortable')
  const isMobile = useIsMobile()
  const hasBulkActions = Boolean(bulkActions)
  // A tenant or site switch is a new scope: nothing selected before it may carry over (ADR-0035 §8).
  const sessionGeneration = useClientSessionGeneration()
  const { rowSelection, setRowSelection, selectionMeta, withSelectColumn } = useDataTableSelection<TData>(
    hasBulkActions,
    JSON.stringify([sorting, columnFilters, globalFilter, pagination, infiniteView?.restoreKey, infiniteView?.epoch, sessionGeneration]),
    infiniteView !== undefined,
  )
  const { openRowContextMenu, menu: contextMenu } = useDataTableContextMenu(
    rowBehaviour?.getRowContextActions,
  )

  const { table, bodyRowModels } = useDataTableInstance({
    data: rows,
    columns: withSelectColumn(columns),
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
    selectionLocked: presentation.isStalePreview,
    rowSelection,
    selectionMeta,
    setRowSelection,
  })

  return {
    table,
    data: rows,
    infiniteView,
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
