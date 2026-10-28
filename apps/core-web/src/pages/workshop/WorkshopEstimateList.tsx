import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { DataTable } from '@/components/data-table/DataTable'
import { DataTablePaginationHidden } from '@/components/data-table/data-table-pagination'
import { PageHeader } from '@/components/layout/PageHeader'
import { WorkshopEstimateListFilters } from '@/components/workshop/WorkshopEstimateListFilters'
import { EstimateListLoadError, EstimateListLoadMore } from '@/components/workshop/WorkshopEstimateListStatus'
import {
  parseEstimateListView,
  writeEstimateListView,
  type EstimateListView,
} from '@/features/workshop/workshop-estimate-list-filters'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { createEstimateListColumns } from './estimate-list-columns'
import { useEstimateListData } from './useEstimateListData'
import { useEstimateListRowBehaviour } from './useEstimateListRowBehaviour'

export default function WorkshopEstimateList() {
  const { t } = useTranslation('workshop')
  const [searchParams, setSearchParams] = useSearchParams()
  const view = useMemo(() => parseEstimateListView(searchParams), [searchParams])
  const updateView = useCallback(
    (patch: Partial<EstimateListView>) =>
      setSearchParams((prev) => writeEstimateListView(prev, { ...parseEstimateListView(prev), ...patch }), {
        replace: true,
      }),
    [setSearchParams],
  )

  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 25 })
  const { query, rows } = useEstimateListData(view, queryParams)
  const rowBehaviour = useEstimateListRowBehaviour(rows)
  const columns = useMemo(() => createEstimateListColumns(t), [t])
  // Search and sort only see the loaded pages, which matters while there are more.
  const isPartialView = Boolean(queryParams.search || queryParams.sortField)

  return (
    <>
      <PageHeader title={t('estimateList.title')} description={t('estimateList.description')} />
      <div className="space-y-4">
        <WorkshopEstimateListFilters view={view} onChange={updateView} />
        {query.isError ? <EstimateListLoadError error={query.error} /> : null}
        <DataTablePaginationHidden>
          <DataTable
            columns={columns}
            data={rows}
            isLoading={query.isLoading}
            enableCsvExport={false}
            searchPlaceholder={t('estimateList.searchPlaceholder')}
            emptyState={query.isError ? undefined : { message: t('estimateList.empty') }}
            rowBehaviour={rowBehaviour}
            {...tableState}
          />
        </DataTablePaginationHidden>
        {query.hasNextPage ? (
          <EstimateListLoadMore
            isLoading={query.isFetchingNextPage}
            isPartialView={isPartialView}
            onLoadMore={() => void query.fetchNextPage()}
          />
        ) : null}
      </div>
    </>
  )
}
