import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SettlementMutationError, settlementSuccessToastMessageKey } from '@/api/useInvoiceSettlement'
import { getErrorMessage } from '@/lib/error-utils'

type SettlementResult = { payment?: { status?: string } | null }

/** Toasts for the outcome of record, reconcile and cancel on an invoice settlement. */
export function useSettlementToasts() {
  const { t } = useTranslation('finance')

  const onError = (error: unknown) => {
    if (error instanceof SettlementMutationError) {
      toast.error(t(error.i18nKey))
      return
    }
    toast.error(getErrorMessage(error, t('settlement.errors.generic')))
  }

  const onRecordSuccess = (result: SettlementResult) => {
    const messageKey = settlementSuccessToastMessageKey(result.payment?.status)
    if (messageKey) toast.success(t(messageKey))
    else if (result.payment?.status === 'PENDING' || result.payment?.status === 'UNKNOWN') {
      toast.message(t('settlement.toast.settlementOpen'))
    }
  }

  const onReconcileSuccess = (result: SettlementResult) => {
    const messageKey = settlementSuccessToastMessageKey(result.payment?.status)
    if (messageKey) toast.success(t(messageKey))
    else toast.message(t('settlement.toast.reconcileFinished'))
  }

  const onCancelSuccess = () => toast.message(t('settlement.toast.cancellationSubmitted'))

  return { onError, onRecordSuccess, onReconcileSuccess, onCancelSuccess }
}
