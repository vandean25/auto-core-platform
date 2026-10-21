import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { components } from './generated/openapi'
import { vehicleStockKeys } from './vehicle-stock'

export type VehicleListingDto = components['schemas']['VehicleListingDto']
export type PatchVehicleListingDto = components['schemas']['PatchVehicleListingDto']
export type PatchVehicleListingChannelDto =
  components['schemas']['PatchVehicleListingChannelDto']
export type VehicleListingExportValidationResponse =
  components['schemas']['VehicleListingExportValidationResponseDto']
export type VehicleListingExportFieldIssue =
  components['schemas']['VehicleListingExportFieldIssueDto']

export const vehicleListingKeys = {
  all: ['vehicle-listing'] as const,
  detail: (vehicleId: string) => [...vehicleListingKeys.all, vehicleId] as const,
  validation: (vehicleId: string) =>
    [...vehicleListingKeys.all, vehicleId, 'validation'] as const,
}

type ApiErrorBody = {
  message?: string
  code?: string
  field_issues?: VehicleListingExportFieldIssue[]
}

async function parseError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as ApiErrorBody
  const message =
    typeof payload.message === 'string' ? payload.message : fallback
  throw Object.assign(new Error(message), {
    status: response.status,
    data: payload,
  })
}

export async function fetchVehicleListing(
  vehicleId: string,
): Promise<VehicleListingDto | null> {
  const response = await fetchWithAuth(`/api/vehicle-stock/${vehicleId}/listing`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    await parseError(response, 'Failed to load marketplace listing')
  }
  return response.json() as Promise<VehicleListingDto>
}

export function useVehicleListing(vehicleId: string) {
  return useQuery({
    queryKey: vehicleListingKeys.detail(vehicleId),
    queryFn: () => fetchVehicleListing(vehicleId),
    enabled: Boolean(vehicleId),
  })
}

export function useVehicleListingValidation(vehicleId: string, enabled = true) {
  return useQuery({
    queryKey: vehicleListingKeys.validation(vehicleId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/vehicle-stock/${vehicleId}/listing/export/validate`,
      )
      if (!response.ok) {
        await parseError(response, 'Failed to validate listing export')
      }
      return response.json() as Promise<VehicleListingExportValidationResponse>
    },
    enabled: Boolean(vehicleId) && enabled,
  })
}

export function useCreateVehicleListing(vehicleId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: components['schemas']['CreateVehicleListingDto']) => {
      const response = await fetchWithAuth(`/api/vehicle-stock/${vehicleId}/listing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        await parseError(response, 'Failed to create marketplace listing')
      }
      return response.json() as Promise<VehicleListingDto>
    },
    onSuccess: (data) => {
      queryClient.setQueryData(vehicleListingKeys.detail(vehicleId), data)
      void queryClient.invalidateQueries({ queryKey: vehicleListingKeys.validation(vehicleId) })
    },
  })
}

export function usePatchVehicleListing(vehicleId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: PatchVehicleListingDto) => {
      const response = await fetchWithAuth(`/api/vehicle-stock/${vehicleId}/listing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        await parseError(response, 'Failed to save marketplace listing')
      }
      return response.json() as Promise<VehicleListingDto>
    },
    onSuccess: (data) => {
      queryClient.setQueryData(vehicleListingKeys.detail(vehicleId), data)
      void queryClient.invalidateQueries({ queryKey: vehicleListingKeys.validation(vehicleId) })
      void queryClient.invalidateQueries({ queryKey: vehicleStockKeys.detail(vehicleId) })
    },
  })
}

export function usePatchVehicleListingChannel(vehicleId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      platform,
      payload,
    }: {
      platform: string
      payload: PatchVehicleListingChannelDto
    }) => {
      const response = await fetchWithAuth(
        `/api/vehicle-stock/${vehicleId}/listing/channels/${platform}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!response.ok) {
        await parseError(response, 'Failed to update listing channel')
      }
      return response.json() as Promise<VehicleListingDto>
    },
    onSuccess: (data) => {
      queryClient.setQueryData(vehicleListingKeys.detail(vehicleId), data)
      void queryClient.invalidateQueries({ queryKey: vehicleListingKeys.validation(vehicleId) })
    },
  })
}
