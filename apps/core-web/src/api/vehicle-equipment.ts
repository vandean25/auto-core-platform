import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { components } from './generated/openapi'
import { vehicleListingKeys } from './vehicle-listing'

export type VehicleEquipmentAssignment =
  components['schemas']['VehicleEquipmentAssignmentDto']
export type VehicleEquipmentAssertion =
  components['schemas']['VehicleEquipmentAssertion']

export const vehicleEquipmentKeys = {
  all: ['vehicle-equipment'] as const,
  options: () => [...vehicleEquipmentKeys.all, 'options'] as const,
  assignment: (vehicleId: string) =>
    [...vehicleEquipmentKeys.all, 'assignment', vehicleId] as const,
}

async function parseError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { message?: string }
  throw Object.assign(new Error(payload.message || fallback), {
    status: response.status,
    data: payload,
  })
}

export function useVehicleEquipmentOptions() {
  return useQuery({
    queryKey: vehicleEquipmentKeys.options(),
    queryFn: async () => {
      const response = await fetchWithAuth('/api/vehicle-equipment-options')
      if (!response.ok) {
        await parseError(response, 'Failed to load equipment options')
      }
      const body = (await response.json()) as components['schemas']['VehicleEquipmentOptionListResponseDto']
      return body.data
    },
  })
}

export function useVehicleEquipmentAssignment(vehicleId: string) {
  return useQuery({
    queryKey: vehicleEquipmentKeys.assignment(vehicleId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vehicle-stock/${vehicleId}/equipment`)
      if (!response.ok) {
        await parseError(response, 'Failed to load vehicle equipment')
      }
      return response.json() as Promise<VehicleEquipmentAssignment>
    },
    enabled: Boolean(vehicleId),
  })
}

export function useReplaceVehicleEquipment(vehicleId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: components['schemas']['ReplaceVehicleEquipmentDto']) => {
      const response = await fetchWithAuth(`/api/vehicle-stock/${vehicleId}/equipment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        await parseError(response, 'Failed to save vehicle equipment')
      }
      return response.json() as Promise<VehicleEquipmentAssignment>
    },
    onSuccess: (data) => {
      queryClient.setQueryData(vehicleEquipmentKeys.assignment(vehicleId), data)
      void queryClient.invalidateQueries({
        queryKey: vehicleListingKeys.validation(vehicleId),
      })
    },
  })
}
