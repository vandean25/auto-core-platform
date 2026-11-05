import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useRecordSettlement } from '@/api/useInvoiceSettlement'
import { useSettlementToasts } from './useSettlementToasts'

/** Method and external receipt fields of the record-settlement form, and its submit. */
export function useRecordSettlementForm(invoiceId: string, needsExternalReceipt: boolean) {
  const { t } = useTranslation('finance')
  const record = useRecordSettlement(invoiceId)
  const toasts = useSettlementToasts()
  const [method, setMethod] = useState<'CASH' | 'CARD'>('CASH')
  const [externalNumber, setExternalNumber] = useState('')
  const [externalDate, setExternalDate] = useState('')

  const submit = () => {
    if (needsExternalReceipt && (!externalNumber.trim() || !externalDate)) {
      toast.error(t('settlement.toast.externalFieldsRequired'))
      return
    }
    record.mutate(
      {
        method,
        externalReceiptNumber: needsExternalReceipt ? externalNumber.trim() : undefined,
        externalReceiptDate: needsExternalReceipt ? externalDate : undefined,
      },
      { onSuccess: toasts.onRecordSuccess, onError: toasts.onError },
    )
  }

  return {
    method,
    setMethod,
    externalNumber,
    setExternalNumber,
    externalDate,
    setExternalDate,
    submit,
    isPending: record.isPending,
  }
}
