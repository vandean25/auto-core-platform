import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { useCursorList } from './cursor-list'
import { useOffsetLatchPage } from './cursor-recovery'
import { customerKeys, useCustomers } from './customers'
import { scopedOffsetTableProps, useOffsetScopeGate } from './offset-scope-gate'
import type { Customer } from './types'

const CURSOR_SORT_FIELDS: Record<string, string> = { createdAt: 'createdAt' }

const NO_CUSTOMERS: Customer[] = []

function isCustomerCursorSort(sortField?: string): boolean {
  return sortField === undefined || Object.hasOwn(CURSOR_SORT_FIELDS, sortField)
}

function customerListFilters(queryParams: DataTableQueryParams) {
  return {
    search: queryParams.search || undefined,
    type: queryParams.filters.find((filter) => filter.field === 'type')?.value,
  }
}

function customerEpisodeKey(queryParams: DataTableQueryParams) {
  const filters = customerListFilters(queryParams)
  return JSON.stringify({
    search: filters.search ?? '',
    type: filters.type ?? '',
    sortField: queryParams.sortField ?? '',
    sortDirection: queryParams.sortDirection ?? '',
  })
}

function useCustomerCursorList(queryParams: DataTableQueryParams, enabled: boolean) {
  const filters = customerListFilters(queryParams)
  const sortField = queryParams.sortField ? CURSOR_SORT_FIELDS[queryParams.sortField] : undefined
  const params = { ...filters, sortField, sortDirection: queryParams.sortDirection }
  return useCursorList<Customer>({
    enabled,
    path: '/api/customers',
    countPath: '/api/customers/capped-count',
    semanticEpisodeKey: customerEpisodeKey(queryParams),
    listKey: customerKeys.cursorList(params),
    countKey: customerKeys.cappedCount(filters),
    params,
    countParams: filters,
  })
}

/**
 * Rows and `<DataTable>` props of the customer list: no sort or `createdAt` scrolls without pages
 * (blocks of 50, cap 2,000 rows, "1.000+" only when the count is capped); every other sort, and the
 * unsupported-sort latch, keeps offset pages.
 */
export function useCustomerListState(queryParams: DataTableQueryParams) {
  const sortEligible = isCustomerCursorSort(queryParams.sortField)
  const cursorList = useCustomerCursorList(queryParams, sortEligible)
  const offsetLatched = cursorList.tableProps.scopeOffsetLatch === true
  const infiniteMode = sortEligible && !offsetLatched
  const episodeKey = customerEpisodeKey(queryParams)
  const offset = useOffsetLatchPage(episodeKey, offsetLatched, queryParams.page)
  const scope = useOffsetScopeGate(customerKeys.lists())
  const offsetList = useCustomers(
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
      customers: cursorList.rows,
      isError: cursorList.tableProps.isError,
      dataUpdatedAt: cursorList.dataUpdatedAt,
      tableProps: cursorList.tableProps,
    }
  }
  const responseData = offsetList.data
  const customers: Customer[] = scope.hidden
    ? NO_CUSTOMERS
    : Array.isArray(responseData)
      ? responseData
      : (responseData?.data ?? NO_CUSTOMERS)
  const pageCount = Array.isArray(responseData) ? 1 : (responseData?.meta?.pageCount ?? 1)
  return {
    infinite: false,
    customers,
    isError: offsetList.isError,
    dataUpdatedAt: offsetList.dataUpdatedAt,
    tableProps: {
      ...scopedOffsetTableProps(offsetList, scope, pageCount),
      isFetching: offsetList.isFetching,
      isPlaceholderData: offsetList.isPlaceholderData,
      hasUsableData: responseData !== undefined,
    },
  }
}
