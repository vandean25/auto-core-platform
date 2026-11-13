import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { inventoryKeys, isInventoryCursorSort, useInventory, useInventoryCursorList } from './inventory'
import { useOffsetLatchPage } from './cursor-recovery'
import { scopedOffsetTableProps, useOffsetScopeGate } from './offset-scope-gate'

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
  const scope = useOffsetScopeGate([...inventoryKeys.all, 'list'])
  const offsetList = useInventory(
    { page: offset.page, pageSize: queryParams.pageSize, ...listParams },
    {
      enabled: !infiniteMode && scope.enabled,
      offsetEpisodeKey: episodeKey,
      fresh: offset.handoffPending,
      scopeDigest: scope.digest,
    },
  )
  if (infiniteMode) {
    return { rows: cursorList.rows, dataUpdatedAt: cursorList.dataUpdatedAt, tableProps: cursorList.tableProps }
  }
  return {
    rows: scope.hidden ? [] : (offsetList.data?.data ?? []),
    dataUpdatedAt: offsetList.dataUpdatedAt,
    tableProps: scopedOffsetTableProps(offsetList, scope, offsetList.data?.meta.pageCount ?? 1),
  }
}
