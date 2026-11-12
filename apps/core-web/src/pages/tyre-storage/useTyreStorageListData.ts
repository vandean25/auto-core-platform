import { useMemo } from 'react'

import { useLocations } from '@/api/locations'
import { useDueTyreSets, useTyreSets } from '@/api/tyre-storage'
import {
  buildTyreSetListParams,
  filterCustomerStorageLocations,
  resolveTyreStorageListLoading,
  resolveTyreStorageListRows,
  resolveTyreStoragePageCount,
  tyreStoragePageSizeOptions,
  type TyreStorageListFilterState,
} from '@/features/tyre-storage/tyre-storage-list-model'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import type { TyreStorageListViewMode } from '@/features/tyre-storage/tyre-storage-list-constants'

type ListDataInput = TyreStorageListFilterState & {
  viewMode: TyreStorageListViewMode
}

export function useTyreStorageListData(filters: ListDataInput, queryParams: DataTableQueryParams) {
  const listParams = useMemo(
    () => buildTyreSetListParams(filters, queryParams),
    [
      filters.customerId,
      filters.dueFrom,
      filters.dueTo,
      filters.locationId,
      filters.search,
      filters.season,
      filters.status,
      queryParams.page,
      queryParams.pageSize,
    ],
  )

  const { data: locations } = useLocations()
  const { data: listData, isLoading: listLoading } = useTyreSets(listParams)
  const { data: dueData, isLoading: dueLoading } = useDueTyreSets()

  const storageLocations = useMemo(
    () => filterCustomerStorageLocations(locations ?? []),
    [locations],
  )
  const rows = resolveTyreStorageListRows(filters.viewMode, listData, dueData)
  const isLoading = resolveTyreStorageListLoading(filters.viewMode, listLoading, dueLoading)
  const pageCount = resolveTyreStoragePageCount(filters.viewMode, listData)
  const pageSizeOptions = tyreStoragePageSizeOptions(filters.viewMode)

  return {
    storageLocations,
    rows,
    isLoading,
    pageCount,
    pageSizeOptions,
    dueCount: dueData?.data.length ?? 0,
  }
}
