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
