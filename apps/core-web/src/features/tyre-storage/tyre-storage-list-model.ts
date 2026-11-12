import type { StorageLocation } from '@/api/locations'
import type { TyreSet, TyreSetListResponse } from '@/api/tyre-storage'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'

import { TYRE_STORAGE_FILTER_ALL, type TyreStorageListViewMode } from './tyre-storage-list-constants'

export type TyreStorageListFilterState = {
  search: string
  season: string
  status: string
  locationId: string
  customerId?: string
  dueFrom: string
  dueTo: string
}

export type TyreSetListQueryParams = {
  search?: string
  season?: string
  status?: string
  locationId?: string
  customerId?: string
  dueFrom?: string
  dueTo?: string
  pageSize?: number
  page?: number
}

function optionalFilter(value: string): string | undefined {
  return value === TYRE_STORAGE_FILTER_ALL ? undefined : value
}

/** Maps filter UI state and table pagination into the tyre-sets list API params. */
export function buildTyreSetListParams(
  filters: TyreStorageListFilterState,
  queryParams: Pick<DataTableQueryParams, 'page' | 'pageSize'>,
): TyreSetListQueryParams {
  return {
    search: filters.search || undefined,
    season: optionalFilter(filters.season),
    status: optionalFilter(filters.status),
    locationId: optionalFilter(filters.locationId),
    customerId: filters.customerId,
    dueFrom: filters.dueFrom || undefined,
    dueTo: filters.dueTo || undefined,
    pageSize: queryParams.pageSize,
    page: queryParams.page,
  }
}

export function filterCustomerStorageLocations(locations: StorageLocation[]): StorageLocation[] {
  return locations.filter((loc) => loc.type === 'customer_storage')
}

export function resolveTyreStorageListRows(
  viewMode: TyreStorageListViewMode,
  listData: TyreSetListResponse | undefined,
  dueData: { data: TyreSet[] } | undefined,
): TyreSet[] {
  return viewMode === 'due' ? (dueData?.data ?? []) : (listData?.data ?? [])
}

export function resolveTyreStorageListLoading(
  viewMode: TyreStorageListViewMode,
  listLoading: boolean,
  dueLoading: boolean,
): boolean {
  return viewMode === 'due' ? dueLoading : listLoading
}

export function resolveTyreStoragePageCount(
  viewMode: TyreStorageListViewMode,
  listData: TyreSetListResponse | undefined,
): number | undefined {
  return viewMode === 'due' ? 1 : listData?.meta?.pageCount
}

export function tyreStoragePageSizeOptions(viewMode: TyreStorageListViewMode): number[] | undefined {
  return viewMode === 'due' ? [] : undefined
}

export function filtersLockedForDueView(viewMode: TyreStorageListViewMode): boolean {
  return viewMode === 'due'
}
