import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  SettlementMutationError,
  settlementSuccessToastMessageKey,
  useCancelFiscalReceipt,
  useInvoiceSettlement,
  useRecordSettlement,
  useReconcileSettlement,
} from '@/api/useInvoiceSettlement'
import { getErrorMessage } from '@/lib/error-utils'
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
import { ensureNamespaceLoaded } from '@/lib/i18n'

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
  const { t } = useTranslation('finance')
  useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

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

  const toastSettlementError = (error: unknown) => {
    if (error instanceof SettlementMutationError) {
      toast.error(t(error.i18nKey))
      return
    }
    toast.error(getErrorMessage(error, t('settlement.errors.generic')))
  }

  if (!canManage) {
    return null
  }

  if (rksvMode === 'OFF' || rksvMode === 'UNKNOWN') {
    return (
      <p className="max-w-sm text-right text-xs text-slate-500">
        {t('settlement.fiscalOff')}
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
        toast.error(t('settlement.toast.externalFieldsRequired'))
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
          const messageKey = settlementSuccessToastMessageKey(result.payment?.status)
          if (messageKey) toast.success(t(messageKey))
          else if (
            result.payment?.status === 'PENDING' ||
            result.payment?.status === 'UNKNOWN'
          ) {
            toast.message(t('settlement.toast.settlementOpen'))
          }
        },
        onError: toastSettlementError,
      },
    )
  }

  return (
    <div className="flex flex-col items-end gap-2 max-sm:items-stretch">
      {rksvMode === 'REQUIRED_EXTERNAL_KASSE' && showRecord ? (
        <div className="flex flex-wrap items-end justify-end gap-2 max-sm:flex-col max-sm:items-stretch">
          <div className="space-y-1">
            <Label className="text-xs">{t('settlement.externalReceiptNo')}</Label>
            <Input
              className="h-9 w-36 max-sm:w-full"
              maxLength={40}
              value={externalNumber}
              onChange={(event) => setExternalNumber(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('settlement.receiptDate')}</Label>
            <Input
              className="h-9 w-36 max-sm:w-full"
              type="date"
              value={externalDate}
              onChange={(event) => setExternalDate(event.target.value)}
            />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2 max-sm:flex-col">
        {showRecord ? (
          <>
            <Select value={method} onValueChange={(value) => setMethod(value as 'CASH' | 'CARD')}>
              <SelectTrigger className="h-9 w-[120px] max-sm:w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">{t('settlement.methodCash')}</SelectItem>
                <SelectItem value="CARD">{t('settlement.methodCard')}</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleRecord} disabled={record.isPending}>
              {t('actions.recordSettlement')}
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
                  const messageKey = settlementSuccessToastMessageKey(result.payment?.status)
                  if (messageKey) toast.success(t(messageKey))
                  else toast.message(t('settlement.toast.reconcileFinished'))
                },
                onError: toastSettlementError,
              })
            }}
          >
            {t('actions.reconcile')}
          </Button>
        ) : null}
        {showCancel && signedNormal ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() => {
              cancel.mutate(signedNormal.id, {
                onSuccess: () => toast.message(t('settlement.toast.cancellationSubmitted')),
                onError: toastSettlementError,
              })
            }}
          >
            {t('settlement.cancelFiscalReceipt')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
