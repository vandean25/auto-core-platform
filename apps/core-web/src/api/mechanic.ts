import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'

export type MechanicQueueItem = components['schemas']['MechanicQueueItemDto']
export type MechanicQueueResponse = components['schemas']['MechanicQueueResponseDto']
export type MechanicTaskDetail = components['schemas']['MechanicTaskDetailDto']
export type SwitchTaskPayload = components['schemas']['SwitchTaskDto']
export type PauseTaskPayload = components['schemas']['PauseTaskDto']

export const mechanicQueueKeys = {
  all: ['mechanic'] as const,
  queue: (mechanicId: string) => [...mechanicQueueKeys.all, 'queue', mechanicId] as const,
  taskDetail: (mechanicId: string, taskId: string) =>
    [...mechanicQueueKeys.all, 'task', mechanicId, taskId] as const,
}

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => undefined)) as
    | { message?: string }
    | undefined
  return payload?.message ?? fallback
}

export function useMechanicQueue(mechanicId: string) {
  return useQuery<MechanicQueueResponse>({
    queryKey: mechanicQueueKeys.queue(mechanicId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/mechanic/queue?mechanicId=${encodeURIComponent(mechanicId)}`,
      )
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to load mechanic queue'))
      }
      return response.json() as Promise<MechanicQueueResponse>
    },
    enabled: !!mechanicId,
  })
}

export function useMechanicTaskDetail(mechanicId: string, taskId: string) {
  return useQuery<MechanicTaskDetail>({
    queryKey: mechanicQueueKeys.taskDetail(mechanicId, taskId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}?mechanicId=${encodeURIComponent(mechanicId)}`,
      )
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to load task detail'))
      }
      return response.json() as Promise<MechanicTaskDetail>
    },
    enabled: !!mechanicId && !!taskId,
  })
}

export function useStartTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ mechanicId, taskId }: { mechanicId: string; taskId: string }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/start?mechanicId=${encodeURIComponent(mechanicId)}`,
        { method: 'POST' },
      )
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to start task'))
      }
      return response.json() as Promise<MechanicTaskDetail>
    },
    onSuccess: (_data, { mechanicId, taskId }) => {
      void queryClient.invalidateQueries({ queryKey: mechanicQueueKeys.queue(mechanicId) })
      void queryClient.invalidateQueries({
        queryKey: mechanicQueueKeys.taskDetail(mechanicId, taskId),
      })
    },
  })
}

export function useSwitchTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      mechanicId,
      taskId,
      payload,
    }: {
      mechanicId: string
      taskId: string
      payload: SwitchTaskPayload
    }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/switch?mechanicId=${encodeURIComponent(mechanicId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to switch task'))
      }
      return response.json() as Promise<MechanicTaskDetail>
    },
    onSuccess: (_data, { mechanicId, taskId }) => {
      void queryClient.invalidateQueries({ queryKey: mechanicQueueKeys.queue(mechanicId) })
      void queryClient.invalidateQueries({
        queryKey: mechanicQueueKeys.taskDetail(mechanicId, taskId),
      })
    },
  })
}

export function usePauseTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      mechanicId,
      taskId,
      payload,
    }: {
      mechanicId: string
      taskId: string
      payload: PauseTaskPayload
    }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/pause?mechanicId=${encodeURIComponent(mechanicId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to pause task'))
      }
      return response.json() as Promise<MechanicTaskDetail>
    },
    onSuccess: (_data, { mechanicId, taskId }) => {
      void queryClient.invalidateQueries({ queryKey: mechanicQueueKeys.queue(mechanicId) })
      void queryClient.invalidateQueries({
        queryKey: mechanicQueueKeys.taskDetail(mechanicId, taskId),
      })
    },
  })
}

export function useCompleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ mechanicId, taskId }: { mechanicId: string; taskId: string }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/complete?mechanicId=${encodeURIComponent(mechanicId)}`,
        { method: 'POST' },
      )
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to complete task'))
      }
      return response.json() as Promise<MechanicTaskDetail>
    },
    onSuccess: (_data, { mechanicId, taskId }) => {
      void queryClient.invalidateQueries({ queryKey: mechanicQueueKeys.queue(mechanicId) })
      void queryClient.invalidateQueries({
        queryKey: mechanicQueueKeys.taskDetail(mechanicId, taskId),
      })
    },
  })
}
