import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/api/generated/openapi'
import { createHttpError } from '@/lib/error-utils'
import { fetchWithAuth } from './client'

export type PreviewAccountingExportDto =
  components['schemas']['PreviewAccountingExportDto']
export type AccountingExportPreviewResponseDto =
  components['schemas']['AccountingExportPreviewResponseDto']
export type GenerateAccountingExportDto =
  components['schemas']['GenerateAccountingExportDto']
export type AccountingExportCreatedResponseDto =
  components['schemas']['AccountingExportCreatedResponseDto']
export type AccountingExportSummaryDto =
  components['schemas']['AccountingExportSummaryDto']
export type AccountingExportDetailDto =
  components['schemas']['AccountingExportDetailDto']

const ACCOUNTING_EXPORTS_API = '/api/finance/accounting-exports'

export const accountingExportKeys = {
  all: ['accounting-exports'] as const,
  list: (params: AccountingExportsListParams = {}) =>
    [...accountingExportKeys.all, 'list', params] as const,
  detail: (id: string) => [...accountingExportKeys.all, 'detail', id] as const,
}

export interface AccountingExportsListParams {
  page?: number
  limit?: number
  search?: string
  legalEntityId?: string
}

export interface AccountingExportsListResponse {
  data: AccountingExportSummaryDto[]
  meta: {
    total: number
    page: number
    limit: number
    pageCount: number
  }
}

type ApiErrorPayload = {
  message?: string | string[]
  code?: string
}

async function parseApiError(response: Response, fallback: string): Promise<never> {
  const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload
  const message = Array.isArray(payload.message)
    ? payload.message.join(', ')
    : payload.message || fallback
  throw createHttpError(message, response.status)
}

export function usePreviewAccountingExport() {
  return useMutation({
    mutationFn: async (payload: PreviewAccountingExportDto) => {
      const response = await fetchWithAuth(`${ACCOUNTING_EXPORTS_API}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        await parseApiError(response, 'Failed to preview accounting export')
      }
      return response.json() as Promise<AccountingExportPreviewResponseDto>
    },
  })
}

export function useGenerateAccountingExport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: GenerateAccountingExportDto) => {
      const response = await fetchWithAuth(ACCOUNTING_EXPORTS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        await parseApiError(response, 'Failed to generate accounting export')
      }
      return response.json() as Promise<AccountingExportCreatedResponseDto>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountingExportKeys.all })
    },
  })
}

export function useAccountingExports(params: AccountingExportsListParams = {}) {
  return useQuery<AccountingExportsListResponse>({
    queryKey: accountingExportKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params.page) searchParams.set('page', String(params.page))
      if (params.limit) searchParams.set('limit', String(params.limit))
      if (params.search) searchParams.set('search', params.search)
      if (params.legalEntityId) {
        searchParams.set('legalEntityId', params.legalEntityId)
      }

      const query = searchParams.toString()
      const response = await fetchWithAuth(
        query ? `${ACCOUNTING_EXPORTS_API}?${query}` : ACCOUNTING_EXPORTS_API,
      )
      if (!response.ok) {
        await parseApiError(response, 'Failed to load accounting export history')
      }
      return response.json() as Promise<AccountingExportsListResponse>
    },
    refetchOnWindowFocus: true,
  })
}

export function useAccountingExportDetail(id: string | null) {
  return useQuery<AccountingExportDetailDto>({
    queryKey: accountingExportKeys.detail(id ?? ''),
    queryFn: async () => {
      const response = await fetchWithAuth(`${ACCOUNTING_EXPORTS_API}/${id}`)
      if (!response.ok) {
        await parseApiError(response, 'Failed to load accounting export details')
      }
      return response.json() as Promise<AccountingExportDetailDto>
    },
    enabled: Boolean(id),
  })
}

export type AccountingExportDownloadResult = {
  blob: Blob
  sha256: string
  filename: string
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null
  const quoted = header.match(/filename="([^"]+)"/i)
  if (quoted?.[1]) return quoted[1]
  const unquoted = header.match(/filename=([^;\s]+)/i)
  return unquoted?.[1] ?? null
}

export async function downloadAccountingExportCsv(
  exportId: string,
  expectedSha256?: string,
): Promise<AccountingExportDownloadResult> {
  const response = await fetchWithAuth(
    `${ACCOUNTING_EXPORTS_API}/${exportId}/download`,
    {
      headers: { Accept: 'text/csv' },
    },
  )

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      await parseApiError(response, 'Failed to download accounting export')
    }
    throw createHttpError('Failed to download accounting export', response.status)
  }

  const headerSha256 =
    response.headers.get('X-Checksum-SHA256') ??
    response.headers.get('x-checksum-sha256')
  const sha256 = headerSha256 ?? expectedSha256 ?? ''
  const filename =
    parseContentDispositionFilename(response.headers.get('content-disposition')) ??
    `accounting-export-${exportId}.csv`
  const blob = await response.blob()

  return { blob, sha256, filename }
}

export async function computeBlobSha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
