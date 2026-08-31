import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Vehicle } from './types'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { buildDataTableUrl } from './data-table-query'
import type { components } from './generated/openapi'

type CreateVehicleDto = components['schemas']['CreateVehicleDto']
type UpdateVehicleDto = components['schemas']['UpdateVehicleDto']

type VehicleListResponse = {
  data: Array<
    Vehicle & {
      customer?: {
        id: string
        type: 'PRIVATE' | 'COMPANY'
        first_name: string
        last_name: string
        company_name?: string
      } | null
    }
  >
  meta: {
    total: number
    page: number
    pageSize: number
    pageCount: number
  }
}

export const vehicleKeys = {
  all: ['vehicles'] as const,
  list: (queryParams?: DataTableQueryParams) => [...vehicleKeys.all, 'list', queryParams] as const,
  detail: (id: string) => [...vehicleKeys.all, 'detail', id] as const,
}

export function useVehicles(queryParams?: DataTableQueryParams) {
  return useQuery<VehicleListResponse>({
    queryKey: vehicleKeys.list(queryParams),
    queryFn: async () => {
      const url = buildDataTableUrl('/api/vehicles', queryParams, {
        searchFallbackFilterFields: ['make', 'model', 'vin', 'plate'],
      })
      const response = await fetchWithAuth(url)
      if (!response.ok) throw new Error('Failed to fetch vehicles')
      return response.json()
    },
  })
}

export function useVehicle<TVehicle = Vehicle>(id: string) {
  return useQuery<TVehicle>({
    queryKey: vehicleKeys.detail(id),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vehicles/${id}`)
      if (!response.ok) throw new Error('Failed to fetch vehicle')
      return response.json()
    },
    enabled: !!id,
  })
}

export function useCreateVehicle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateVehicleDto) => {
      const response = await fetchWithAuth('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const payload = await response
          .json()
          .catch(() => ({ message: 'Failed to create vehicle' }))
        throw new Error(payload.message || 'Failed to create vehicle')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all })
    },
  })
}

export function useResolveVehicleIdentity() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vehicleId: string) => {
      const response = await fetchWithAuth(`/api/vehicles/${vehicleId}/resolve-identity`, {
        method: 'POST',
      })
      if (!response.ok) {
        const payload = await response
          .json()
          .catch(() => ({ message: 'Failed to resolve vehicle identity' }))
        throw new Error(payload.message || 'Failed to resolve vehicle identity')
      }
      return response.json() as Promise<Vehicle>
    },
    onSuccess: (vehicle) => {
      queryClient.setQueryData(vehicleKeys.detail(vehicle.id), vehicle)
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all })
    },
  })
}

export function useUpdateVehicle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string
      data: UpdateVehicleDto
    }) => {
      const response = await fetchWithAuth(`/api/vehicles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const payload = await response
          .json()
          .catch(() => ({ message: 'Failed to update vehicle' }))
        throw new Error(payload.message || 'Failed to update vehicle')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all })
    },
  })
}
