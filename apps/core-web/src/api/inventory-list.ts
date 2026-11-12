import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { isInventoryCursorSort, useInventory, useInventoryCursorList } from './inventory'

/**
 * Rows and `<DataTable>` props of the parts list: cursor-supported sorts scroll without pages (cap 2,000 rows),
 * any other sort stays on offset paging. Only the query of the active mode runs.
 */
export function useInventoryListState(queryParams: DataTableQueryParams, filters: { search?: string; location?: string }) {
  const listParams = { ...filters, sortField: queryParams.sortField, sortDirection: queryParams.sortDirection }
  const sortEligible = isInventoryCursorSort(queryParams.sortField)
  const cursorList = useInventoryCursorList(listParams, sortEligible)
  const offsetLatched = cursorList.tableProps.scopeOffsetLatch === true
  const infiniteMode = sortEligible && !offsetLatched
  const offsetList = useInventory(
    { page: offsetLatched ? 1 : queryParams.page, pageSize: queryParams.pageSize, ...listParams },
    { enabled: !infiniteMode },
  )
  if (infiniteMode) {
    return { rows: cursorList.rows, dataUpdatedAt: cursorList.dataUpdatedAt, tableProps: cursorList.tableProps }
  }
  return {
    rows: offsetList.data?.data ?? [],
    dataUpdatedAt: offsetList.dataUpdatedAt,
    tableProps: { pageCount: offsetList.data?.meta.pageCount ?? 1, isLoading: offsetList.isLoading },
  }
}
