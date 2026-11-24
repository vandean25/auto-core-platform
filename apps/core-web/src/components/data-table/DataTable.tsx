import { useInRouterContext } from 'react-router-dom'
import { useDataTableUrl, type DataTableUrl } from '@/hooks/use-data-table-url'
import { DataTableSurface } from './data-table-surface'
import type { DataTableCoreProps } from './data-table-props'
import { useDataTableViewModel } from './use-data-table-view-model'

export type DataTableProps<TData extends object> = DataTableCoreProps<TData>

export function DataTable<TData extends object>(props: DataTableProps<TData>) {
  const inRouter = useInRouterContext()
  return inRouter ? <RoutedDataTable {...props} /> : <DataTableContent props={props} />
}

function RoutedDataTable<TData extends object>(props: DataTableProps<TData>) {
  const url = useDataTableUrl()
  return <DataTableContent props={props} url={url} />
}

function DataTableContent<TData extends object>({ props, url }: { props: DataTableProps<TData>; url?: DataTableUrl }) {
  const viewModel = useDataTableViewModel(props, url)
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
      onScopeRefresh={props.onScopeRefresh}
    />
  )
}
