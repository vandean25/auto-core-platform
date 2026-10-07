import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'
import { vehicleKeys } from './vehicles'

export type VehicleInspectionRecord =
  components['schemas']['VehicleInspectionRecordResponseDto']
export type CreateVehicleInspectionRecordDto =
  components['schemas']['CreateVehicleInspectionRecordDto']

export const vehicleInspectionKeys = {
  all: (vehicleId: string) => ['vehicle-inspection-records', vehicleId] as const,
}

export function useVehicleInspectionRecords(vehicleId: string) {
  return useQuery<VehicleInspectionRecord[]>({
    queryKey: vehicleInspectionKeys.all(vehicleId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/vehicles/${vehicleId}/inspection-records`,
      )
      if (!response.ok) {
        throw new Error('Failed to load inspection records')
      }
      return response.json()
    },
    enabled: Boolean(vehicleId),
  })
}

export function useCreateVehicleInspectionRecord(vehicleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateVehicleInspectionRecordDto) => {
      const response = await fetchWithAuth(
        `/api/vehicles/${vehicleId}/inspection-records`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
      )
      if (!response.ok) {
        const payload = await response
          .json()
          .catch(() => ({ message: 'Failed to record Pickerl' }))
        throw new Error(payload.message || 'Failed to record Pickerl')
      }
      return response.json() as Promise<VehicleInspectionRecord>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: vehicleInspectionKeys.all(vehicleId),
      })
      queryClient.invalidateQueries({ queryKey: vehicleKeys.detail(vehicleId) })
      queryClient.invalidateQueries({ queryKey: vehicleKeys.pickerlDueAll() })
    },
  })
}
