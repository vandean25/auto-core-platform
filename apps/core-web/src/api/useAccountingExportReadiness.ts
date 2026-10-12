import { useQuery } from '@tanstack/react-query'
import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from './client'
import {
  accountingExportKeys,
  parseApiError,
  type AccountingExportReadinessParams,
} from './useAccountingExports'

const ACCOUNTING_EXPORT_READINESS_API = '/api/finance/accounting-export-readiness'

export type AccountingExportReadinessResponse =
  components['schemas']['AccountingExportReadinessResponseDto']
export type AccountingExportReadinessDocument =
  components['schemas']['AccountingExportReadinessDocumentDto']
export type AccountingExportBlockerCode =
  components['schemas']['AccountingExportReadinessReasonDto']['code']
export type AccountingExportDocumentKind =
  components['schemas']['AccountingExportReadinessDocumentKindDto']['kind']

export function buildAccountingExportReadinessQuery(
  params: AccountingExportReadinessParams,
): string {
  const searchParams = new URLSearchParams({
    legalEntityId: params.legalEntityId,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  })
  if (params.reason) searchParams.set('reason', params.reason)
  if (params.documentKind) searchParams.set('documentKind', params.documentKind)
  if (params.search) searchParams.set('search', params.search)
  if (params.page) searchParams.set('page', String(params.page))
  if (params.limit) searchParams.set('limit', String(params.limit))
  return searchParams.toString()
}

export function useAccountingExportReadiness(
  params: AccountingExportReadinessParams | null,
) {
  const queryParams: AccountingExportReadinessParams = params ?? {
    legalEntityId: '',
    dateFrom: '',
    dateTo: '',
  }

  return useQuery<AccountingExportReadinessResponse>({
    queryKey: accountingExportKeys.readiness(queryParams),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `${ACCOUNTING_EXPORT_READINESS_API}?${buildAccountingExportReadinessQuery(queryParams)}`,
      )
      if (!response.ok) {
        await parseApiError(response, 'Failed to load export readiness')
      }
      return response.json() as Promise<AccountingExportReadinessResponse>
    },
    enabled: Boolean(params?.legalEntityId && params.dateFrom && params.dateTo),
  })
}
