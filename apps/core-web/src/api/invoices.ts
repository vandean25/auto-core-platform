import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  downloadPdfFromGetUrl,
  generateAndDownloadPdfBlob,
} from '@/lib/async-pdf'
import { fetchWithAuth } from './client'
import { invoiceKeys } from './sales'
import type { DiscountType, Invoice } from './types'
import { workshopKeys } from './workshop'

const INVOICES_API = '/api/invoices'
const SALES_INVOICES_API = '/api/sales/invoices'

export interface UpdateInvoiceDiscountLine {
  id: string
  discountType?: DiscountType | null
  discountValue?: number | null
}

export interface UpdateInvoiceDiscountPayload {
  globalDiscountType?: DiscountType | null
  globalDiscountValue?: number | null
  lineItems?: UpdateInvoiceDiscountLine[]
}

export function useCreateDraftInvoice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await fetchWithAuth(`${INVOICES_API}/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workshopOrderId: orderId }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({
          message: 'Failed to create draft invoice',
        }))
        throw new Error(payload.message || 'Failed to create draft invoice')
      }
      return response.json() as Promise<Invoice>
    },
    onSuccess: (_invoice, orderId) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all })
      queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
      queryClient.invalidateQueries({ queryKey: workshopKeys.order(orderId) })
    },
  })
}

export function useUpdateInvoiceDiscount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      invoiceId,
      payload,
    }: {
      invoiceId: string
      payload: UpdateInvoiceDiscountPayload
    }) => {
      const response = await fetchWithAuth(
        `${INVOICES_API}/${invoiceId}/discounts`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => ({
          message: 'Failed to update invoice discounts',
        }))
        throw new Error(payload.message || 'Failed to update invoice discounts')
      }
      return response.json() as Promise<Invoice>
    },
    onSuccess: (invoice) => {
      queryClient.setQueryData(invoiceKeys.detail(invoice.id), invoice)
    },
  })
}

export function useIssueInvoice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const response = await fetchWithAuth(
        `${INVOICES_API}/${invoiceId}/issue`,
        {
          method: 'PATCH',
        },
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => ({
          message: 'Failed to issue invoice',
        }))
        throw new Error(payload.message || 'Failed to issue invoice')
      }
      return response.json() as Promise<Invoice>
    },
    onSuccess: (invoice) => {
      queryClient.setQueryData(invoiceKeys.detail(invoice.id), invoice)
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all })
      if (invoice.workshop_order_id) {
        queryClient.invalidateQueries({
          queryKey: workshopKeys.order(invoice.workshop_order_id),
        })
        queryClient.invalidateQueries({ queryKey: workshopKeys.orders() })
      }
    },
  })
}

export function useGenerateInvoicePdf() {
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const response = await fetchWithAuth(
        `${INVOICES_API}/${invoiceId}/pdf`,
        { method: 'POST' },
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => ({
          message: 'Failed to generate PDF',
        }))
        throw new Error(payload.message || 'Failed to generate PDF')
      }
      return response.json() as Promise<{
        mode: 'cached' | 'enqueued' | 'generated'
        invoiceId: string
        taskId?: string
      }>
    },
  })
}

export type InvoicePdfGenerationMode = 'cached' | 'enqueued' | 'generated'

export async function fetchInvoicePdfGenerationError(
  invoiceId: string,
): Promise<string | null> {
  const response = await fetchWithAuth(`${SALES_INVOICES_API}/${invoiceId}`)
  if (!response.ok) {
    return null
  }
  const invoice = (await response.json()) as Invoice
  return invoice.pdf_generation_error ?? null
}

export async function downloadInvoicePdf(
  invoiceId: string,
  options?: { poll?: boolean },
): Promise<Blob> {
  return downloadPdfFromGetUrl(`${INVOICES_API}/${invoiceId}/pdf`, {
    poll: options?.poll,
    pollOptions: options?.poll
      ? {
          checkGenerationFailed: () =>
            fetchInvoicePdfGenerationError(invoiceId),
        }
      : undefined,
  })
}

export async function generateAndDownloadInvoicePdf(
  invoiceId: string,
  options?: {
    onPoll?: (attempt: number) => void
    signal?: AbortSignal
  },
): Promise<Blob> {
  return generateAndDownloadPdfBlob({
    postUrl: `${INVOICES_API}/${invoiceId}/pdf`,
    getUrl: `${INVOICES_API}/${invoiceId}/pdf`,
    checkGenerationFailed: () => fetchInvoicePdfGenerationError(invoiceId),
    ...options,
  })
}

