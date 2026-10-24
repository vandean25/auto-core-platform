import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from '@/api/client'
import { workshopKeys } from '@/api/workshop'
import { createCheckInHttpError } from '@/features/workshop/check-in/check-in-errors'
import { CHECK_IN_ACKNOWLEDGEMENT_VERSION } from '@/features/workshop/check-in/check-in-signature'

const WORKSHOP_API = '/api/workshop'

export type WorkshopCheckIn = components['schemas']['WorkshopCheckInResponseDto']
export type WorkshopCheckInInspection =
  components['schemas']['WorkshopInspectionResponseDto']
export type CheckInDamageMarker =
  components['schemas']['CheckInDamageMarkerDto']
export type CheckInCondition = components['schemas']['CheckInConditionDto']
export type UpdateWorkshopCheckInPayload =
  components['schemas']['UpdateWorkshopCheckInDto']

/** Media row returned by check-in upload routes (not yet in OpenAPI). */
export type WorkshopCheckInMedia = {
  id: string
  purpose: 'CHECK_IN' | 'CHECK_IN_SIGNATURE'
  mime_type: string
  size_bytes: number
  preview_url?: string | null
  processing_status?: 'PENDING' | 'READY' | 'FAILED'
}

export const workshopCheckInKeys = {
  all: [...workshopKeys.all, 'checkIn'] as const,
  record: (orderId: string) =>
    [...workshopCheckInKeys.all, 'record', orderId] as const,
  inspection: (orderId: string) =>
    [...workshopCheckInKeys.all, 'inspection', orderId] as const,
  media: (orderId: string) =>
    [...workshopCheckInKeys.all, 'media', orderId] as const,
}

async function parseCheckInErrorResponse(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as {
    message?: string | string[]
    code?: string
  }
  throw createCheckInHttpError(response, body)
}

export async function fetchWorkshopCheckInRecord(
  orderId: string,
): Promise<WorkshopCheckIn | null> {
  const response = await fetchWithAuth(
    `${WORKSHOP_API}/orders/${orderId}/check-in`,
  )
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    return parseCheckInErrorResponse(response)
  }
  return response.json() as Promise<WorkshopCheckIn>
}

export async function createWorkshopCheckInRecord(
  orderId: string,
  checkInId: string,
): Promise<WorkshopCheckIn> {
  const response = await fetchWithAuth(
    `${WORKSHOP_API}/orders/${orderId}/check-in`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: checkInId }),
    },
  )
  if (!response.ok) {
    return parseCheckInErrorResponse(response)
  }
  return response.json() as Promise<WorkshopCheckIn>
}

