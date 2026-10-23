import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Vehicle } from './types'
import { fetchWithAuth } from './client'
import { customerKeys } from './customers'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { buildDataTableUrl } from './data-table-query'
import type { components } from './generated/openapi'
type PickerlDuePaginatedResponseDto = components['schemas']['PickerlDuePaginatedResponseDto']
export type OpenPickerlWorkshopOrder = components['schemas']['OpenPickerlOrderDto']

type CreateVehicleDto = components['schemas']['CreateVehicleDto']
type UpdateVehicleDto = components['schemas']['UpdateVehicleDto']
type VehiclePartiesResponse = components['schemas']['VehiclePartiesResponseDto']
export type VehiclePartyResponse = components['schemas']['VehiclePartyResponseDto']
export type VehicleOpenDueDate = components['schemas']['VehicleOpenDueDateDto']
type CreateVehiclePartyDto = components['schemas']['CreateVehiclePartyDto']

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
  pickerlDue: (filters: string) => [...vehicleKeys.all, 'pickerlDue', { filters }] as const,
  pickerlDueAll: () => [...vehicleKeys.all, 'pickerlDue'] as const,
  openPickerlOrder: (vehicleId: string) => [...vehicleKeys.all, vehicleId, 'openPickerlOrder'] as const,
  parties: (vehicleId: string) => [...vehicleKeys.all, vehicleId, 'parties'] as const,
}

/** Party writes and vehicle customer changes move the main contact and the customer's vehicle list. */
function invalidatePartyDependents(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: vehicleKeys.all })
  queryClient.invalidateQueries({ queryKey: customerKeys.all })
}

async function requestVehicleParty<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetchWithAuth(url, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string }
    throw Object.assign(new Error(payload.message || fallback), { status: response.status, data: payload })
  }
  return response.json() as Promise<T>
}

export function useVehicleParties(vehicleId: string) {
  return useQuery<VehiclePartiesResponse>({
    queryKey: vehicleKeys.parties(vehicleId),
    queryFn: () =>
      requestVehicleParty<VehiclePartiesResponse>(
        `/api/vehicles/${encodeURIComponent(vehicleId)}/parties`,
        {},
        'Failed to fetch vehicle parties',
      ),
    enabled: Boolean(vehicleId),
  })
}

export function useAddVehicleParty(vehicleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateVehiclePartyDto) =>
      requestVehicleParty<VehiclePartyResponse>(
        `/api/vehicles/${encodeURIComponent(vehicleId)}/parties`,
        { method: 'POST', body: JSON.stringify(data) },
        'Failed to add vehicle party',
      ),
    onSuccess: () => invalidatePartyDependents(queryClient),
  })
}

export function useEndVehicleParty(vehicleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (partyId: string) =>
      requestVehicleParty<VehiclePartyResponse>(
        `/api/vehicles/${encodeURIComponent(vehicleId)}/parties/${encodeURIComponent(partyId)}`,
        { method: 'PATCH', body: JSON.stringify({}) },
        'Failed to end vehicle party',
      ),
    onSuccess: () => invalidatePartyDependents(queryClient),
  })
}

export function useOpenPickerlWorkshopOrder(vehicleId: string) {
  return useQuery<OpenPickerlWorkshopOrder | null>({
    queryKey: vehicleKeys.openPickerlOrder(vehicleId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vehicles/${encodeURIComponent(vehicleId)}/pickerl-open-order`)
      if (!response.ok) throw new Error('Failed to check for an open Pickerl order')
      return response.json() as Promise<OpenPickerlWorkshopOrder | null>
    },
    enabled: Boolean(vehicleId),
  })
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
      invalidatePartyDependents(queryClient)
    },
  })
}

export function usePickerlDueList(queryParams: Record<string, unknown>) {
  const searchParams = new URLSearchParams()
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value))
    }
  })

  return useQuery({
    queryKey: vehicleKeys.pickerlDue(searchParams.toString()),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/vehicles/pickerl-due?${searchParams.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to fetch pickerl due list')
      }
      return (await response.json()) as PickerlDuePaginatedResponseDto
    },
  })
}
