import { DataTableSurface } from './data-table-surface'
import type { DataTableCoreProps } from './data-table-props'
import { useDataTableViewModel } from './use-data-table-view-model'

export type DataTableProps<TData extends object> = DataTableCoreProps<TData>

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
