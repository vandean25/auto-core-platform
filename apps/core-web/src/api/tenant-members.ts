import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'

export type TenantMemberRole = components['schemas']['TenantMemberRole']
export type TenantMember = components['schemas']['TenantMemberResponseDto']
export type TenantMembersListResponse = components['schemas']['TenantMembersListResponseDto']
export type InviteTenantMemberPayload = components['schemas']['InviteTenantMemberDto']
export type UpdateTenantMemberPayload = components['schemas']['UpdateTenantMemberDto']

export type ListTenantMembersOptions = {
  search?: string
  includeInactive?: boolean
  page?: number
  limit?: number
}

export const tenantMemberKeys = {
  all: ['tenant-members'] as const,
  list: (options?: ListTenantMembersOptions) => [...tenantMemberKeys.all, 'list', options] as const,
  detail: (id: string) => [...tenantMemberKeys.all, 'detail', id] as const,
}

async function getErrorMessage(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => undefined) as { message?: string } | undefined
  return payload?.message || fallbackMessage
}

export function useTenantMembers(options?: ListTenantMembersOptions) {
  return useQuery<TenantMembersListResponse>({
    queryKey: tenantMemberKeys.list(options),
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
      const response = await fetchWithAuth(query ? `/api/tenant-members?${query}` : '/api/tenant-members')
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch tenant members'))
      }

      return response.json()
    },
  })
}

export function useInviteTenantMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: InviteTenantMemberPayload) => {
      const response = await fetchWithAuth('/api/tenant-members/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to invite team member'))
      }

      return response.json() as Promise<TenantMember>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenantMemberKeys.all })
    },
  })
}

export function useUpdateTenantMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTenantMemberPayload }) => {
      const response = await fetchWithAuth(`/api/tenant-members/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to update tenant member'))
      }

      return response.json() as Promise<TenantMember>
    },
    onSuccess: (membership) => {
      queryClient.invalidateQueries({ queryKey: tenantMemberKeys.all })
      queryClient.invalidateQueries({ queryKey: tenantMemberKeys.detail(membership.id) })
    },
  })
}