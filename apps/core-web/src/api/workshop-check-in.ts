import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from '@/api/client'
import { workshopKeys } from '@/api/workshop'

const WORKSHOP_API = '/api/workshop'

export type WorkshopCheckIn = components['schemas']['WorkshopCheckInResponseDto']
export type WorkshopCheckInInspection =
  components['schemas']['WorkshopInspectionResponseDto']

export const workshopCheckInKeys = {
  all: [...workshopKeys.all, 'checkIn'] as const,
  record: (orderId: string) =>
    [...workshopCheckInKeys.all, 'record', orderId] as const,
  inspection: (orderId: string) =>
    [...workshopCheckInKeys.all, 'inspection', orderId] as const,
}

export function useWorkshopCheckIn(orderId: string, enabled = true) {
  return useQuery<WorkshopCheckIn>({
    queryKey: workshopCheckInKeys.record(orderId),
    enabled,
    queryFn: async () => {
      const response = await fetchWithAuth(
        `${WORKSHOP_API}/orders/${orderId}/check-in`,
      )
      if (!response.ok) {
        throw new Error('Failed to load workshop check-in')
      }
      return response.json() as Promise<WorkshopCheckIn>
    },
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
        throw new Error('Failed to update check-in inspection')
      }
      return response.json() as Promise<WorkshopCheckInInspection>
    },
    onSuccess: (_data, payload) => {
      void queryClient.invalidateQueries({
        queryKey: workshopCheckInKeys.inspection(payload.orderId),
      })
      void queryClient.invalidateQueries({
        queryKey: workshopCheckInKeys.record(payload.orderId),
      })
    },
  })
}
