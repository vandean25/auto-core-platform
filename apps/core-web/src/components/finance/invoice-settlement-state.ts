import type { useInvoiceSettlement } from '@/api/useInvoiceSettlement'

type SettlementData = NonNullable<ReturnType<typeof useInvoiceSettlement>['data']>
export type SettlementPayment = SettlementData['payment']

const OPEN_PAYMENT_STATES = ['PENDING', 'UNKNOWN', 'SETTLED', 'SETTLED_EXTERNAL']
const OPEN_RECEIPT_STATES = ['PENDING', 'UNKNOWN']
const CANCELLATION_BLOCKING_STATES = ['PENDING', 'UNKNOWN', 'SIGNED']

/** What the settlement actions offer for an invoice: record, reconcile or cancel a fiscal receipt. */
export function settlementState(invoiceStatus: string, payment: SettlementPayment | undefined) {
  const receipts = payment?.fiscalReceipts ?? []
  const signedNormal = receipts.find((receipt) => receipt.receiptType === 'NORMAL' && receipt.state === 'SIGNED')
  const hasOpenReceipt = receipts.some((receipt) => OPEN_RECEIPT_STATES.includes(receipt.state))

  const canRecord = !payment || payment.status === 'REJECTED' || !OPEN_PAYMENT_STATES.includes(payment.status)
  const cancellationInFlight = receipts.some(
    (receipt) => receipt.receiptType === 'CANCELLATION' && CANCELLATION_BLOCKING_STATES.includes(receipt.state),
  )

  return {
    hasOpenReceipt,
    signedNormal,
    showRecord: invoiceStatus === 'ISSUED' && canRecord,
    showReconcile: Boolean(payment && hasOpenReceipt),
    showCancel: invoiceStatus === 'PAID' && Boolean(signedNormal) && !cancellationInFlight,
  }
}

/** Whether the actions show at all: hidden, only the "fiscal off" hint, or the actions themselves. */
export function settlementVisibility(
  canManage: boolean,
  rksvMode: string | undefined,
  invoiceStatus: string,
): 'hidden' | 'fiscalOff' | 'actions' {
  if (!canManage) return 'hidden'
  if (rksvMode === 'OFF' || rksvMode === 'UNKNOWN') return 'fiscalOff'
  return invoiceStatus === 'ISSUED' || invoiceStatus === 'PAID' ? 'actions' : 'hidden'
}
