import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'
import { firebaseAuth } from '@/lib/firebase'

export type AuthSession = components['schemas']['AuthSessionResponseDto']
export type AuthSessionTenant = components['schemas']['AuthSessionTenantDto']
export type AuthSessionMembership = components['schemas']['AuthSessionMembershipDto']
export type SwitchTenantPayload = components['schemas']['SwitchTenantDto']

export const authSessionKeys = {
  all: ['auth-session'] as const,
}

async function getErrorMessage(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => undefined) as { message?: string } | undefined
  return payload?.message || fallbackMessage
}

export function useAuthSession(enabled = true) {
  return useQuery<AuthSession>({
    queryKey: authSessionKeys.all,
    enabled,
    queryFn: async () => {
      const response = await fetchWithAuth('/api/auth/me')

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch auth session'))
      }

      return response.json() as Promise<AuthSession>
    },
  })
}

export function useSwitchTenant() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (tenantId: string) => {
      const payload: SwitchTenantPayload = { tenantId }
      const response = await fetchWithAuth('/api/auth/switch-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to switch tenant'))
      }

      return response.json() as Promise<AuthSession>
    },
    onSuccess: async () => {
      await firebaseAuth?.currentUser?.getIdToken(true)
      queryClient.removeQueries({
        type: 'inactive',
        predicate: (query) => query.queryKey[0] !== authSessionKeys.all[0],
      })
      await queryClient.invalidateQueries({
        queryKey: authSessionKeys.all,
        refetchType: 'active',
      })
      await queryClient.invalidateQueries({
        refetchType: 'active',
      })
    },
  })
}