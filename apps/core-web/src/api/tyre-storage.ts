import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from './client'

export type TyreSet = components['schemas']['TyreSetResponseDto']
export type TyreSetListResponse = {
  data: TyreSet[]
  meta?: components['schemas']['PaginationMetaDto']
}

async function readApiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    message?: string | string[]
  } | null
  if (!payload?.message) return fallback
  return Array.isArray(payload.message) ? payload.message.join(', ') : payload.message
}

export const tyreStorageKeys = {
  all: ['tyre-sets'] as const,
  list: (params: Record<string, string | number | undefined>) =>
    [...tyreStorageKeys.all, 'list', params] as const,
  detail: (id: string) => [...tyreStorageKeys.all, 'detail', id] as const,
  byCustomer: (customerId: string) =>
    [...tyreStorageKeys.all, 'by-customer', customerId] as const,
  byVehicle: (vehicleId: string) =>
    [...tyreStorageKeys.all, 'by-vehicle', vehicleId] as const,
  due: () => [...tyreStorageKeys.all, 'due-for-swap'] as const,
  settings: () => [...tyreStorageKeys.all, 'settings'] as const,
}

export function useTyreSets(params: {
  search?: string
  status?: string
  season?: string
  customerId?: string
  locationId?: string
  dueFrom?: string
  dueTo?: string
  page?: number
  pageSize?: number
}) {
  const query = new URLSearchParams()
  if (params.search) query.set('vehicleSearch', params.search)
  if (params.status) query.set('status', params.status)
  if (params.season) query.set('season', params.season)
  if (params.customerId) query.set('customerId', params.customerId)
  if (params.locationId) query.set('locationId', params.locationId)
  if (params.dueFrom) query.set('dueFrom', params.dueFrom)
  if (params.dueTo) query.set('dueTo', params.dueTo)
  if (params.page) query.set('page', String(params.page))
  if (params.pageSize) query.set('pageSize', String(params.pageSize))

  return useQuery<TyreSetListResponse>({
    queryKey: tyreStorageKeys.list(params),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/tyre-sets?${query.toString()}`)
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, 'Failed to load tyre sets'))
      }
      return response.json()
    },
  })
}

export function useTyreSet(id: string | undefined) {
  return useQuery<TyreSet>({
    queryKey: tyreStorageKeys.detail(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/tyre-sets/${id}`)
      if (!response.ok) throw new Error('Failed to load tyre set')
      return response.json()
    },
  })
}

export function useTyreSetsByVehicle(vehicleId: string | undefined) {
  return useQuery<{ data: TyreSet[] }>({
    queryKey: tyreStorageKeys.byVehicle(vehicleId ?? ''),
    enabled: Boolean(vehicleId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/tyre-sets/by-vehicle/${vehicleId}`)
      if (!response.ok) throw new Error('Failed to load tyre sets')
      return response.json()
    },
  })
}

export function useDueTyreSets() {
  return useQuery<{ data: TyreSet[] }>({
    queryKey: tyreStorageKeys.due(),
    queryFn: async () => {
      const response = await fetchWithAuth('/api/tyre-sets/due-for-swap')
      if (!response.ok) throw new Error('Failed to load due tyre sets')
      return response.json()
    },
  })
}

export function useCreateTyreSet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: components['schemas']['CreateTyreSetDto']) => {
      const response = await fetchWithAuth('/api/tyre-sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, 'Failed to create tyre set'))
      }
      return response.json() as Promise<TyreSet>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tyreStorageKeys.all })
    },
  })
}

export function useUpdateTyreSet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      body: components['schemas']['UpdateTyreSetDto']
    }) => {
      const response = await fetchWithAuth(`/api/tyre-sets/${input.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input.body),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, 'Failed to update tyre set'))
      }
      return response.json() as Promise<TyreSet>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: tyreStorageKeys.all })
      queryClient.invalidateQueries({ queryKey: tyreStorageKeys.detail(variables.id) })
    },
  })
}

export function useTyreSetsByCustomer(customerId: string | undefined) {
  return useQuery<{ data: TyreSet[]; meta?: components['schemas']['PaginationMetaDto'] }>({
    queryKey: tyreStorageKeys.byCustomer(customerId ?? ''),
    enabled: Boolean(customerId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/tyre-sets/by-customer/${customerId}`)
      if (!response.ok) throw new Error('Failed to load tyre sets')
      return response.json()
    },
  })
}

export function useTyreSetAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      action: 'check-in' | 'check-out' | 'move' | 'dispose'
      body: components['schemas']['TyreSetLocationActionDto']
    }) => {
      const response = await fetchWithAuth(
        `/api/tyre-sets/${input.id}/${input.action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input.body),
        },
      )
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, 'Tyre set action failed'))
      }
      return response.json() as Promise<TyreSet>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: tyreStorageKeys.all })
      queryClient.invalidateQueries({ queryKey: tyreStorageKeys.detail(variables.id) })
    },
  })
}
