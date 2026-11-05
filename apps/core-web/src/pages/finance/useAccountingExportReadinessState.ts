import { useState, type Dispatch, type SetStateAction } from 'react'
import {
  useAccountingExportReadiness,
  type AccountingExportBlockerCode,
  type AccountingExportDocumentKind,
  type AccountingExportReadinessSortField,
} from '@/api/useAccountingExportReadiness'
import { useLegalEntities } from '@/api/site-admin'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'

const SORT_FIELDS: readonly AccountingExportReadinessSortField[] = ['number', 'kind', 'date', 'site', 'status']

const toSortField = (value: string | undefined) => SORT_FIELDS.find((field) => field === value)

const MAX_SEARCH_LENGTH = 200
const MAX_PAGE_SIZE = 100

const formatIsoDate = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const previousMonthRange = (today: Date) => ({
  dateFrom: formatIsoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
  dateTo: formatIsoDate(new Date(today.getFullYear(), today.getMonth(), 0)),
})

const toSortDirection = (value: string | undefined) => (value === 'desc' || value === 'asc' ? value : undefined)

/** Filters, paging and the readiness query of the accounting export readiness page. */
export function useAccountingExportReadinessState() {
  const legalEntities = useLegalEntities().data ?? []
  const [selectedEntityId, setSelectedEntityId] = useState('')
  const legalEntityId =
    selectedEntityId || legalEntities.find((entity) => entity.is_active)?.id || legalEntities[0]?.id || ''

  const [period, setPeriod] = useState(() => previousMonthRange(new Date()))
  const [reason, setReason] = useState<AccountingExportBlockerCode | ''>('')
  const [documentKind, setDocumentKind] = useState<AccountingExportDocumentKind | ''>('')

  const { queryParams, setPagination, setGlobalFilter, ...tableState } = useDataTableQuery({
    defaultPageSize: 25,
    initialSorting: [{ id: 'date', desc: false }],
  })

  const resetToFirstPage = () =>
    setPagination((current) => (current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }))

  const changeSearch: Dispatch<SetStateAction<string>> = (value) => {
    setGlobalFilter(value)
    resetToFirstPage()
  }

  const readiness = useAccountingExportReadiness(
    legalEntityId
      ? {
          legalEntityId,
          dateFrom: period.dateFrom,
          dateTo: period.dateTo,
          reason: reason || undefined,
          documentKind: documentKind || undefined,
          search: (queryParams.search ?? '').slice(0, MAX_SEARCH_LENGTH) || undefined,
          sortField: toSortField(queryParams.sortField),
          sortDirection: toSortDirection(queryParams.sortDirection),
          page: Math.max(1, Math.trunc(queryParams.page)),
          limit: Math.min(Math.max(1, Math.trunc(queryParams.pageSize)), MAX_PAGE_SIZE),
        }
      : null,
  )

  return {
    legalEntities,
    legalEntityId,
    setSelectedEntityId,
    period,
    setPeriod,
    reason,
    setReason,
    documentKind,
    setDocumentKind,
    resetToFirstPage,
    changeSearch,
    setPagination,
    tableState,
    readiness,
  }
}
