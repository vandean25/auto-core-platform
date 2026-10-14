import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from '@/api/client'
import type { components } from '@/api/generated/openapi'
import { workshopKeys } from '@/api/workshop'
import { workshopEstimateKeys } from '@/api/workshop-estimates'

export type ResumeWaitingTasksResponse = components['schemas']['WorkshopResumeWaitingTasksResponseDto']

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
        const payload = (await response.json().catch(() => ({}))) as { message?: unknown }
        const message =
          typeof payload.message === 'string' && payload.message.trim()
            ? payload.message
            : 'Wartende Aufgaben konnten nicht fortgesetzt werden.'
        throw Object.assign(new Error(message), { status: response.status, data: payload })
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
