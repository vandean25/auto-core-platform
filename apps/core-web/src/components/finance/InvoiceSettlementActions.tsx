import { useState } from 'react'
import { toast } from 'sonner'
import {
  settlementSuccessToastMessage,
  useCancelFiscalReceipt,
  useInvoiceSettlement,
  useRecordSettlement,
  useReconcileSettlement,
} from '@/api/useInvoiceSettlement'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Props = {
  invoiceId: string
  invoiceStatus: string
  canManage: boolean
}

export function InvoiceSettlementActions({
  invoiceId,
  invoiceStatus,
  canManage,
}: Props) {
  const { data } = useInvoiceSettlement(invoiceId)
  const record = useRecordSettlement(invoiceId)
  const cancel = useCancelFiscalReceipt(invoiceId)
  const [method, setMethod] = useState<'CASH' | 'CARD'>('CASH')
  const [externalNumber, setExternalNumber] = useState('')
  const [externalDate, setExternalDate] = useState('')

  const rksvMode = data?.rksvMode
  const payment = data?.payment
  const signedNormal = payment?.fiscalReceipts.find(
    (receipt) => receipt.receiptType === 'NORMAL' && receipt.state === 'SIGNED',
  )

  const hasOpenReceipt = payment?.fiscalReceipts.some(
    (receipt) => receipt.state === 'PENDING' || receipt.state === 'UNKNOWN',
  )

  const reconcile = useReconcileSettlement(
    invoiceId,
    hasOpenReceipt ? payment?.idempotencyKey : undefined,
  )

  if (!canManage) {
    return null
  }

  if (rksvMode === 'OFF' || rksvMode === 'UNKNOWN') {
    return (
      <p className="max-w-sm text-right text-xs text-slate-500">
        Fiscal settlement is off for this legal entity.
      </p>
    )
  }

  if (invoiceStatus !== 'ISSUED' && invoiceStatus !== 'PAID') {
    return null
  }

  const showRecord =
    invoiceStatus === 'ISSUED' &&
    (!payment ||
      payment.status === 'REJECTED' ||
      (payment.status !== 'PENDING' &&
        payment.status !== 'UNKNOWN' &&
        payment.status !== 'SETTLED' &&
        payment.status !== 'SETTLED_EXTERNAL'))

  const showReconcile = Boolean(payment && hasOpenReceipt)

  const showCancel =
    invoiceStatus === 'PAID' &&
    signedNormal &&
    !payment?.fiscalReceipts.some(
      (receipt) =>
        receipt.receiptType === 'CANCELLATION' &&
        (receipt.state === 'PENDING' ||
          receipt.state === 'UNKNOWN' ||
          receipt.state === 'SIGNED'),
    )

  const handleRecord = () => {
    if (rksvMode === 'REQUIRED_EXTERNAL_KASSE') {
      if (!externalNumber.trim() || !externalDate) {
        toast.error('External receipt number and date are required.')
        return
      }
    }
    record.mutate(
      {
        method,
        externalReceiptNumber:
          rksvMode === 'REQUIRED_EXTERNAL_KASSE' ? externalNumber.trim() : undefined,
        externalReceiptDate:
          rksvMode === 'REQUIRED_EXTERNAL_KASSE' ? externalDate : undefined,
      },
      {
        onSuccess: (result) => {
          const message = settlementSuccessToastMessage(result.payment?.status)
          if (message) toast.success(message)
          else if (
            result.payment?.status === 'PENDING' ||
            result.payment?.status === 'UNKNOWN'
          ) {
            toast.message('Settlement attempt is still open — reconcile if needed.')
          }
        },
        onError: (error) => toast.error(error.message),
      },
    )
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {rksvMode === 'REQUIRED_EXTERNAL_KASSE' && showRecord ? (
        <div className="flex flex-wrap items-end justify-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">External receipt no.</Label>
            <Input
              className="h-9 w-36"
              maxLength={40}
              value={externalNumber}
              onChange={(event) => setExternalNumber(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Receipt date</Label>
            <Input
              className="h-9 w-36"
              type="date"
              value={externalDate}
              onChange={(event) => setExternalDate(event.target.value)}
            />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {showRecord ? (
          <>
            <Select value={method} onValueChange={(value) => setMethod(value as 'CASH' | 'CARD')}>
              <SelectTrigger className="h-9 w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleRecord} disabled={record.isPending}>
              Record settlement
            </Button>
          </>
        ) : null}
        {showReconcile ? (
          <Button
            size="sm"
            variant="outline"
            disabled={reconcile.isPending}
            onClick={() => {
              reconcile.mutate(undefined, {
                onSuccess: (result) => {
                  const message = settlementSuccessToastMessage(result.payment?.status)
                  if (message) toast.success(message)
                  else toast.message('Reconcile finished — check payment status.')
                },
                onError: (error) => toast.error(error.message),
              })
            }}
          >
            Reconcile
          </Button>
        ) : null}
        {showCancel && signedNormal ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() => {
              cancel.mutate(signedNormal.id, {
                onSuccess: () => toast.message('Cancellation submitted — reconcile if needed.'),
                onError: (error) => toast.error(error.message),
              })
            }}
          >
            Cancel fiscal receipt
          </Button>
        ) : null}
      </div>
    </div>
  )
}
