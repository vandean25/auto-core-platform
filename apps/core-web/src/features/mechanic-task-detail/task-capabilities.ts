import type { MechanicTaskDetail } from '@/api/mechanic'

type TaskStatus = MechanicTaskDetail['taskStatus']

export function getTaskCapabilities(taskStatus: TaskStatus) {
  const isActive = taskStatus === 'IN_PROGRESS'
  const isNotStarted = taskStatus === 'NOT_STARTED'
  const isPaused =
    taskStatus === 'PAUSED' ||
    taskStatus === 'WAITING_PARTS' ||
    taskStatus === 'WAITING_CUSTOMER'
  const isDone = taskStatus === 'DONE'
  const canStart = isNotStarted || isPaused

  return {
    canStart,
    canSwitch: canStart,
    canPause: isActive,
    canComplete: isActive,
    isDone,
    isNotStarted,
  }
}
