import { useQuery } from '@tanstack/react-query'
import type { components, paths } from '@/api/generated/openapi'
import { createHttpError } from '@/lib/error-utils'
import { fetchWithAuth } from './client'
import { accountingExportKeys } from './useAccountingExports'

const ACCOUNTING_EXPORT_READINESS_API = '/api/finance/accounting-export-readiness'

type AccountingExportReadinessQuery = NonNullable<
  paths['/api/finance/accounting-export-readiness']['get']['parameters']['query']
>

export type AccountingExportReadinessSortField = NonNullable<
  AccountingExportReadinessQuery['sortField']
>
export type AccountingExportReadinessSortDirection = NonNullable<
  AccountingExportReadinessQuery['sortDirection']
>
export type AccountingExportReadinessResponse =
  components['schemas']['AccountingExportReadinessResponseDto']
export type AccountingExportReadinessDocument =
  components['schemas']['AccountingExportReadinessDocumentDto']
export type AccountingExportBlockerCode =
  components['schemas']['AccountingExportReadinessReasonDto']['code']
export type AccountingExportDocumentKind =
  components['schemas']['AccountingExportReadinessDocumentKindDto']['kind']

export interface AccountingExportReadinessParams {
  legalEntityId: string
  dateFrom: string
  dateTo: string
  reason?: AccountingExportBlockerCode
  documentKind?: AccountingExportDocumentKind
  search?: string
  sortField?: AccountingExportReadinessSortField
  sortDirection?: AccountingExportReadinessSortDirection
  page?: number
  limit?: number
}

export const accountingExportReadinessKeys = {
  readiness: (params: AccountingExportReadinessParams) =>
    [...accountingExportKeys.all, 'readiness', params] as const,
}

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
  if (params.sortField) searchParams.set('sortField', params.sortField)
  if (params.sortDirection) searchParams.set('sortDirection', params.sortDirection)
  if (params.page) searchParams.set('page', String(params.page))
  if (params.limit) searchParams.set('limit', String(params.limit))
  return searchParams.toString()
}

async function throwReadinessError(response: Response): Promise<never> {
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string | string[]
  }
  const message = Array.isArray(payload.message)
    ? payload.message.join(', ')
    : payload.message || 'Failed to load export readiness'
  throw createHttpError(message, response.status)
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
    queryKey: accountingExportReadinessKeys.readiness(queryParams),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `${ACCOUNTING_EXPORT_READINESS_API}?${buildAccountingExportReadinessQuery(queryParams)}`,
      )
      if (!response.ok) {
        await throwReadinessError(response)
      }
      return response.json() as Promise<AccountingExportReadinessResponse>
    },
    enabled: Boolean(params?.legalEntityId && params.dateFrom && params.dateTo),
  })
}
