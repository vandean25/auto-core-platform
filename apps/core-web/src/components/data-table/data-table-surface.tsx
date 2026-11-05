import { DataTableSurfaceMain } from './data-table-surface-main'
import { DataTableDensityContext } from './data-table-density-toggle'
import { DataTableRefreshIndicator } from './data-table-states'
import { DataTableToolbar } from './data-table-toolbar'
import type { DataTableViewModel } from './use-data-table-view-model'
import type { DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import type { DataTableEmptyState } from './data-table-states'

type DataTableSurfaceExtras = {
  searchColumn?: string
  searchPlaceholder?: string
  saveViewTitle?: string
  dashboardSource?: DashboardWidgetTableSource
  enableCsvExport?: boolean
  csvFileName?: string
  emptyState?: DataTableEmptyState
  onRetry?: () => void
}

export type DataTableSurfaceProps<TData extends object> = DataTableViewModel<TData> & DataTableSurfaceExtras

export function DataTableSurface<TData extends object>({
  searchColumn,
  searchPlaceholder,
  saveViewTitle,
  dashboardSource,
  enableCsvExport,
  csvFileName,
  emptyState,
  onRetry,
  ...mainProps
}: DataTableSurfaceProps<TData>) {
  const { table, presentation, rootRef } = mainProps

  return (
    <div className="space-y-4" ref={rootRef}>
      <DataTableDensityContext.Provider value={{ density: mainProps.density, setDensity: mainProps.setDensity }}>
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
      <DataTableSurfaceMain {...mainProps} emptyState={emptyState} onRetry={onRetry} />
    </div>
  )
}
