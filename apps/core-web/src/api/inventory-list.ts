import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { isInventoryCursorSort, useInventory, useInventoryCursorList } from './inventory'
import { useOffsetLatchPage } from './cursor-recovery'

function inventoryOffsetEpisodeKey(listParams: {
  search?: string
  location?: string
  sortField?: string
  sortDirection?: string
}) {
  return JSON.stringify({
    search: listParams.search ?? '',
    location: listParams.location ?? '',
    sortField: listParams.sortField ?? '',
    sortDirection: listParams.sortDirection ?? '',
  })
}

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
  const episodeKey = inventoryOffsetEpisodeKey(listParams)
  const offset = useOffsetLatchPage(episodeKey, offsetLatched, queryParams.page)
  const offsetList = useInventory(
    { page: offset.page, pageSize: queryParams.pageSize, ...listParams },
    { enabled: !infiniteMode, offsetEpisodeKey: episodeKey, fresh: offset.handoffPending },
  )
  if (infiniteMode) {
    return { rows: cursorList.rows, dataUpdatedAt: cursorList.dataUpdatedAt, tableProps: cursorList.tableProps }
  }
  return {
    rows: offsetList.data?.data ?? [],
    dataUpdatedAt: offsetList.dataUpdatedAt,
    tableProps: {
      pageCount: offsetList.data?.meta.pageCount ?? 1,
      isLoading: offsetList.isLoading,
      isError: offsetList.isError,
      onRetry: () => void offsetList.refetch(),
    },
  }
}
