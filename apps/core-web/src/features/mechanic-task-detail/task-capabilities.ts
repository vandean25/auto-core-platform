import type { MechanicTaskDetail } from '@/api/mechanic'

type TaskStatus = MechanicTaskDetail['taskStatus']

export type TaskCapabilityInput = {
  taskStatus: TaskStatus
  hasOpenLaborEntry: boolean
}

export function getTaskCapabilities({
  taskStatus,
  hasOpenLaborEntry,
}: TaskCapabilityInput) {
  const isNotStarted = taskStatus === 'NOT_STARTED'
  const isPaused =
    taskStatus === 'PAUSED' ||
    taskStatus === 'WAITING_PARTS' ||
    taskStatus === 'WAITING_CUSTOMER'
  const isInProgress = taskStatus === 'IN_PROGRESS'
  const isDone = taskStatus === 'DONE'
  const isClockedOutInProgress = isInProgress && !hasOpenLaborEntry
  const canStart = isNotStarted || isPaused || isClockedOutInProgress

  return {
    canStart,
    canSwitch: isNotStarted || isPaused,
    canPause: isInProgress && hasOpenLaborEntry,
    canComplete: isInProgress,
    isDone,
    isNotStarted,
  }
}

export type TaskCapabilities = ReturnType<typeof getTaskCapabilities>

export type TaskHeaderActionState = Pick<
  TaskCapabilities,
  'canStart' | 'canSwitch' | 'canPause' | 'canComplete' | 'isNotStarted'
> & {
  startPending: boolean
  switchPending: boolean
  pausePending: boolean
  completePending: boolean
}

export type TaskHeaderActionHandlers = {
  onStart: () => void
  onOpenSwitch: () => void
  onOpenPause: () => void
  onComplete: () => void
}

type TaskLifecyclePendingSource = {
  startTask: { isPending: boolean }
  switchTask: { isPending: boolean }
  pauseTask: { isPending: boolean }
  completeTask: { isPending: boolean }
}

export function buildTaskHeaderActionState(
  capabilities: TaskCapabilities,
  lifecycle: TaskLifecyclePendingSource,
): TaskHeaderActionState {
  return {
    canStart: capabilities.canStart,
    canSwitch: capabilities.canSwitch,
    canPause: capabilities.canPause,
    canComplete: capabilities.canComplete,
    isNotStarted: capabilities.isNotStarted,
    startPending: lifecycle.startTask.isPending,
    switchPending: lifecycle.switchTask.isPending,
    pausePending: lifecycle.pauseTask.isPending,
    completePending: lifecycle.completeTask.isPending,
  }
}
