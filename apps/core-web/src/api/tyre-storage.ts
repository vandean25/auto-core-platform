import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from './client'

export type TyreSet = components['schemas']['TyreSetResponseDto']
export type TyreSetListResponse = {
  data: TyreSet[]
  meta?: components['schemas']['PaginationMetaDto']
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
  page?: number
  pageSize?: number
}) {
  const query = new URLSearchParams()
  if (params.search) query.set('vehicleSearch', params.search)
  if (params.status) query.set('status', params.status)
  if (params.season) query.set('season', params.season)
  if (params.page) query.set('page', String(params.page))
  if (params.pageSize) query.set('pageSize', String(params.pageSize))

  return useQuery<TyreSetListResponse>({
    queryKey: tyreStorageKeys.list(params),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/tyre-sets?${query.toString()}`)
      if (!response.ok) throw new Error('Failed to load tyre sets')
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
      if (!response.ok) throw new Error('Failed to create tyre set')
      return response.json() as Promise<TyreSet>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tyreStorageKeys.all })
    },
  })
}

export function useTyreSetAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      action: 'check-in' | 'check-out' | 'move'
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
      if (!response.ok) throw new Error('Tyre set action failed')
      return response.json() as Promise<TyreSet>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: tyreStorageKeys.all })
      queryClient.invalidateQueries({ queryKey: tyreStorageKeys.detail(variables.id) })
    },
  })
}
