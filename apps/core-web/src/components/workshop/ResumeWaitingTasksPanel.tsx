import { useTranslation } from 'react-i18next'
import { Loader2, PlayCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useResumeWaitingTasks } from '@/api/workshop-waiting-tasks'
import { isWorkshopEstimateOrderOpen } from '@/features/workshop/workshop-estimate-permissions'
import { getErrorMessage } from '@/lib/error-utils'

export interface ResumeWaitingTasksPanelProps {
  orderId: string
  /** Tasks in WAITING_CUSTOMER. The panel is hidden when none waits. */
  waitingCount: number
  orderStatus: string
}

/**
 * Advisor action "Resume waiting tasks" (AUT-355, ADR-0025 §9). An approval never resumes a task by itself, so the
 * advisor decides here when the work continues. The backend checks the role and the open-order rule as well.
 */
export function ResumeWaitingTasksPanel({ orderId, waitingCount, orderStatus }: ResumeWaitingTasksPanelProps) {
  const { t } = useTranslation('workshop')
  const resume = useResumeWaitingTasks()
  if (waitingCount === 0 || !isWorkshopEstimateOrderOpen(orderStatus)) {
    return null
  }

  const handleResume = async () => {
    try {
      const result = await resume.mutateAsync(orderId)
      toast.success(t('resumeWaitingTasks.success', { count: result.resumed_task_ids.length }))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('resumeWaitingTasks.error')))
    }
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 p-4"
      data-testid="resume-waiting-tasks-panel"
    >
      <p className="text-sm text-sky-900">
        {t('resumeWaitingTasks.description', { count: waitingCount })}
      </p>
      <Button size="sm" onClick={() => void handleResume()} disabled={resume.isPending}>
        {resume.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
        {t('resumeWaitingTasks.button')}
      </Button>
    </div>
  )
}