export async function updateWorkshopCheckInDraft(
  orderId: string,
  payload: UpdateWorkshopCheckInPayload,
): Promise<WorkshopCheckIn> {
  const response = await fetchWithAuth(
    `${WORKSHOP_API}/orders/${orderId}/check-in`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  if (!response.ok) {
    return parseCheckInErrorResponse(response)
  }
  return response.json() as Promise<WorkshopCheckIn>
}

export type CompleteWorkshopCheckInPayload = {
  expectedRevision: number
  signatureMediaId: string
  signedByName: string
  acknowledgementLocale: 'de' | 'en'
}

export async function completeWorkshopCheckIn(
  orderId: string,
  payload: CompleteWorkshopCheckInPayload,
): Promise<WorkshopCheckIn> {
  const response = await fetchWithAuth(
    `${WORKSHOP_API}/orders/${orderId}/check-in/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_revision: payload.expectedRevision,
        signature_media_id: payload.signatureMediaId,
        signed_by_name: payload.signedByName,
        acknowledgement_version: CHECK_IN_ACKNOWLEDGEMENT_VERSION,
        acknowledgement_locale: payload.acknowledgementLocale,
        acknowledged: true,
      }),
    },
  )
  if (!response.ok) {
    return parseCheckInErrorResponse(response)
  }
  return response.json() as Promise<WorkshopCheckIn>
}

export type WorkshopCheckInMediaUploadResult = {
  media: WorkshopCheckInMedia
  httpStatus: number
}

export async function uploadWorkshopCheckInMedia(
  orderId: string,
  input: {
    file: File
    clientUploadId: string
    expectedRevision: number
    purpose?: 'CHECK_IN' | 'CHECK_IN_SIGNATURE'
  },
): Promise<WorkshopCheckInMediaUploadResult> {
  const form = new FormData()
  form.append('file', input.file)
  form.append('client_upload_id', input.clientUploadId)
  form.append('purpose', input.purpose ?? 'CHECK_IN')
  form.append('expected_revision', String(input.expectedRevision))

  const response = await fetchWithAuth(
    `${WORKSHOP_API}/orders/${orderId}/check-in/media`,
    {
      method: 'POST',
      body: form,
    },
  )
  if (!response.ok) {
    return parseCheckInErrorResponse(response)
  }
  const media = (await response.json()) as WorkshopCheckInMedia
  return { media, httpStatus: response.status }
}

export async function fetchWorkshopCheckInMedia(
  orderId: string,
): Promise<WorkshopCheckInMedia[]> {
  const response = await fetchWithAuth(
    `${WORKSHOP_API}/orders/${orderId}/check-in/media`,
  )
  if (!response.ok) {
    return parseCheckInErrorResponse(response)
  }
  const json = (await response.json()) as { data?: WorkshopCheckInMedia[] }
  return json.data ?? []
}

export function useWorkshopCheckIn(orderId: string, enabled = true) {
  return useQuery<WorkshopCheckIn | null>({
    queryKey: workshopCheckInKeys.record(orderId),
    enabled,
    queryFn: () => fetchWorkshopCheckInRecord(orderId),
  })
}

export function useWorkshopCheckInInspection(orderId: string, enabled = true) {
  return useQuery<WorkshopCheckInInspection>({
    queryKey: workshopCheckInKeys.inspection(orderId),
    enabled,
    queryFn: async () => {
      const response = await fetchWithAuth(
        `${WORKSHOP_API}/orders/${orderId}/check-in/inspection`,
      )
      if (!response.ok) {
        throw new Error('Failed to load check-in inspection')
      }
      return response.json() as Promise<WorkshopCheckInInspection>
    },
  })
}

export function useCreateWorkshopCheckIn() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { orderId: string; checkInId: string }) =>
      createWorkshopCheckInRecord(payload.orderId, payload.checkInId),
    onSuccess: (data, payload) => {
      queryClient.setQueryData(workshopCheckInKeys.record(payload.orderId), data)
    },
  })
}

export function useUpdateWorkshopCheckInDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      orderId: string
      body: UpdateWorkshopCheckInPayload
    }) => updateWorkshopCheckInDraft(payload.orderId, payload.body),
    onSuccess: (data, payload) => {
      queryClient.setQueryData(workshopCheckInKeys.record(payload.orderId), data)
    },
  })
}

export function useCompleteWorkshopCheckIn() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      orderId: string
      expectedRevision: number
      signatureMediaId: string
      signedByName: string
      acknowledgementLocale: 'de' | 'en'
    }) =>
      completeWorkshopCheckIn(payload.orderId, {
        expectedRevision: payload.expectedRevision,
        signatureMediaId: payload.signatureMediaId,
        signedByName: payload.signedByName,
        acknowledgementLocale: payload.acknowledgementLocale,
      }),
    onSuccess: (data, payload) => {
      queryClient.setQueryData(workshopCheckInKeys.record(payload.orderId), data)
    },
  })
}

export function useUploadWorkshopCheckInMedia() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      orderId: string
      file: File
      clientUploadId: string
      expectedRevision: number
      purpose?: 'CHECK_IN' | 'CHECK_IN_SIGNATURE'
    }) =>
      uploadWorkshopCheckInMedia(payload.orderId, {
        file: payload.file,
        clientUploadId: payload.clientUploadId,
        expectedRevision: payload.expectedRevision,
        purpose: payload.purpose,
      }).then((result) => result.media),
    onSuccess: (_data, payload) => {
      void queryClient.invalidateQueries({
        queryKey: workshopCheckInKeys.media(payload.orderId),
      })
      void queryClient.invalidateQueries({
        queryKey: workshopCheckInKeys.record(payload.orderId),
      })
    },
  })
}

export function useWorkshopCheckInMedia(orderId: string, enabled = true) {
  return useQuery({
    queryKey: workshopCheckInKeys.media(orderId),
    enabled,
    queryFn: () => fetchWorkshopCheckInMedia(orderId),
  })
}

export function useUpdateWorkshopCheckInInspection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      orderId: string
      expectedRevision: number
      items: Array<{ id: string; passed?: boolean; notes?: string | null }>
    }) => {
      const response = await fetchWithAuth(
        `${WORKSHOP_API}/orders/${payload.orderId}/check-in/inspection`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expected_revision: payload.expectedRevision,
            items: payload.items,
          }),
        },
      )
      if (!response.ok) {
        return parseCheckInErrorResponse(response)
      }
      const inspection = (await response.json()) as WorkshopCheckInInspection
      await queryClient.fetchQuery({
        queryKey: workshopCheckInKeys.record(payload.orderId),
        queryFn: () => fetchWorkshopCheckInRecord(payload.orderId),
        // The PATCH bumped the revision; never serve the cached (stale) record.
        staleTime: 0,
      })
      return inspection
    },
    onSuccess: (data, payload) => {
      queryClient.setQueryData(
        workshopCheckInKeys.inspection(payload.orderId),
        data,
      )
    },
  })
}
