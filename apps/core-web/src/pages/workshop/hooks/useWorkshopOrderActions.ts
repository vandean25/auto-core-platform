import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUpdateWorkshopOrderNotes } from '@/api/workshop'
import type { WorkshopOrder } from '@/api/types'
import { useAuthSession } from '@/api/auth-session'
import { toastSuccessWithUndo } from '@/lib/toast-actions'
import { useOptimisticFieldSave } from '@/features/interaction/use-optimistic-field-save'
import { canUndoWorkshopOrderNotes } from '@/features/interaction/can-undo-workshop-order-notes'
import { registerWorkshopOrderNotesUndo } from '@/features/interaction/workshop-order-notes-undo-registration'
import { useRunWorkshopOrderNotesUndo } from '@/features/interaction/use-run-workshop-order-notes-undo'

type OrderField = 'notes' | 'reportedIssue'

/** Order-level saves (internal notes, reported issue) and the job card PDF. Saves are ignored once the order is invoiced. */
export function useWorkshopOrderActions(order: WorkshopOrder, isLocked: boolean) {
  const { t } = useTranslation('workshop')
  const updateOrder = useUpdateWorkshopOrderNotes()
  const activeRole = useAuthSession()?.data?.activeRole
  const runNotesUndo = useRunWorkshopOrderNotesUndo()

  const { saveField, failures, retry, dismiss } = useOptimisticFieldSave<OrderField, string>({
    save: async (field, value) => {
      const previousNotes = order.notes ?? null
      const updated = await updateOrder.mutateAsync({ id: order.id, [field]: value })
      return { updated, previousNotes }
    },
    isOptimistic: () => true,
    successMessage: t('orderDetail.toast.reportedIssueSaved'),
    // Undo needs the committed version, so its toast follows the confirmed save, never the optimistic display.
    onSaved: (result, field) => {
      const { updated, previousNotes } = result as { updated: WorkshopOrder; previousNotes: string | null }
      if (field !== 'notes') return void toast.success(t('orderDetail.toast.reportedIssueSaved'))
      if (!canUndoWorkshopOrderNotes(activeRole) || !updated.updatedAt) {
        return void toast.success(t('orderDetail.toast.notesSaved'))
      }
      registerWorkshopOrderNotesUndo({ orderId: order.id, previousNotes, expectedUpdatedAt: updated.updatedAt })
      toastSuccessWithUndo(t('orderDetail.toast.notesSaved'), t('orderDetail.undoNotes.action'), () => {
        void runNotesUndo(order.id)
      })
    },
    failureMessage: (field) =>
      field === 'notes' ? t('orderDetail.toast.notesSaveFailed') : t('orderDetail.toast.reportedIssueSaveFailed'),
  })

  const saveNotes = async (nextNotes: string) => {
    if (isLocked || nextNotes === (order.notes ?? '')) return
    await saveField('notes', nextNotes)
  }

  const saveReportedIssue = async (nextIssue: string) => {
    if (isLocked || nextIssue === (order.reportedIssue || order.reported_issue || '')) return
    await saveField('reportedIssue', nextIssue)
  }

  return { saveNotes, saveReportedIssue, runNotesUndo, failures, retry, dismiss }
}
