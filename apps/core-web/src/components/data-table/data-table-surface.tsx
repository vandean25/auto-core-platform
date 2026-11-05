import type { DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import { DataTableDensityContext } from './data-table-density-toggle'
import { DataTableGrid } from './data-table-grid'
import { DataTableList } from './data-table-list'
import {
  DataTableFetchError,
  DataTableRefreshIndicator,
  DataTableStaleStatus,
  type DataTableEmptyState,
} from './data-table-states'
import { DataTablePagination } from './data-table-pagination'
import { DataTableSelectionBar } from './data-table-selection'
import { DataTableToolbar } from './data-table-toolbar'
import type { DataTableViewModel } from './use-data-table-view-model'

type DataTableSurfaceProps<TData extends object> = DataTableViewModel<TData> & {
  searchColumn?: string
  searchPlaceholder?: string
  saveViewTitle?: string
  dashboardSource?: DashboardWidgetTableSource
  enableCsvExport?: boolean
  csvFileName?: string
  emptyState?: DataTableEmptyState
  onRetry?: () => void
}

export function DataTableSurface<TData extends object>({
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
  bodyRowCount,
  pageSizeOptions,
  bulkActions,
  searchColumn,
  searchPlaceholder,
  saveViewTitle,
  dashboardSource,
  enableCsvExport,
  csvFileName,
  emptyState,
  onRetry,
}: DataTableSurfaceProps<TData>) {
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
          isLoading={presentation.showFirstLoadSkeleton}
          refreshIndicator={<DataTableRefreshIndicator visible={presentation.showRefreshIndicator} />}
        />
      </DataTableDensityContext.Provider>
      <DataTableStaleStatus visible={presentation.isStalePreview} />
      {resolvedFetchErrorMessage && onRetry && (presentation.staleFetchFailed || (isError && !presentation.showFirstLoadSkeleton)) ? (
        <DataTableFetchError message={resolvedFetchErrorMessage} onRetry={onRetry} />
      ) : null}
      {isMobile && !isLoading && !presentation.isStalePreview && bodyRowCount ? (
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
      <DataTableSelectionBar table={table} bulkActions={bulkActions} disabled={presentation.isStalePreview} />
      {contextMenu}
    </div>
  )
}
