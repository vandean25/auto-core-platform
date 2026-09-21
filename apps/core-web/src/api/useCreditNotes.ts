import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from './client'
import { invoiceKeys } from './sales'

export type CreditNoteResponseDto = components['schemas']['CreditNoteResponseDto']
export type CreditNoteStatus = components['schemas']['CreditNoteStatus']
export type CreateCreditNoteDto = components['schemas']['CreateCreditNoteDto']
export type UpdateCreditNoteDto = components['schemas']['UpdateCreditNoteDto']
export type FinalizeCreditNoteDto = components['schemas']['FinalizeCreditNoteDto']
export type VoidCreditNoteDto = components['schemas']['VoidCreditNoteDto']
export type InvoiceCreditContextResponseDto =
  components['schemas']['InvoiceCreditContextResponseDto']

const CREDIT_NOTES_API = '/api/credit-notes'

export const creditNoteKeys = {
  all: ['credit-notes'] as const,
  list: (params: CreditNotesListParams = {}) =>
    [...creditNoteKeys.all, 'list', params] as const,
  detail: (id: string) => [...creditNoteKeys.all, 'detail', id] as const,
  invoiceContext: (invoiceId: string) =>
    [...creditNoteKeys.all, 'invoice-context', invoiceId] as const,
}

export interface CreditNotesListParams {
  page?: number
  limit?: number
  search?: string
  originalInvoiceId?: string
}

export interface CreditNotesListResponse {
  data: CreditNoteResponseDto[]
  meta: {
    total: number
    page: number
    pageSize: number
    pageCount: number
  }
}

async function parseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({ message: fallback }))
  throw new Error(payload.message || fallback)
}

export function useCreditNotes(params: CreditNotesListParams = {}) {
  return useQuery<CreditNotesListResponse>({
    queryKey: creditNoteKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params.page) searchParams.set('page', String(params.page))
      if (params.limit) searchParams.set('limit', String(params.limit))
      if (params.search) searchParams.set('search', params.search)
      if (params.originalInvoiceId) {
        searchParams.set('originalInvoiceId', params.originalInvoiceId)
      }

      const response = await fetchWithAuth(
        `${CREDIT_NOTES_API}?${searchParams.toString()}`,
      )
      if (!response.ok) {
        await parseError(response, 'Failed to fetch credit notes')
      }
      return response.json() as Promise<CreditNotesListResponse>
    },
  })
}

export function useCreditNote(id: string) {
  return useQuery<CreditNoteResponseDto>({
    queryKey: creditNoteKeys.detail(id),
    queryFn: async () => {
      const response = await fetchWithAuth(`${CREDIT_NOTES_API}/${id}`)
      if (!response.ok) {
        await parseError(response, 'Failed to fetch credit note')
      }
      return response.json() as Promise<CreditNoteResponseDto>
    },
    enabled: Boolean(id),
  })
}

export function useInvoiceCreditContext(invoiceId: string) {
  return useQuery<InvoiceCreditContextResponseDto>({
    queryKey: creditNoteKeys.invoiceContext(invoiceId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/invoices/${invoiceId}/credit-notes`,
      )
      if (!response.ok) {
        await parseError(response, 'Failed to fetch invoice credit context')
      }
      return response.json() as Promise<InvoiceCreditContextResponseDto>
    },
    enabled: Boolean(invoiceId),
  })
}

export function useCreateCreditNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      invoiceId,
      payload,
    }: {
      invoiceId: string
      payload: CreateCreditNoteDto
    }) => {
      const response = await fetchWithAuth(
        `/api/invoices/${invoiceId}/credit-notes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response.ok) {
        await parseError(response, 'Failed to create credit note')
      }
      return response.json() as Promise<CreditNoteResponseDto>
    },
    onSuccess: (creditNote) => {
      queryClient.invalidateQueries({ queryKey: creditNoteKeys.all })
      queryClient.invalidateQueries({
        queryKey: creditNoteKeys.invoiceContext(creditNote.originalInvoiceId),
      })
      queryClient.invalidateQueries({
        queryKey: invoiceKeys.detail(creditNote.originalInvoiceId),
      })
    },
  })
}

export function useUpdateCreditNoteDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      payload,
      signal,
    }: {
      id: string
      payload: UpdateCreditNoteDto
      signal?: AbortSignal
    }) => {
      const response = await fetchWithAuth(`${CREDIT_NOTES_API}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
      if (!response.ok) {
        await parseError(response, 'Failed to update credit note')
      }
      return response.json() as Promise<CreditNoteResponseDto>
    },
    onSuccess: (creditNote) => {
      queryClient.setQueryData(creditNoteKeys.detail(creditNote.id), creditNote)
      queryClient.invalidateQueries({ queryKey: creditNoteKeys.list() })
      queryClient.invalidateQueries({
        queryKey: creditNoteKeys.invoiceContext(creditNote.originalInvoiceId),
      })
    },
  })
}

export function useFinalizeCreditNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string
      payload: FinalizeCreditNoteDto
    }) => {
      const response = await fetchWithAuth(`${CREDIT_NOTES_API}/${id}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        await parseError(response, 'Failed to finalize credit note')
      }
      return response.json() as Promise<CreditNoteResponseDto>
    },
    onSuccess: (creditNote) => {
      queryClient.setQueryData(creditNoteKeys.detail(creditNote.id), creditNote)
      queryClient.invalidateQueries({ queryKey: creditNoteKeys.all })
      queryClient.invalidateQueries({
        queryKey: creditNoteKeys.invoiceContext(creditNote.originalInvoiceId),
      })
    },
  })
}

export function useVoidCreditNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string
      payload: VoidCreditNoteDto
    }) => {
      const response = await fetchWithAuth(`${CREDIT_NOTES_API}/${id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        await parseError(response, 'Failed to void credit note')
      }
      return response.json() as Promise<CreditNoteResponseDto>
    },
    onSuccess: (creditNote) => {
      queryClient.setQueryData(creditNoteKeys.detail(creditNote.id), creditNote)
      queryClient.invalidateQueries({ queryKey: creditNoteKeys.all })
      queryClient.invalidateQueries({
        queryKey: creditNoteKeys.invoiceContext(creditNote.originalInvoiceId),
      })
    },
  })
}

export function useGenerateCreditNotePdf() {
  return useMutation({
    mutationFn: async (creditNoteId: string) => {
      const response = await fetchWithAuth(
        `${CREDIT_NOTES_API}/${creditNoteId}/pdf`,
        { method: 'POST' },
      )
      if (!response.ok) {
        await parseError(response, 'Failed to generate credit note PDF')
      }
      return response.json() as Promise<{
        mode: 'cached' | 'enqueued' | 'generated'
        creditNoteId: string
        taskId?: string
      }>
    },
  })
}

export async function downloadCreditNotePdf(creditNoteId: string): Promise<Blob> {
  const response = await fetchWithAuth(
    `${CREDIT_NOTES_API}/${creditNoteId}/pdf`,
    {
      headers: { Accept: 'application/pdf' },
    },
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || 'Failed to download credit note PDF')
  }
  return response.blob()
}
