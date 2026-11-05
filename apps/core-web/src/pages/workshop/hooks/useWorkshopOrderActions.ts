import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUpdateWorkshopOrder } from '@/api/workshop'
import type { WorkshopOrder } from '@/api/types'
import { useAuthSession } from '@/api/auth-session'
import { getErrorMessage } from '@/lib/error-utils'
import { toastSuccessWithUndo } from '@/lib/toast-actions'
import { canUndoWorkshopOrderNotes } from '@/features/interaction/can-undo-workshop-order-notes'
import { registerWorkshopOrderNotesUndo } from '@/features/interaction/workshop-order-notes-undo-registration'
import { useRunWorkshopOrderNotesUndo } from '@/features/interaction/use-run-workshop-order-notes-undo'

/** Order-level saves (internal notes, reported issue) and the job card PDF. Saves are ignored once the order is invoiced. */
export function useWorkshopOrderActions(order: WorkshopOrder, isLocked: boolean) {
  const { t } = useTranslation('workshop')
  const updateOrder = useUpdateWorkshopOrder()
  const activeRole = useAuthSession()?.data?.activeRole
  const runNotesUndo = useRunWorkshopOrderNotesUndo()

  const saveNotes = async (nextNotes: string) => {
    if (isLocked) return
    if (nextNotes === (order.notes ?? '')) return
    const previousNotes = order.notes ?? null
    try {
      const updated = await updateOrder.mutateAsync({ id: order.id, notes: nextNotes })
      const expectedUpdatedAt = updated.updatedAt
      if (canUndoWorkshopOrderNotes(activeRole) && expectedUpdatedAt) {
        registerWorkshopOrderNotesUndo({
          orderId: order.id,
          previousNotes,
          expectedUpdatedAt,
        })
        toastSuccessWithUndo(
          t('orderDetail.toast.notesSaved'),
          t('orderDetail.undoNotes.action'),
          () => {
            void runNotesUndo(order.id)
          },
        )
      } else {
        toast.success(t('orderDetail.toast.notesSaved'))
      }
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

  return { saveNotes, saveReportedIssue, runNotesUndo }
}
