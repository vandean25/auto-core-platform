import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { getApiErrorBody } from '@/api/api-error'
import { fetchWithAuth } from '@/api/client'
import { generateId } from '@/lib/id'
import { createHttpError, getErrorMessage } from '@/lib/error-utils'
import { invoiceKeys } from '@/api/sales'

export type SettlementMutationErrorKey =
  | 'settlement.errors.recordFailed'
  | 'settlement.errors.reconcileFailed'
  | 'settlement.errors.cancellationFailed'
  | 'settlement.errors.missingIdempotencyKey'

export class SettlementMutationError extends Error {
  readonly i18nKey: SettlementMutationErrorKey

  constructor(i18nKey: SettlementMutationErrorKey) {
    super(i18nKey)
    this.name = 'SettlementMutationError'
    this.i18nKey = i18nKey
  }
}

const SETTLEMENT_HTTP_FALLBACK: Record<SettlementMutationErrorKey, string> = {
  'settlement.errors.recordFailed': 'Settlement failed',
  'settlement.errors.reconcileFailed': 'Reconciliation failed',
  'settlement.errors.cancellationFailed': 'Cancellation failed',
  'settlement.errors.missingIdempotencyKey': 'Missing settlement idempotency key',
}

/** Throws with `response.data.code` preserved for `getErrorMessage`, or a finance fallback key. */
export function throwIfSettlementResponseNotOk(
  response: Response,
  body: unknown,
  fallbackKey: SettlementMutationErrorKey,
): void {
  if (response.ok) {
    return
  }
  const data = getApiErrorBody({ response: { status: response.status, data: body } })
  if (typeof data?.code === 'string' && data.code.length > 0) {
    const synthetic = { response: { status: response.status, data } }
    const message = getErrorMessage(synthetic, SETTLEMENT_HTTP_FALLBACK[fallbackKey])
    throw createHttpError(message, response.status, data)
  }
  throw new SettlementMutationError(fallbackKey)
}

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
  rksvMode?: 'OFF' | 'UNKNOWN' | 'REQUIRED_EXTERNAL_KASSE' | 'REQUIRED_ACP_RKSV'
  siteTimezone?: string
  payment: SettlementPaymentSummary | null
}

export const invoiceSettlementKeys = {
  detail: (invoiceId: string) => [...invoiceKeys.detail(invoiceId), 'settlement'] as const,
}

async function fetchSettlement(invoiceId: string): Promise<SettlementResponse> {
  const response = await fetchWithAuth(`/api/invoices/${invoiceId}/settlement`, {
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error('Failed to load settlement')
  }
  return response.json() as Promise<SettlementResponse>
}

function useStableSettlementIdempotencyKey(
  invoiceId: string,
  paymentStatus: string | undefined,
) {
  const keyRef = useRef(generateId())
  useEffect(() => {
    keyRef.current = generateId()
  }, [invoiceId])
  useEffect(() => {
    if (
      paymentStatus === 'SETTLED' ||
      paymentStatus === 'SETTLED_EXTERNAL' ||
      paymentStatus === 'REJECTED' ||
      paymentStatus === 'REVERSED'
    ) {
      keyRef.current = generateId()
    }
  }, [paymentStatus])
  return keyRef
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
  const { data } = useInvoiceSettlement(invoiceId)
  const idempotencyKeyRef = useStableSettlementIdempotencyKey(
    invoiceId,
    data?.payment?.status,
  )

  return useMutation({
    mutationFn: async (input: {
      method: 'CASH' | 'CARD'
      externalReceiptNumber?: string
      externalReceiptDate?: string
    }) => {
      const response = await fetchWithAuth(`/api/invoices/${invoiceId}/settlement`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: idempotencyKeyRef.current,
          method: input.method,
          externalReceiptNumber: input.externalReceiptNumber,
          externalReceiptDate: input.externalReceiptDate,
        }),
      })
      const body = (await response.json().catch(() => ({}))) as SettlementResponse & {
        message?: string
      }
      throwIfSettlementResponseNotOk(response, body, 'settlement.errors.recordFailed')
      return body
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) })
      void queryClient.invalidateQueries({ queryKey: invoiceSettlementKeys.detail(invoiceId) })
      return result
    },
  })
}

export function useReconcileSettlement(invoiceId: string, idempotencyKey: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!idempotencyKey) {
        throw new SettlementMutationError('settlement.errors.missingIdempotencyKey')
      }
      const response = await fetchWithAuth(`/api/invoices/${invoiceId}/settlement/reconcile`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey }),
      })
      const body = (await response.json().catch(() => ({}))) as SettlementResponse & {
        message?: string
      }
      throwIfSettlementResponseNotOk(response, body, 'settlement.errors.reconcileFailed')
      return body
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) })
      void queryClient.invalidateQueries({ queryKey: invoiceSettlementKeys.detail(invoiceId) })
    },
  })
}

export function useCancelFiscalReceipt(invoiceId: string) {
  const queryClient = useQueryClient()
  const cancelKeyRef = useRef(generateId())

  return useMutation({
    mutationFn: async (fiscalReceiptId: string) => {
      const response = await fetchWithAuth(`/api/fiscal-receipts/${fiscalReceiptId}/cancellation`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: cancelKeyRef.current }),
      })
      const body = (await response.json().catch(() => ({}))) as SettlementResponse & {
        message?: string
      }
      throwIfSettlementResponseNotOk(response, body, 'settlement.errors.cancellationFailed')
      return body
    },
    onSuccess: () => {
      cancelKeyRef.current = generateId()
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) })
      void queryClient.invalidateQueries({ queryKey: invoiceSettlementKeys.detail(invoiceId) })
    },
  })
}

export function settlementSuccessToastMessageKey(
  paymentStatus: string | undefined,
): 'settlement.toast.recorded' | null {
  if (paymentStatus === 'SETTLED' || paymentStatus === 'SETTLED_EXTERNAL') {
    return 'settlement.toast.recorded'
  }
  return null
}

/** @deprecated Use settlementSuccessToastMessageKey and translate in the UI layer. */
export function settlementSuccessToastMessage(paymentStatus: string | undefined): string | null {
  return settlementSuccessToastMessageKey(paymentStatus)
}
