import type { DataTableRowContextAction } from './data-table-context-menu'

/** Row interaction bundle for {@link DataTable} (click, prefetch, detail link, context menu). */
export type DataTableRowBehaviour<TData extends object> = {
  onRowClick?: (row: TData) => void
  /** Prefetch row detail on pointer enter or keyboard focus (not touch scroll). */
  onRowPrefetch?: (row: TData) => void
  getRowHref?: (row: TData) => string | undefined
  getRowAccessibleName?: (row: TData) => string
  getRowContextActions?: (row: TData) => DataTableRowContextAction<TData>[]
}
