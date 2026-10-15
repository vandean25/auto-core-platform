import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { generateId } from '@/lib/id'
import { invoiceKeys } from '@/api/sales'

export type FiscalReceiptSummary = {
  id: string
  providerReceiptId: string
  receiptType: string
  state: string
  receiptNumber: string | null
  timeSignature: number | null
  cashRegisterSerialNumber: string | null
  qrCodeData: string | null
  signed: boolean | null
  hints: string[] | null
  providerRequestId: string | null
}

export type SettlementPaymentSummary = {
  id: string
  idempotencyKey: string
  status: string
  method: string
  amount: string
  currency: string
  externalReceiptNumber: string | null
  externalReceiptDate: string | null
  fiscalReceipts: FiscalReceiptSummary[]
}

export type SettlementResponse = {
  invoiceId: string
  invoiceStatus: string
  payment: SettlementPaymentSummary | null
}

export const invoiceSettlementKeys = {
  detail: (invoiceId: string) => [...invoiceKeys.detail(invoiceId), 'settlement'] as const,
}

async function fetchSettlement(invoiceId: string): Promise<SettlementResponse> {
  const response = await fetch(`/api/invoices/${invoiceId}/settlement`, {
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error('Failed to load settlement')
  }
  return response.json() as Promise<SettlementResponse>
}

export function useInvoiceSettlement(invoiceId: string | undefined) {
  return useQuery({
    queryKey: invoiceId ? invoiceSettlementKeys.detail(invoiceId) : ['invoice-settlement', 'missing'],
    queryFn: () => fetchSettlement(invoiceId!),
    enabled: Boolean(invoiceId),
  })
}

export function useRecordSettlement(invoiceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      method: 'CASH' | 'CARD'
      externalReceiptNumber?: string
      externalReceiptDate?: string
    }) => {
      const response = await fetch(`/api/invoices/${invoiceId}/settlement`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: generateId(),
          method: input.method,
          externalReceiptNumber: input.externalReceiptNumber,
          externalReceiptDate: input.externalReceiptDate,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          typeof body.message === 'string' ? body.message : 'Settlement failed',
        )
      }
      return body as SettlementResponse
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) })
      void queryClient.invalidateQueries({ queryKey: invoiceSettlementKeys.detail(invoiceId) })
    },
  })
}

export function useReconcileSettlement(invoiceId: string, idempotencyKey: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!idempotencyKey) {
        throw new Error('Missing settlement idempotency key')
      }
      const response = await fetch(`/api/invoices/${invoiceId}/settlement/reconcile`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          typeof body.message === 'string' ? body.message : 'Reconcile failed',
        )
      }
      return body as SettlementResponse
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) })
      void queryClient.invalidateQueries({ queryKey: invoiceSettlementKeys.detail(invoiceId) })
    },
  })
}
