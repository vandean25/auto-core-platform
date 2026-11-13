import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { resolveListSearch } from './data-table-query'

import { useOffsetLatchPage } from './cursor-recovery'
import { scopedOffsetTableProps, useOffsetScopeGate } from './offset-scope-gate'
import {
  isVehicleStockCursorMode,
  useVehicleStock,
  useVehicleStockCursorList,
  VEHICLE_STOCK_SEARCH_FILTER_FIELDS,
  vehicleStockKeys,
} from './vehicle-stock'

function vehicleStockOffsetEpisodeKey(queryParams: DataTableQueryParams) {
  const filters = {
    search: resolveListSearch(queryParams, VEHICLE_STOCK_SEARCH_FILTER_FIELDS),
    stock_status: queryParams.filters.find((filter) => filter.field === 'stock_status')?.value,
  }
  return JSON.stringify({
    search: filters.search ?? '',
    stock_status: filters.stock_status ?? '',
    sortField: queryParams.sortField ?? '',
    sortDirection: queryParams.sortDirection ?? '',
  })
}

/**
 * Rows and `<DataTable>` props of the dealer stock list: a draft-free status with a cursor-supported sort scrolls
 * without pages (cap 2,000 rows); "all statuses" merges the draft purchases in, and every other sort, so both stay on
 * offset paging. Only the query of the active mode runs.
 */
export function useVehicleStockListState(queryParams: DataTableQueryParams) {
  const stockStatus = queryParams.filters.find((filter) => filter.field === 'stock_status')?.value
  const sortEligible = isVehicleStockCursorMode({ stockStatus, sortField: queryParams.sortField })
  const cursorList = useVehicleStockCursorList(queryParams, sortEligible)
  const offsetLatched = cursorList.tableProps.scopeOffsetLatch === true
  const infiniteMode = sortEligible && !offsetLatched
  const episodeKey = vehicleStockOffsetEpisodeKey(queryParams)
  const offset = useOffsetLatchPage(episodeKey, offsetLatched, queryParams.page)
  const scope = useOffsetScopeGate(vehicleStockKeys.lists())
  const offsetList = useVehicleStock(
    { ...queryParams, page: offset.page },
    {
      enabled: !infiniteMode && scope.enabled,
      offsetEpisodeKey: episodeKey,
      fresh: offset.handoffPending,
      scopeDigest: scope.digest,
    },
  )
  if (infiniteMode) return cursorList
  return {
    rows: scope.hidden ? [] : (offsetList.data?.data ?? []),
    tableProps: scopedOffsetTableProps(offsetList, scope, offsetList.data?.meta?.pageCount ?? 1),
  }
}
