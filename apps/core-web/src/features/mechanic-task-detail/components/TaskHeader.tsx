import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import type { MechanicTaskDetail } from '@/api/mechanic'
import { TaskHeaderActions } from './TaskHeaderActions'

type TaskHeaderProps = {
  task: MechanicTaskDetail
  canStart: boolean
  canSwitch: boolean
  canPause: boolean
  canComplete: boolean
  isDone: boolean
  isNotStarted: boolean
  startPending: boolean
  switchPending: boolean
  pausePending: boolean
  completePending: boolean
  onBack: () => void
  onStart: () => void
  onOpenSwitch: () => void
  onOpenPause: () => void
  onComplete: () => void
}

export function TaskHeader({
  task,
  canStart,
  canSwitch,
  canPause,
  canComplete,
  isDone,
  isNotStarted,
  startPending,
  switchPending,
  pausePending,
  completePending,
  onBack,
  onStart,
  onOpenSwitch,
  onOpenPause,
  onComplete,
}: TaskHeaderProps) {
  const { t } = useTranslation('workshop')

  return (
    <div className="flex items-start justify-between gap-4">
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

      {!isDone ? (
        <TaskHeaderActions
          canStart={canStart}
          canSwitch={canSwitch}
          canPause={canPause}
          canComplete={canComplete}
          isNotStarted={isNotStarted}
          startPending={startPending}
          switchPending={switchPending}
          pausePending={pausePending}
          completePending={completePending}
          onStart={onStart}
          onOpenSwitch={onOpenSwitch}
          onOpenPause={onOpenPause}
          onComplete={onComplete}
        />
      ) : null}
    </div>
  )
}
