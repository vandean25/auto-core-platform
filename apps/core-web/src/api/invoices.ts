import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { DiscountType, Invoice } from './types'

const INVOICES_API = '/api/invoices'

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
      queryClient.invalidateQueries({ queryKey: ['workshop', 'orders'] })
      queryClient.invalidateQueries({ queryKey: ['workshop', 'order', orderId] })
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
      queryClient.setQueryData(['invoices', invoice.id], invoice)
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
      queryClient.setQueryData(['invoices', invoice.id], invoice)
      if (invoice.workshop_order_id) {
        queryClient.invalidateQueries({
          queryKey: ['workshop', 'order', invoice.workshop_order_id],
        })
        queryClient.invalidateQueries({ queryKey: ['workshop', 'orders'] })
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

export async function downloadInvoicePdf(invoiceId: string): Promise<Blob> {
  const response = await fetchWithAuth(`${INVOICES_API}/${invoiceId}/pdf`, {
    headers: {
      Accept: 'application/pdf',
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || 'Failed to download invoice PDF')
  }
  return response.blob()
}
