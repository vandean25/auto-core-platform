import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { useCursorList } from './cursor-list'
import { useOffsetLatchPage } from './cursor-recovery'
import { resolveListSearch } from './data-table-query'
import { scopedOffsetTableProps, useOffsetScopeGate } from './offset-scope-gate'
import { useVehicles, vehicleKeys, type VehicleListApiRow } from './vehicles'

const CURSOR_SORT_FIELDS: Record<string, string> = { createdAt: 'createdAt' }
const VEHICLE_SEARCH_FILTER_FIELDS = ['make', 'model', 'vin', 'plate']

const NO_VEHICLES: VehicleListApiRow[] = []

function isVehicleCursorSort(sortField?: string): boolean {
  return sortField === undefined || Object.hasOwn(CURSOR_SORT_FIELDS, sortField)
}

function vehicleListFilters(queryParams: DataTableQueryParams) {
  return {
    search: resolveListSearch(queryParams, VEHICLE_SEARCH_FILTER_FIELDS),
  }
}

function vehicleEpisodeKey(queryParams: DataTableQueryParams) {
  const filters = vehicleListFilters(queryParams)
  return JSON.stringify({
    search: filters.search ?? '',
    sortField: queryParams.sortField ?? '',
    sortDirection: queryParams.sortDirection ?? '',
  })
}

function useVehicleCursorList(queryParams: DataTableQueryParams, enabled: boolean) {
  const filters = vehicleListFilters(queryParams)
  const sortField = queryParams.sortField ? CURSOR_SORT_FIELDS[queryParams.sortField] : undefined
  const params = { ...filters, sortField, sortDirection: queryParams.sortDirection }
  return useCursorList<VehicleListApiRow>({
    enabled,
    path: '/api/vehicles',
    countPath: '/api/vehicles/capped-count',
    semanticEpisodeKey: vehicleEpisodeKey(queryParams),
    listKey: vehicleKeys.cursorList(params),
    countKey: vehicleKeys.cappedCount(filters),
    params,
    countParams: filters,
  })
}

/**
 * Rows and `<DataTable>` props of the customer vehicle list: no sort or `createdAt` scrolls without pages
 * (blocks of 50, cap 2,000 rows, "1.000+" only when the count is capped); every other sort, and the
 * unsupported-sort latch, keeps offset pages.
 */
export function useVehicleListState(queryParams: DataTableQueryParams) {
  const sortEligible = isVehicleCursorSort(queryParams.sortField)
  const cursorList = useVehicleCursorList(queryParams, sortEligible)
  const offsetLatched = cursorList.tableProps.scopeOffsetLatch === true
  const infiniteMode = sortEligible && !offsetLatched
  const episodeKey = vehicleEpisodeKey(queryParams)
  const offset = useOffsetLatchPage(episodeKey, offsetLatched, queryParams.page)
  const scope = useOffsetScopeGate(vehicleKeys.lists())
  const offsetList = useVehicles(
    { ...queryParams, page: offset.page },
    {
      enabled: !infiniteMode && scope.enabled,
      offsetEpisodeKey: episodeKey,
      fresh: offset.handoffPending,
      scopeDigest: scope.digest,
    },
  )
  if (infiniteMode) {
    return {
      infinite: true,
      vehicles: cursorList.rows,
      isError: cursorList.tableProps.isError,
      dataUpdatedAt: cursorList.dataUpdatedAt,
      tableProps: cursorList.tableProps,
    }
  }
  return {
    infinite: false,
    vehicles: scope.hidden ? NO_VEHICLES : (offsetList.data?.data ?? NO_VEHICLES),
    isError: offsetList.isError,
    dataUpdatedAt: offsetList.dataUpdatedAt,
    tableProps: {
      ...scopedOffsetTableProps(offsetList, scope, offsetList.data?.meta?.pageCount ?? 1),
      isFetching: offsetList.isFetching,
      isPlaceholderData: offsetList.isPlaceholderData,
      hasUsableData: offsetList.data !== undefined,
    },
  }
}
