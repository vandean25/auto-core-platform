import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  downloadWorkshopPdf,
  useGenerateWorkshopPdf,
  useUpdateWorkshopOrder,
} from '@/api/workshop'
import type { WorkshopOrder } from '@/api/types'
import { triggerBlobDownload } from '@/lib/download'
import { getErrorMessage } from '../utils/error'

/** Order-level saves (internal notes, reported issue) and the job card PDF. Saves are ignored once the order is invoiced. */
export function useWorkshopOrderActions(order: WorkshopOrder, isLocked: boolean) {
  const { t } = useTranslation('workshop')
  const updateOrder = useUpdateWorkshopOrder()
  const generateWorkshopPdf = useGenerateWorkshopPdf()

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

  const print = async () => {
    const toastId = toast.loading(t('orderDetail.toast.jobCardPdfGenerating'))
    try {
      const res = await generateWorkshopPdf.mutateAsync(order.id)
      if (res.enqueued) {
        toast.success(t('orderDetail.toast.jobCardPdfQueued'), { id: toastId })
        return
      }

      const blob = await downloadWorkshopPdf(order.id)
      const fileName = `job-card-${order.order_number || order.id}`
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()

      triggerBlobDownload(blob, `${fileName}.pdf`)
      toast.success(t('orderDetail.toast.jobCardPdfDownloaded'), { id: toastId })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('orderDetail.toast.jobCardPdfFailed')), {
        id: toastId,
      })
    }
  }

  return { saveNotes, saveReportedIssue, print }
}
