import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { isVehicleStockCursorMode, useVehicleStock, useVehicleStockCursorList } from './vehicle-stock'

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
  const offsetList = useVehicleStock(
    { ...queryParams, page: offsetLatched ? 1 : queryParams.page },
    { enabled: !infiniteMode },
  )
  if (infiniteMode) return cursorList
  return {
    rows: offsetList.data?.data ?? [],
    tableProps: { pageCount: offsetList.data?.meta?.pageCount ?? 1, isLoading: offsetList.isLoading },
  }
}
