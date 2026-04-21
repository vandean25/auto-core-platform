import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'

export type Bay = components['schemas']['BayResponseDto']
export type BaysListResponse = components['schemas']['BaysListResponseDto']
export type CreateBayPayload = components['schemas']['CreateBayDto']
export type UpdateBayPayload = components['schemas']['UpdateBayDto']
export type DeleteBayResponse = components['schemas']['BayDeleteResponseDto']

export type ListBaysOptions = {
  includeInactive?: boolean
  page?: number
  limit?: number
}

export const bayKeys = {
  all: ['bays'] as const,
  list: (options?: ListBaysOptions) => [...bayKeys.all, 'list', options] as const,
  detail: (id: string) => [...bayKeys.all, 'detail', id] as const,
}

async function getErrorMessage(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => undefined) as { message?: string } | undefined
  return payload?.message || fallbackMessage
}

export function useBays(options?: ListBaysOptions) {
  return useQuery<BaysListResponse>({
    queryKey: bayKeys.list(options),
    queryFn: async () => {
      const params = new URLSearchParams()

      if (options?.includeInactive !== undefined) {
        params.append('includeInactive', String(options.includeInactive))
      }

      if (options?.page !== undefined) {
        params.append('page', String(options.page))
      }

      if (options?.limit !== undefined) {
        params.append('limit', String(options.limit))
      }

      const query = params.toString()
      const response = await fetchWithAuth(query ? `/api/bays?${query}` : '/api/bays')
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch bays'))
      }

      return response.json()
    },
  })
}

export function useBay(id: string) {
  return useQuery<Bay>({
    queryKey: bayKeys.detail(id),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/bays/${id}`)
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch bay'))
      }

      return response.json()
    },
    enabled: !!id,
  })
}

export function useCreateBay() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateBayPayload) => {
      const response = await fetchWithAuth('/api/bays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to create bay'))
      }

      return response.json() as Promise<Bay>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bayKeys.all })
    },
  })
}

export function useUpdateBay() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateBayPayload }) => {
      const response = await fetchWithAuth(`/api/bays/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to update bay'))
      }

      return response.json() as Promise<Bay>
    },
    onSuccess: (bay) => {
      queryClient.invalidateQueries({ queryKey: bayKeys.all })
      queryClient.invalidateQueries({ queryKey: bayKeys.detail(bay.id) })
    },
  })
}

export function useDeleteBay() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/bays/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to delete bay'))
      }

      return response.json() as Promise<DeleteBayResponse>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bayKeys.all })
    },
  })
}
