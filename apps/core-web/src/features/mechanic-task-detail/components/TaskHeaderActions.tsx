import { useTranslation } from 'react-i18next'
import { CheckCircle, Pause, Play, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TaskHeaderActionHandlers, TaskHeaderActionState } from '../task-capabilities'

type TaskHeaderActionsProps = {
  state: TaskHeaderActionState
  handlers: TaskHeaderActionHandlers
}

export function TaskHeaderActions({ state, handlers }: TaskHeaderActionsProps) {
  const { t } = useTranslation('workshop')
  const {
    canStart,
    canSwitch,
    canPause,
    canComplete,
    isNotStarted,
    startPending,
    switchPending,
    pausePending,
    completePending,
  } = state
  const { onStart, onOpenSwitch, onOpenPause, onComplete } = handlers

  return (
    <div className="flex shrink-0 items-center gap-2 flex-wrap justify-start sm:justify-end sm:flex-nowrap">
      {canStart ? (
        <Button
          onClick={onStart}
          disabled={startPending}
          className="min-h-11 min-w-[96px] gap-2"
        >
          <Play className="h-4 w-4" />
          {isNotStarted ? t('mechanic.taskDetail.header.start') : t('mechanic.taskDetail.header.resume')}
        </Button>
      ) : null}
      {canSwitch ? (
        <Button
          variant="outline"
          onClick={onOpenSwitch}
          disabled={switchPending || startPending}
          className="min-h-11 gap-2"
          title={t('mechanic.taskDetail.header.switchTitle')}
        >
          <Zap className="h-4 w-4" />
          {t('mechanic.taskDetail.header.switchHere')}
        </Button>
      ) : null}
      {canPause ? (
        <Button
          variant="outline"
          onClick={onOpenPause}
          disabled={pausePending}
          className="min-h-11 gap-2"
        >
          <Pause className="h-4 w-4" />
          {t('mechanic.taskDetail.header.pause')}
        </Button>
      ) : null}
      {canComplete ? (
        <Button
          variant="outline"
          onClick={onComplete}
          disabled={completePending}
          className="min-h-11 gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        >
          <CheckCircle className="h-4 w-4" />
          {t('mechanic.taskDetail.header.complete')}
        </Button>
      ) : null}
    </div>
  )
}
