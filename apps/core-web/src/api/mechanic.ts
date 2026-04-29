import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'

export type MechanicQueueItem = components['schemas']['MechanicQueueItemDto']
export type MechanicQueueResponse = components['schemas']['MechanicQueueResponseDto']
export type MechanicTaskDetail = components['schemas']['MechanicTaskDetailDto']
export type SwitchTaskPayload = components['schemas']['SwitchTaskDto']
export type PauseTaskPayload = components['schemas']['PauseTaskDto']
export type SaveDiagnosticsPayload = components['schemas']['SaveDiagnosticsDto']
export type SaveDiagnosticsResponse = components['schemas']['SaveDiagnosticsResponseDto']
export type RequestPartPayload = components['schemas']['RequestPartDto']
export type RequestPartResponse = components['schemas']['RequestPartResponseDto']
export type RequestMediaUploadPayload = components['schemas']['RequestMediaUploadDto']
export type MediaUploadPolicy = components['schemas']['MediaUploadPolicyDto']
export type CreateMediaPayload = components['schemas']['CreateMediaDto']
export type WorkshopMedia = components['schemas']['WorkshopMediaDto']

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

/** Throws an Error with an attached `.status` so callers can detect HTTP 409 / etc. */
async function throwHttpError(response: Response, fallback: string): Promise<never> {
  const message = await getErrorMessage(response, fallback)
  const err = new Error(message) as Error & { status: number }
  err.status = response.status
  throw err
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
        return throwHttpError(response, 'Failed to start task')
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
        // Expose HTTP status so callers can implement 409 → start fallback
        return throwHttpError(response, 'Failed to switch task')
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
        return throwHttpError(response, 'Failed to pause task')
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
        return throwHttpError(response, 'Failed to complete task')
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

export function useSaveDiagnostics() {
  return useMutation({
    mutationFn: async ({
      mechanicId,
      taskId,
      payload,
    }: {
      mechanicId: string
      taskId: string
      payload: SaveDiagnosticsPayload
    }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/diagnostics?mechanicId=${encodeURIComponent(mechanicId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response.ok) {
        return throwHttpError(response, 'Failed to save diagnostics')
      }
      return response.json() as Promise<SaveDiagnosticsResponse>
    },
  })
}

export function useRequestPart() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      mechanicId,
      taskId,
      payload,
    }: {
      mechanicId: string
      taskId: string
      payload: RequestPartPayload
    }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/parts?mechanicId=${encodeURIComponent(mechanicId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response.ok) {
        return throwHttpError(response, 'Failed to request part')
      }
      return response.json() as Promise<RequestPartResponse>
    },
    onSuccess: (_data, { mechanicId, taskId }) => {
      void queryClient.invalidateQueries({
        queryKey: mechanicQueueKeys.taskDetail(mechanicId, taskId),
      })
    },
  })
}

export function useCreateMediaUploadPolicy() {
  return useMutation({
    mutationFn: async ({
      mechanicId,
      taskId,
      payload,
    }: {
      mechanicId: string
      taskId: string
      payload: RequestMediaUploadPayload
    }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/media/uploads?mechanicId=${encodeURIComponent(mechanicId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response.ok) {
        return throwHttpError(response, 'Failed to get upload policy')
      }
      return response.json() as Promise<MediaUploadPolicy>
    },
  })
}

export function useSaveMediaMetadata() {
  return useMutation({
    mutationFn: async ({
      mechanicId,
      taskId,
      payload,
    }: {
      mechanicId: string
      taskId: string
      payload: CreateMediaPayload
    }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/media?mechanicId=${encodeURIComponent(mechanicId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response.ok) {
        return throwHttpError(response, 'Failed to save media metadata')
      }
      return response.json() as Promise<WorkshopMedia>
    },
  })
}
