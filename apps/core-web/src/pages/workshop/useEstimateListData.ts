import { useMemo } from 'react'

import { useWorkshopEstimateList } from '@/api/workshop-estimates'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { toEstimateListRow, type EstimateListRow } from '@/features/actions/estimate-row-actions'
import { estimateVersionStatusLabel } from '@/features/workshop/workshop-estimate-decision'
import { toEstimateApiFilters, type EstimateListView } from '@/features/workshop/workshop-estimate-list-filters'
import { filterEstimateRows, sortEstimateRows } from '@/features/workshop/workshop-estimate-list-rows'

/** The loaded pages of the estimates list, searched and sorted in the browser (the API has no search or sort). */
export function useEstimateListData(view: EstimateListView, queryParams: DataTableQueryParams) {
  const query = useWorkshopEstimateList(toEstimateApiFilters(view))
  const { search, sortField, sortDirection } = queryParams

  const loaded = useMemo(() => (query.data?.pages ?? []).flatMap((page) => page.data), [query.data])
  const rows = useMemo<EstimateListRow[]>(
    () =>
      sortEstimateRows(filterEstimateRows(loaded, search, estimateVersionStatusLabel), sortField, sortDirection).map(
        toEstimateListRow,
      ),
    [loaded, search, sortDirection, sortField],
  )
  return { query, rows }
}
