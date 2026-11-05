import type { ReactNode } from 'react'
import type { LegacyReactTable as LegacyTable } from '@tanstack/react-table/legacy'

import type { DataTableDensity } from '@/lib/density-tokens'
import { DataTableGrid } from './data-table-grid'
import { DataTableList } from './data-table-list'
import type { DataTableBodyRowModel } from './data-table-body-row'
import {
  shouldShowDataTableFetchError,
  shouldUseMobileDataTableList,
  type DataTablePresentationState,
} from './data-table-loading'
import {
  DataTableFetchError,
  DataTableStaleStatus,
  type DataTableEmptyState,
} from './data-table-states'
import { DataTablePagination } from './data-table-pagination'
import { DataTableSelectionBar } from './data-table-selection'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'

type DataTableSurfaceMainProps<TData extends object> = {
  table: LegacyTable<TData>
  data: TData[]
  rowBehaviour?: DataTableRowBehaviour<TData>
  presentation: DataTablePresentationState
  isLoading: boolean
  hasUsableData: boolean
  isError: boolean
  resolvedEmptyStateMessage: string
  resolvedFetchErrorMessage: string | undefined
  isMobile: boolean
  bodyRowModels: DataTableBodyRowModel<TData>[]
  bodyRowCount: number
  density: DataTableDensity
  pageSizeOptions: readonly number[]
  bulkActions?: (selectedRows: TData[]) => ReactNode
  emptyState?: DataTableEmptyState
  onRetry?: () => void
  openRowContextMenu: (row: TData, x: number, y: number) => boolean
  contextMenu: ReactNode
}

export function DataTableSurfaceMain<TData extends object>({
  table,
  data,
  rowBehaviour,
  presentation,
  isLoading,
  hasUsableData,
  isError,
  resolvedEmptyStateMessage,
  resolvedFetchErrorMessage,
  isMobile,
  bodyRowModels,
  bodyRowCount,
  density,
  pageSizeOptions,
  bulkActions,
  emptyState,
  onRetry,
  openRowContextMenu,
  contextMenu,
}: DataTableSurfaceMainProps<TData>) {
  const showFetchError = shouldShowDataTableFetchError(
    resolvedFetchErrorMessage,
    onRetry,
    presentation,
    isError,
  )
  const useMobileList = shouldUseMobileDataTableList(
    isMobile,
    isLoading,
    presentation.isStalePreview,
    bodyRowCount,
  )

  return (
    <>
      <DataTableStaleStatus visible={presentation.isStalePreview} />
      {showFetchError && resolvedFetchErrorMessage && onRetry ? (
        <DataTableFetchError message={resolvedFetchErrorMessage} onRetry={onRetry} />
      ) : null}
      {useMobileList ? (
        <DataTableList
          columns={table.getVisibleLeafColumns()}
          rows={bodyRowModels}
          rowBehaviour={rowBehaviour}
          interactionLocked={presentation.isStalePreview}
        />
      ) : (
        <DataTableGrid
          table={table}
          data={data}
          rowBehaviour={rowBehaviour}
          showSkeleton={presentation.showFirstLoadSkeleton}
          ariaBusy={presentation.ariaBusy}
          isStalePreview={presentation.isStalePreview}
          suppressEmptyState={isLoading && !hasUsableData}
          density={density}
          hideHeader={isMobile}
          openRowContextMenu={openRowContextMenu}
          emptyStateMessage={resolvedEmptyStateMessage}
          emptyState={emptyState}
        />
      )}
      <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />
      <DataTableSelectionBar
        table={table}
        bulkActions={bulkActions}
        disabled={presentation.isStalePreview}
      />
      {contextMenu}
    </>
  )
}
