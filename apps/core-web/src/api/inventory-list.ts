import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { offsetListTableProps } from '@/components/data-table/offset-list-table-props'
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
  if (infiniteMode) {
    return { rows: cursorList.rows, dataUpdatedAt: cursorList.dataUpdatedAt, tableProps: cursorList.tableProps }
  }
  return {
    rows: offsetList.data?.data ?? [],
    dataUpdatedAt: offsetList.dataUpdatedAt,
    tableProps: offsetListTableProps(offsetList),
  }
}
