import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJsonWithAuth, throwApiResponseError } from './api-error'
import { fetchWithAuth } from './client'
import type { components } from './generated/openapi'

export type PushDevice = components['schemas']['PushDeviceDto']
export type PushPreferences = components['schemas']['PushPreferencesDto']
export type PushUserEventType = components['schemas']['PushUserEventType']
export type RegisterPushDevicePayload = components['schemas']['RegisterPushDeviceDto']

/** The events the server sends today. WORKSHOP_ORDER_READY is accepted by the API but not emitted yet, so it is not offered. */
export const PUSH_USER_EVENT_TYPES = [
  'CUSTOMER_ESTIMATE_DECIDED',
  'WORKSHOP_TASK_WAITING_CUSTOMER',
] as const satisfies readonly PushUserEventType[]

export const pushKeys = {
  all: ['push'] as const,
  devices: () => [...pushKeys.all, 'devices'] as const,
  preferences: () => [...pushKeys.all, 'preferences'] as const,
}

const PUSH_BASE = '/api/v1/me/push'

/** Also used outside React (sign-out, tenant switch), so it is a plain function. */
export function registerPushDevice(payload: RegisterPushDevicePayload): Promise<PushDevice> {
  return fetchJsonWithAuth<PushDevice>(`${PUSH_BASE}/devices`, 'Failed to register the push device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function revokePushDevice(deviceId: string): Promise<void> {
  const response = await fetchWithAuth(`${PUSH_BASE}/devices/${deviceId}`, { method: 'DELETE' })
  // A device that is already gone (404) is the state we wanted.
  if (!response.ok && response.status !== 404) {
    await throwApiResponseError(response, 'Failed to remove the push device')
  }
}

/** The caller's active devices. Also used outside React (keep-alive), so it is a plain function. */
export function listPushDevices(): Promise<PushDevice[]> {
  return fetchJsonWithAuth<PushDevice[]>(`${PUSH_BASE}/devices`, 'Failed to load push devices')
}

export function usePushDevices(enabled = true) {
  return useQuery<PushDevice[]>({ queryKey: pushKeys.devices(), enabled, queryFn: listPushDevices })
}

export function usePushPreferences() {
  return useQuery<PushPreferences>({
    queryKey: pushKeys.preferences(),
    queryFn: () => fetchJsonWithAuth<PushPreferences>(`${PUSH_BASE}/preferences`, 'Failed to load push settings'),
  })
}

export function useUpdatePushPreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: PushPreferences) =>
      fetchJsonWithAuth<PushPreferences>(`${PUSH_BASE}/preferences`, 'Failed to save push settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(pushKeys.preferences(), saved)
    },
  })
}

export function useRevokePushDevice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: revokePushDevice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pushKeys.devices() }),
  })
}

export function useSendTestPush() {
  return useMutation({
    mutationFn: () =>
      fetchJsonWithAuth<{ id: string }>(`${PUSH_BASE}/test`, 'Failed to send the test push', { method: 'POST' }),
  })
}
