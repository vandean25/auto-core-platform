import { ArrowLeft, CheckCircle, Pause, Play, Zap } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import type { MechanicTaskDetail } from '@/api/mechanic'

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
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 shrink-0"
          onClick={onBack}
          aria-label="Back to queue"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">{task.taskTitle}</h1>
            <StatusBadge status={task.taskStatus} />
          </div>
          <p className="text-slate-500 text-sm mt-0.5">Order {task.orderNumber}</p>
        </div>
      </div>

      {!isDone && (
        <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end sm:flex-nowrap">
          {canStart && (
            <Button
              onClick={onStart}
              disabled={startPending}
              className="min-h-[44px] min-w-[96px] gap-2"
            >
              <Play className="h-4 w-4" />
              {isNotStarted ? 'Start' : 'Resume'}
            </Button>
          )}
          {canSwitch && (
            <Button
              variant="outline"
              onClick={onOpenSwitch}
              disabled={switchPending || startPending}
              className="min-h-[44px] gap-2"
              title="Switch from another task to this one"
            >
              <Zap className="h-4 w-4" />
              Switch Here
            </Button>
          )}
          {canPause && (
            <Button
              variant="outline"
              onClick={onOpenPause}
              disabled={pausePending}
              className="min-h-[44px] gap-2"
            >
              <Pause className="h-4 w-4" />
              Pause
            </Button>
          )}
          {canComplete && (
            <Button
              variant="outline"
              onClick={onComplete}
              disabled={completePending}
              className="min-h-[44px] gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              <CheckCircle className="h-4 w-4" />
              Complete
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
