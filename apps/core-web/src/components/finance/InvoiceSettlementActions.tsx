import { useTranslation } from 'react-i18next'
import {
  useCancelFiscalReceipt,
  useInvoiceSettlement,
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
import { useLazyNamespaceBundleReady } from '@/lib/i18n'
import { settlementState, settlementVisibility } from './invoice-settlement-state'
import { useRecordSettlementForm } from './useRecordSettlementForm'
import { useSettlementToasts } from './useSettlementToasts'

type Props = {
  invoiceId: string
  invoiceStatus: string
  canManage: boolean
}

function ExternalReceiptFields({
  number,
  date,
  onNumberChange,
  onDateChange,
}: {
  number: string
  date: string
  onNumberChange: (value: string) => void
  onDateChange: (value: string) => void
}) {
  const { t } = useTranslation('finance')

  return (
    <div className="flex flex-wrap items-end justify-end gap-2 max-sm:flex-col max-sm:items-stretch">
      <div className="space-y-1">
        <Label className="text-xs">{t('settlement.externalReceiptNo')}</Label>
        <Input
          className="h-9 w-36 max-sm:w-full"
          maxLength={40}
          value={number}
          onChange={(event) => onNumberChange(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('settlement.receiptDate')}</Label>
        <Input
          className="h-9 w-36 max-sm:w-full"
          type="date"
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
        />
      </div>
    </div>
  )
}

function RecordControls({
  method,
  onMethodChange,
  onRecord,
  pending,
}: {
  method: 'CASH' | 'CARD'
  onMethodChange: (method: 'CASH' | 'CARD') => void
  onRecord: () => void
  pending: boolean
}) {
  const { t } = useTranslation('finance')

  return (
    <>
      <Select value={method} onValueChange={(value) => onMethodChange(value as 'CASH' | 'CARD')}>
        <SelectTrigger className="h-9 w-[120px] max-sm:w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="CASH">{t('settlement.methodCash')}</SelectItem>
          <SelectItem value="CARD">{t('settlement.methodCard')}</SelectItem>
        </SelectContent>
      </Select>
      <Button size="sm" className="max-sm:min-h-11" onClick={onRecord} disabled={pending} aria-busy={pending}>
        {t('actions.recordSettlement')}
      </Button>
    </>
  )
}

function ReconcileButton({ invoiceId, idempotencyKey }: { invoiceId: string; idempotencyKey: string | undefined }) {
  const { t } = useTranslation('finance')
  const toasts = useSettlementToasts()
  const reconcile = useReconcileSettlement(invoiceId, idempotencyKey)

  return (
    <Button
      size="sm"
      variant="outline"
      className="max-sm:min-h-11"
      disabled={reconcile.isPending}
      aria-busy={reconcile.isPending}
      onClick={() => reconcile.mutate(undefined, { onSuccess: toasts.onReconcileSuccess, onError: toasts.onError })}
    >
      {t('actions.reconcile')}
    </Button>
  )
}

function CancelReceiptButton({ invoiceId, receiptId }: { invoiceId: string; receiptId: string }) {
  const { t } = useTranslation('finance')
  const toasts = useSettlementToasts()
  const cancel = useCancelFiscalReceipt(invoiceId)

  return (
    <Button
      size="sm"
      variant="destructive"
      className="max-sm:min-h-11"
      disabled={cancel.isPending}
      aria-busy={cancel.isPending}
      onClick={() => cancel.mutate(receiptId, { onSuccess: toasts.onCancelSuccess, onError: toasts.onError })}
    >
      {t('settlement.cancelFiscalReceipt')}
    </Button>
  )
}

export function InvoiceSettlementActions({
  invoiceId,
  invoiceStatus,
  canManage,
}: Props) {
  const { t } = useTranslation('finance')
  const { status: bundleStatus } = useLazyNamespaceBundleReady(['finance'])

  const { data } = useInvoiceSettlement(invoiceId)
  const rksvMode = data?.rksvMode
  const payment = data?.payment
  const needsExternalReceipt = rksvMode === 'REQUIRED_EXTERNAL_KASSE'
  const form = useRecordSettlementForm(invoiceId, needsExternalReceipt)
  const { hasOpenReceipt, signedNormal, showRecord, showReconcile, showCancel } = settlementState(
    invoiceStatus,
    payment,
  )

  const visibility = settlementVisibility(canManage, rksvMode, invoiceStatus)
  if (bundleStatus === 'loading') return null
  if (visibility === 'hidden') return null
  if (visibility === 'fiscalOff') {
    return <p className="max-w-sm text-right text-xs text-muted-foreground">{t('settlement.fiscalOff')}</p>
  }

  return (
    <div className="flex flex-col items-end gap-2 max-sm:items-stretch">
      {needsExternalReceipt && showRecord ? (
        <ExternalReceiptFields
          number={form.externalNumber}
          date={form.externalDate}
          onNumberChange={form.setExternalNumber}
          onDateChange={form.setExternalDate}
        />
      ) : null}
      <div className="flex flex-wrap justify-end gap-2 max-sm:flex-col">
        {showRecord ? (
          <RecordControls method={form.method} onMethodChange={form.setMethod} onRecord={form.submit} pending={form.isPending} />
        ) : null}
        {showReconcile ? (
          <ReconcileButton invoiceId={invoiceId} idempotencyKey={hasOpenReceipt ? payment?.idempotencyKey : undefined} />
        ) : null}
        {showCancel && signedNormal ? <CancelReceiptButton invoiceId={invoiceId} receiptId={signedNormal.id} /> : null}
      </div>
    </div>
  )
}
