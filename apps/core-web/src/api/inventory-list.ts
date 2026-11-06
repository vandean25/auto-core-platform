import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { isInventoryCursorSort, useInventory, useInventoryCursorList } from './inventory'

/**
 * Rows and `<DataTable>` props of the parts list: cursor-supported sorts scroll without pages (cap 2,000 rows),
 * any other sort stays on offset paging. Only the query of the active mode runs.
 */
export function useInventoryListState(queryParams: DataTableQueryParams, filters: { search?: string; location?: string }) {
  const listParams = { ...filters, sortField: queryParams.sortField, sortDirection: queryParams.sortDirection }
  const infiniteMode = isInventoryCursorSort(queryParams.sortField)
  const offsetList = useInventory({ page: queryParams.page, pageSize: queryParams.pageSize, ...listParams }, { enabled: !infiniteMode })
  const cursorList = useInventoryCursorList(listParams, infiniteMode)
  if (infiniteMode) return cursorList
  return {
    rows: offsetList.data?.data ?? [],
    tableProps: { pageCount: offsetList.data?.meta.pageCount ?? 1, isLoading: offsetList.isLoading },
  }
}
