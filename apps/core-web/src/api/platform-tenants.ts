import { fetchJsonWithAuth } from "./api-error";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'

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
      return fetchJsonWithAuth(
        query ? `/api/platform/tenants?${query}` : "/api/platform/tenants",
        "Failed to fetch tenants",
      );
    },
  });
}

export function useCreatePlatformTenant() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreatePlatformTenantPayload) => {
      return fetchJsonWithAuth<PlatformTenant>(
        "/api/platform/tenants",
        "Failed to create tenant",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: platformTenantKeys.all })
    },
  });
}

export function useUpdatePlatformTenant() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdatePlatformTenantPayload;
    }) => {
      return fetchJsonWithAuth<PlatformTenant>(
        `/api/platform/tenants/${id}`,
        "Failed to update tenant",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      );
    },
    onSuccess: (tenant) => {
      queryClient.invalidateQueries({ queryKey: platformTenantKeys.all })
      queryClient.invalidateQueries({ queryKey: platformTenantKeys.detail(tenant.id) })
    },
  });
}
