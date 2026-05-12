import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'
import { createHttpError } from '@/lib/error-utils'

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
export type VoiceNoteDraftResponse = components['schemas']['VoiceNoteDraftResponseDto']

export const mechanicQueueKeys = {
  all: ['mechanic'] as const,
  queue: () => [...mechanicQueueKeys.all, 'queue'] as const,
  taskDetail: (taskId: string) => [...mechanicQueueKeys.all, 'task', taskId] as const,
}

/** Reads error message from a failed HTTP Response body. */
async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => undefined)) as
    | { message?: string }
    | undefined
  return payload?.message ?? fallback
}

/**
 * Reads the error message from the response body and throws an error with the
 * HTTP status attached. Callers can use `getErrorStatus()` from `@/lib/error-utils`
 * to extract the status and branch on specific codes (e.g. 409 Conflict).
 */
async function throwHttpError(response: Response, fallback: string): Promise<never> {
  const message = await getErrorMessage(response, fallback)
  throw createHttpError(message, response.status)
}

export function useMechanicQueue() {
  return useQuery<MechanicQueueResponse>({
    queryKey: mechanicQueueKeys.queue(),
    queryFn: async () => {
      const response = await fetchWithAuth('/api/mechanic/queue')
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to load mechanic queue'))
      }
      return response.json() as Promise<MechanicQueueResponse>
    },
  })
}

export function useMechanicTaskDetail(taskId: string) {
  return useQuery<MechanicTaskDetail>({
    queryKey: mechanicQueueKeys.taskDetail(taskId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/mechanic/tasks/${encodeURIComponent(taskId)}`)
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to load task detail'))
      }
      return response.json() as Promise<MechanicTaskDetail>
    },
    enabled: !!taskId,
  })
}

export function useStartTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ taskId }: { taskId: string }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/start`,
        { method: 'POST' },
      )
      if (!response.ok) {
        return throwHttpError(response, 'Failed to start task')
      }
      return response.json() as Promise<MechanicTaskDetail>
    },
    onSuccess: (_data, { taskId }) => {
      void queryClient.invalidateQueries({ queryKey: mechanicQueueKeys.queue() })
      void queryClient.invalidateQueries({
        queryKey: mechanicQueueKeys.taskDetail(taskId),
      })
    },
  })
}

export function useSwitchTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      taskId,
      payload,
    }: {
      taskId: string
      payload: SwitchTaskPayload
    }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/switch`,
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
    onSuccess: (_data, { taskId }) => {
      void queryClient.invalidateQueries({ queryKey: mechanicQueueKeys.queue() })
      void queryClient.invalidateQueries({
        queryKey: mechanicQueueKeys.taskDetail(taskId),
      })
    },
  })
}

export function usePauseTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      taskId,
      payload,
    }: {
      taskId: string
      payload: PauseTaskPayload
    }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/pause`,
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
    onSuccess: (_data, { taskId }) => {
      void queryClient.invalidateQueries({ queryKey: mechanicQueueKeys.queue() })
      void queryClient.invalidateQueries({
        queryKey: mechanicQueueKeys.taskDetail(taskId),
      })
    },
  })
}

export function useCompleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ taskId }: { taskId: string }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/complete`,
        { method: 'POST' },
      )
      if (!response.ok) {
        return throwHttpError(response, 'Failed to complete task')
      }
      return response.json() as Promise<MechanicTaskDetail>
    },
    onSuccess: (_data, { taskId }) => {
      void queryClient.invalidateQueries({ queryKey: mechanicQueueKeys.queue() })
      void queryClient.invalidateQueries({
        queryKey: mechanicQueueKeys.taskDetail(taskId),
      })
    },
  })
}

export function useSaveDiagnostics() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      taskId,
      payload,
    }: {
      taskId: string
      payload: SaveDiagnosticsPayload
    }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/diagnostics`,
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
    onSuccess: (_data, { taskId }) => {
      void queryClient.invalidateQueries({
        queryKey: mechanicQueueKeys.taskDetail(taskId),
      })
    },
  })
}

export function useRequestPart() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      taskId,
      payload,
    }: {
      taskId: string
      payload: RequestPartPayload
    }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/parts`,
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
    onSuccess: (_data, { taskId }) => {
      void queryClient.invalidateQueries({
        queryKey: mechanicQueueKeys.taskDetail(taskId),
      })
    },
  })
}

export function useCreateMediaUploadPolicy() {
  return useMutation({
    mutationFn: async ({
      taskId,
      payload,
    }: {
      taskId: string
      payload: RequestMediaUploadPayload
    }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/media/uploads`,
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
      taskId,
      payload,
    }: {
      taskId: string
      payload: CreateMediaPayload
    }) => {
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/media`,
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

/**
 * Uploads a voice-note audio file (`multipart/form-data`) and returns a
 * transcribed/translated diagnostic-note draft (`VoiceNoteDraftResponse`).
 *
 * The draft is **not** persisted automatically.  The mechanic must review it
 * and submit it via `useSaveDiagnostics` (PATCH /diagnostics), which handles
 * task-detail cache invalidation.
 *
 * ADR-0014 §5.3
 */
export function useUploadVoiceNote() {
  return useMutation({
    mutationFn: async ({
      taskId,
      audio,
    }: {
      taskId: string
      audio: File | Blob
    }) => {
      if (!audio.type) {
        throw createHttpError(
          'Audio file must have a known MIME type (e.g. audio/webm, audio/mp4).',
          422,
        )
      }
      const form = new FormData()
      form.append('audio', audio)
      const response = await fetchWithAuth(
        `/api/mechanic/tasks/${encodeURIComponent(taskId)}/voice-notes`,
        { method: 'POST', body: form },
      )
      if (!response.ok) {
        return throwHttpError(response, 'Failed to upload voice note')
      }
      return response.json() as Promise<VoiceNoteDraftResponse>
    },
  })
}
