import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from './client'
import { normalizeApiError, throwApiResponseError } from './api-error'
import { tyreStorageKeys } from './tyre-storage'
import { workshopKeys } from './workshop'
import { tyreMeasurementKeys } from './tyre-measurement-keys'
import { useAuthSession } from './auth-session'

export type TyreMeasurement = components['schemas']['TyreMeasurementResponseDto']
export type TyreWheel = components['schemas']['TyreWheelResponseDto']
export type CreateTyreMeasurement = components['schemas']['CreateTyreMeasurementDto']
export type CreateTyreWheel = components['schemas']['CreateTyreWheelDto']
export type TyreMeasurementParent = { kind: 'order' | 'check-in'; id: string }

type TyreMeasurementListResponse = components['schemas']['TyreMeasurementListResponseDto']

function tyreMeasurementsUrl(parent: TyreMeasurementParent): string {
  const resource = parent.kind === 'order' ? 'workshop-orders' : 'workshop-check-ins'
  return `/api/${resource}/${parent.id}/tyre-measurements`
}

export async function fetchTyreMeasurements(
  parent: TyreMeasurementParent,
): Promise<TyreMeasurementListResponse> {
  const response = await fetchWithAuth(tyreMeasurementsUrl(parent))
  if (!response.ok) {
    await throwApiResponseError(response, 'Failed to load tyre measurements')
  }
  return response.json() as Promise<TyreMeasurementListResponse>
}

export async function createTyreMeasurement(
  parent: TyreMeasurementParent,
  body: CreateTyreMeasurement,
): Promise<TyreMeasurement> {
  if (!navigator.onLine) throw new TypeError('Failed to fetch')
  const response = await fetchWithAuth(tyreMeasurementsUrl(parent), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwApiResponseError(response, 'Failed to create tyre measurement')
  }
  return response.json() as Promise<TyreMeasurement>
}

export function useTyreMeasurements(parent: TyreMeasurementParent, enabled = true) {
  const siteId = useAuthSession().data?.activeSiteId ?? null
  const query = useQuery({
    queryKey: tyreMeasurementKeys.list(parent, siteId),
    queryFn: () => fetchTyreMeasurements(parent),
    enabled,
  })
  const status = normalizeApiError(query.error)?.status
  const accessRejected = status === 401 || status === 403 || status === 404
  return { ...query, data: accessRejected ? undefined : query.data }
}

export function useCreateTyreMeasurement(parent: TyreMeasurementParent) {
  const queryClient = useQueryClient()
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: (body: CreateTyreMeasurement) => createTyreMeasurement(parent, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tyreMeasurementKeys.all })
      queryClient.invalidateQueries({ queryKey: tyreStorageKeys.all })
      queryClient.invalidateQueries({ queryKey: workshopKeys.all })
    },
  })
}
