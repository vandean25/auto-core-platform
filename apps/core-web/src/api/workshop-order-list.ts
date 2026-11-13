import { useMemo } from 'react'

import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { useCursorList } from './cursor-list'
import { useOffsetLatchPage } from './cursor-recovery'
import { resolveListSearch } from './data-table-query'
import { scopedOffsetTableProps, useOffsetScopeGate } from './offset-scope-gate'
import type { WorkshopOrder } from './types'
import {
  normalizeOrder,
  useWorkshopOrders,
  WORKSHOP_ORDER_SEARCH_FILTER_FIELDS,
  workshopKeys,
  type RawWorkshopOrder,
} from './workshop'

/**
 * The opened-at column ("openedAt") and `createdAt` sort by `createdAt`, the only cursor sort of the order API
 * (ADR-0035 §3). Order number, status, customer and vehicle keep offset pages.
 */
const CURSOR_SORT_FIELDS: Record<string, string> = { openedAt: 'createdAt', createdAt: 'createdAt' }

/** Stable empty rows: a fresh array per render would make the retained-rows hook of the page re-render forever. */
const NO_ORDERS: WorkshopOrder[] = []

function isWorkshopOrderCursorSort(sortField?: string): boolean {
  return sortField === undefined || Object.hasOwn(CURSOR_SORT_FIELDS, sortField)
}

/** Search and customer filter exactly as the offset request sends them; `page` / `pageSize` never reach the cursor API. */
function workshopOrderListFilters(queryParams: DataTableQueryParams) {
  return {
    search: resolveListSearch(queryParams, WORKSHOP_ORDER_SEARCH_FILTER_FIELDS),
    customerId: queryParams.filters.find((filter) => filter.field === 'customer_id')?.value,
  }
}

function workshopOrderEpisodeKey(queryParams: DataTableQueryParams) {
  const filters = workshopOrderListFilters(queryParams)
  return JSON.stringify({
    search: filters.search ?? '',
    customerId: filters.customerId ?? '',
    sortField: queryParams.sortField ?? '',
    sortDirection: queryParams.sortDirection ?? '',
  })
}

function useWorkshopOrderCursorList(queryParams: DataTableQueryParams, enabled: boolean) {
  const filters = workshopOrderListFilters(queryParams)
  const sortField = queryParams.sortField ? CURSOR_SORT_FIELDS[queryParams.sortField] : undefined
  const params = { ...filters, sortField, sortDirection: queryParams.sortDirection }
  const cursorList = useCursorList<RawWorkshopOrder>({
    enabled,
    path: '/api/workshop/orders',
    countPath: '/api/workshop/orders/capped-count',
    semanticEpisodeKey: workshopOrderEpisodeKey(queryParams),
    listKey: workshopKeys.orderCursorList(params),
    countKey: workshopKeys.orderCappedCount(filters),
    params,
    countParams: filters,
  })
  const rows = useMemo(() => cursorList.rows.map(normalizeOrder), [cursorList.rows])
  return { ...cursorList, rows }
}

/**
 * Rows and `<DataTable>` props of the workshop order list: no sort or the opened-at sort scrolls without pages
 * (blocks of 50, cap 2,000 rows, "1.000+" only when the count is capped); every other sort, and the unsupported-sort
 * latch, keeps offset pages. Only the query of the active mode runs. `orders` stays undefined until the offset list
 * has loaded.
 */
export function useWorkshopOrderListState(queryParams: DataTableQueryParams) {
  const sortEligible = isWorkshopOrderCursorSort(queryParams.sortField)
  const cursorList = useWorkshopOrderCursorList(queryParams, sortEligible)
  const offsetLatched = cursorList.tableProps.scopeOffsetLatch === true
  const infiniteMode = sortEligible && !offsetLatched
  const episodeKey = workshopOrderEpisodeKey(queryParams)
  const offset = useOffsetLatchPage(episodeKey, offsetLatched, queryParams.page)
  const scope = useOffsetScopeGate(workshopKeys.orders())
  const offsetList = useWorkshopOrders(
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
      orders: cursorList.rows,
      isError: cursorList.tableProps.isError,
      dataUpdatedAt: cursorList.dataUpdatedAt,
      tableProps: cursorList.tableProps,
    }
  }
  return {
    orders: scope.hidden ? NO_ORDERS : offsetList.data?.data,
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
