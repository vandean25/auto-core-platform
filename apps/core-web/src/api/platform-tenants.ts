import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'

export type TenantPlan = components['schemas']['TenantPlan']
export type PlatformTenant = components['schemas']['PlatformTenantResponseDto']
export type PlatformTenantsListResponse = components['schemas']['PlatformTenantListResponseDto']
export type CreatePlatformTenantPayload = components['schemas']['CreatePlatformTenantDto']
export type UpdatePlatformTenantPayload = components['schemas']['UpdatePlatformTenantDto']

export type ListPlatformTenantsOptions = {
  search?: string
  includeInactive?: boolean
  page?: number
  limit?: number
}

export const platformTenantKeys = {
  all: ['platform-tenants'] as const,
  list: (options?: ListPlatformTenantsOptions) => [...platformTenantKeys.all, 'list', options] as const,
  detail: (id: string) => [...platformTenantKeys.all, 'detail', id] as const,
}

async function getErrorMessage(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => undefined) as { message?: string } | undefined
  return payload?.message || fallbackMessage
}

export function usePlatformTenants(options?: ListPlatformTenantsOptions) {
  return useQuery<PlatformTenantsListResponse>({
    queryKey: platformTenantKeys.list(options),
    queryFn: async () => {
      const params = new URLSearchParams()

      if (options?.search) {
        params.append('search', options.search)
      }

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
      const response = await fetchWithAuth(query ? `/api/platform/tenants?${query}` : '/api/platform/tenants')
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch tenants'))
      }

      return response.json()
    },
  })
}

export function useCreatePlatformTenant() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreatePlatformTenantPayload) => {
      const response = await fetchWithAuth('/api/platform/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to create tenant'))
      }

      return response.json() as Promise<PlatformTenant>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: platformTenantKeys.all })
    },
  })
}

export function useUpdatePlatformTenant() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdatePlatformTenantPayload }) => {
      const response = await fetchWithAuth(`/api/platform/tenants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to update tenant'))
      }

      return response.json() as Promise<PlatformTenant>
    },
    onSuccess: (tenant) => {
      queryClient.invalidateQueries({ queryKey: platformTenantKeys.all })
      queryClient.invalidateQueries({ queryKey: platformTenantKeys.detail(tenant.id) })
    },
  })
}