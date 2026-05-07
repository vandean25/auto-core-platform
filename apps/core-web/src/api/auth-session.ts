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
  user: (userKey: string | null) => [...authSessionKeys.all, userKey ?? 'anonymous'] as const,
}

const e2eAuthSession: AuthSession = {
  userId: 'e2e-test-user',
  email: 'testauto@auto.core.at',
  activeTenant: {
    id: 'e2e-tenant-id',
    name: 'Auto Core E2E Tenant',
    slug: 'e2e-tenant',
  },
  activeRole: 'ADMIN',
  memberships: [],
}

function getCurrentUserKey(explicitUserKey?: string | null) {
  if (explicitUserKey) {
    return explicitUserKey
  }

  return firebaseAuth?.currentUser?.uid ?? firebaseAuth?.currentUser?.email ?? null
}

async function getErrorMessage(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => undefined) as { message?: string } | undefined
  return payload?.message || fallbackMessage
}

function isE2EAuthBypassEnabled() {
  return import.meta.env.MODE !== 'production' && import.meta.env.VITE_E2E_SKIP_AUTH === 'true'
}

export function useAuthSession(userKey?: string | null, enabled = true) {
  const resolvedUserKey = getCurrentUserKey(userKey)

  return useQuery<AuthSession>({
    queryKey: authSessionKeys.user(resolvedUserKey),
    enabled: enabled && Boolean(resolvedUserKey),
    queryFn: async () => {
      if (isE2EAuthBypassEnabled()) {
        return e2eAuthSession
      }

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
