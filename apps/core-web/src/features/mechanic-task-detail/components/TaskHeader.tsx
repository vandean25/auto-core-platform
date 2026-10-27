import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import type { MechanicTaskDetail } from '@/api/mechanic'
import type { TaskHeaderActionHandlers, TaskHeaderActionState } from '../task-capabilities'
import { TaskHeaderActions } from './TaskHeaderActions'

type TaskHeaderProps = {
  task: MechanicTaskDetail
  isDone: boolean
  onBack: () => void
  actionState: TaskHeaderActionState
  actionHandlers: TaskHeaderActionHandlers
}

export function TaskHeader({
  task,
  isDone,
  onBack,
  actionState,
  actionHandlers,
}: TaskHeaderProps) {
  const { t } = useTranslation('workshop')

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          className="mt-0.5 min-h-11 min-w-11 shrink-0"
          onClick={onBack}
          aria-label={t('mechanic.taskDetail.header.backAria')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">{task.taskTitle}</h1>
            <StatusBadge status={task.taskStatus} />
          </div>
          <p className="text-slate-500 text-sm mt-0.5">
            {t('mechanic.taskDetail.header.order', { orderNumber: task.orderNumber })}
          </p>
        </div>
      </div>

      {!isDone ? <TaskHeaderActions state={actionState} handlers={actionHandlers} /> : null}
    </div>
  )
}
