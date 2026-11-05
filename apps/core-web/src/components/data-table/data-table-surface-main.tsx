import type { LegacyReactTable as LegacyTable } from '@tanstack/react-table/legacy'
import type { ReactNode } from 'react'

import type { DataTableDensity } from '@/lib/density-tokens'
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
import { DataTableGrid } from './data-table-grid'
import { DataTableList } from './data-table-list'
import { DataTablePagination } from './data-table-pagination'
import { DataTableSelectionBar } from './data-table-selection'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'

type DataTableSurfaceBodyProps<TData extends object> = {
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
  emptyState?: DataTableEmptyState
  onRetry?: () => void
  openRowContextMenu: (row: TData, x: number, y: number) => boolean
}

export function DataTableSurfaceBody<TData extends object>(props: DataTableSurfaceBodyProps<TData>) {
  const {
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
    emptyState,
    onRetry,
    openRowContextMenu,
  } = props

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
    </>
  )
}

type DataTableSurfaceMainProps<TData extends object> = DataTableSurfaceBodyProps<TData> & {
  pageSizeOptions: readonly number[]
  bulkActions?: (selectedRows: TData[]) => ReactNode
  contextMenu: ReactNode
}

export function DataTableSurfaceMain<TData extends object>({
  pageSizeOptions,
  bulkActions,
  contextMenu,
  presentation,
  table,
  ...bodyProps
}: DataTableSurfaceMainProps<TData>) {
  return (
    <>
      <DataTableSurfaceBody table={table} presentation={presentation} {...bodyProps} />
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
