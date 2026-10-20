import * as React from 'react'

import {
  IMPORT_ROWS_PAGE_LIMIT,
  useImportJobRows,
  type ImportJob,
  type ImportJobRow,
  type ImportJobRowsMeta,
} from '@/api/imports'

import { isRowPriceJump } from './import-price-jump'
import { importRowQueryFromFilter, type ImportRowFilter } from './import-wizard-logic'

export type ImportRowsState = {
  jobRows: ImportJobRow[]
  isLoadingRows: boolean
  rowsMeta: ImportJobRowsMeta | undefined
  rowsTotalPages: number
  flaggedJumpCount: number
}

/** Loads the rows of a dry-run job for the selected filter and page. */
export function useImportRows(params: {
  jobId: string | null
  rowFilter: ImportRowFilter
  rowsPage: number
  dryRunJob: ImportJob | null
}): ImportRowsState {
  const rowQuery = importRowQueryFromFilter(params.rowFilter)
  const { data: rowsResponse, isLoading } = useImportJobRows(params.jobId, {
    page: params.rowsPage,
    limit: IMPORT_ROWS_PAGE_LIMIT,
    action: rowQuery.action,
    hasErrors: rowQuery.hasErrors,
  })

  const jobRows = React.useMemo(() => rowsResponse?.data ?? [], [rowsResponse?.data])
  const rowsMeta = rowsResponse?.meta
  const rowsTotalPages = rowsMeta ? Math.max(1, Math.ceil(rowsMeta.total / rowsMeta.limit)) : 1
  const flaggedJumpCount = React.useMemo(() => {
    const jobTotalFlagged = (params.dryRunJob?.totals as { flagged_jumps?: number } | undefined)
      ?.flagged_jumps
    if (typeof jobTotalFlagged === 'number') {
      return jobTotalFlagged
    }
    return jobRows.filter(isRowPriceJump).length
  }, [params.dryRunJob?.totals, jobRows])

  return { jobRows, isLoadingRows: isLoading, rowsMeta, rowsTotalPages, flaggedJumpCount }
}
