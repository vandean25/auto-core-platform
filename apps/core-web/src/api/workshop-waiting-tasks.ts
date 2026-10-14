import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from '@/api/client'
import type { components } from '@/api/generated/openapi'
import { workshopKeys } from '@/api/workshop'
import { workshopEstimateKeys } from '@/api/workshop-estimates'

export type ResumeWaitingTasksResponse = components['schemas']['WorkshopResumeWaitingTasksResponseDto']

const RESUME_FALLBACK_MESSAGE = 'Wartende Aufgaben konnten nicht fortgesetzt werden.'

/** German copy for the answers the resume action can give. The server message is English, so it is not shown. */
const RESUME_ERROR_MESSAGES: Partial<Record<string, string>> = {
  WORKSHOP_TASK_CHANGED: 'Die Aufgaben wurden gerade geändert. Bitte neu laden und erneut versuchen.',
  WORKSHOP_ORDER_NOT_OPEN: 'Der Auftrag ist nicht mehr offen. Wartende Aufgaben können nicht fortgesetzt werden.',
  ESTIMATE_ROLE_FORBIDDEN: 'Für diese Aktion fehlt die Berechtigung.',
  WORKSHOP_ROLE_FORBIDDEN: 'Für diese Aktion fehlt die Berechtigung.',
}

/** The German message for a failed resume, by the server's error code. */
export function resumeWaitingErrorMessage(code: unknown): string {
  return (typeof code === 'string' && RESUME_ERROR_MESSAGES[code]) || RESUME_FALLBACK_MESSAGE
}

/**
 * Advisor action "Resume waiting tasks" (AUT-355, ADR-0025 §9). Approval never resumes a task by itself, so the
 * advisor does it here. The order and its estimate read again, since the task states change.
 */
export function useResumeWaitingTasks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await fetchWithAuth(`/api/workshop/orders/${orderId}/tasks/resume-waiting`, { method: 'POST' })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { code?: unknown }
        const message = resumeWaitingErrorMessage(payload.code)
        throw Object.assign(new Error(message), { status: response.status, data: { code: payload.code, message } })
      }
      return (await response.json()) as ResumeWaitingTasksResponse
    },
    onSuccess: (_result, orderId) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: workshopKeys.detail(orderId) }),
        queryClient.invalidateQueries({ queryKey: workshopEstimateKeys.order(orderId) }),
      ]),
  })
}
