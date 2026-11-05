import type { WorkshopTaskStatus } from '@/api/types'

export type WorkshopTaskUpdateEligibilityVariables = {
  status?: WorkshopTaskStatus
}

/** ADR-0036 R1: task status patches are optimistically eligible; title/notes stay server-confirmed. */
export function isWorkshopTaskStatusUpdateOptimisticEligible(
  variables: WorkshopTaskUpdateEligibilityVariables,
): boolean {
  return variables.status !== undefined
}
