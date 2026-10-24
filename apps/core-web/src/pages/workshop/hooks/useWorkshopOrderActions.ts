import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUpdateWorkshopOrder } from '@/api/workshop'
import type { WorkshopOrder } from '@/api/types'
import { getErrorMessage } from '../utils/error'

/** Order-level saves (internal notes, reported issue) and the job card PDF. Saves are ignored once the order is invoiced. */
export function useWorkshopOrderActions(order: WorkshopOrder, isLocked: boolean) {
  const { t } = useTranslation('workshop')
  const updateOrder = useUpdateWorkshopOrder()

  const saveNotes = async (nextNotes: string) => {
    if (isLocked) return
    if (nextNotes === (order.notes ?? '')) return
    try {
      await updateOrder.mutateAsync({ id: order.id, notes: nextNotes })
      toast.success(t('orderDetail.toast.notesSaved'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('orderDetail.toast.notesSaveFailed')))
    }
  }

  const saveReportedIssue = async (nextIssue: string) => {
    if (isLocked) return
    if (nextIssue === (order.reportedIssue || order.reported_issue || '')) return
    try {
      await updateOrder.mutateAsync({
        id: order.id,
        reportedIssue: nextIssue,
      })
      toast.success(t('orderDetail.toast.reportedIssueSaved'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('orderDetail.toast.reportedIssueSaveFailed')))
    }
  }

  return { saveNotes, saveReportedIssue }
}
