import type { TyreStorageListFilterState } from '@/features/tyre-storage/tyre-storage-list-model'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'

import { useTyreStorageListData } from './useTyreStorageListData'
import { useTyreStorageListFilterState } from './useTyreStorageListFilterState'

function toFilterState(
  state: ReturnType<typeof useTyreStorageListFilterState>,
): TyreStorageListFilterState & { viewMode: ReturnType<typeof useTyreStorageListFilterState>['viewMode'] } {
  return {
    search: state.search,
    season: state.season,
    status: state.status,
    locationId: state.locationId,
    customerId: state.customerFilter?.id,
    dueFrom: state.dueFrom,
    dueTo: state.dueTo,
    viewMode: state.viewMode,
  }
}

export function useTyreStorageListPage() {
  const filterState = useTyreStorageListFilterState()
  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 25 })
  const data = useTyreStorageListData(toFilterState(filterState), queryParams)

  return { ...filterState, ...data, tableState }
}
