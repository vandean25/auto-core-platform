import { fetchJsonWithAuth } from "./api-error";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { firebaseAuth } from '@/lib/firebase'
import { isE2EAuthBypassEnabled, isE2ETestTokenAuthEnabled } from '@/lib/runtime-flags'
import { isMechanicPath } from '@/lib/shell-paths'

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
  activeSiteId: null,
  memberships: [],
  locale: null,
  effectiveLocale: 'de',
  defaultLocale: 'de',
  formatLocale: 'de-AT',
}

function getE2EAuthSession(pathname = window.location.pathname): AuthSession {
  const roleOverride = window.localStorage.getItem('e2e-active-role')
  const validRoles = new Set<AuthSession['activeRole']>([
    'OWNER',
    'ADMIN',
    'TECH',
    'SALES',
  ])
  const activeRole =
    roleOverride && validRoles.has(roleOverride as AuthSession['activeRole'])
      ? (roleOverride as AuthSession['activeRole'])
      : isMechanicPath(pathname)
        ? 'TECH'
        : 'ADMIN'

  const siteOverride = window.localStorage.getItem('e2e-active-site-id')?.trim()
  const activeSiteId = siteOverride ? siteOverride : e2eAuthSession.activeSiteId

  return {
    ...e2eAuthSession,
    activeRole,
    activeSiteId,
  }
}

function getCurrentUserKey(explicitUserKey?: string | null) {
  if (explicitUserKey) {
    return explicitUserKey
  }

  if (isE2ETestTokenAuthEnabled()) {
    return 'e2e-fullstack-user'
  }

  if (isE2EAuthBypassEnabled()) {
    return 'e2e-test-user'
  }

  return (
    firebaseAuth?.currentUser?.uid ?? firebaseAuth?.currentUser?.email ?? null
  );
}

export function useAuthSession(userKey?: string | null, enabled = true) {
  const resolvedUserKey = getCurrentUserKey(userKey)

  return useQuery<AuthSession>({
    queryKey: authSessionKeys.user(resolvedUserKey),
    enabled: enabled && Boolean(resolvedUserKey),
    queryFn: async ({ signal }) => {
      if (isE2EAuthBypassEnabled() && !isE2ETestTokenAuthEnabled()) {
        return getE2EAuthSession()
      }

      return fetchJsonWithAuth<AuthSession>(
        "/api/auth/me",
        "Failed to fetch auth session",
        { signal },
      );
    },
  });
}

export function useSwitchTenant() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (tenantId: string) => {
      const payload: SwitchTenantPayload = { tenantId }
      return fetchJsonWithAuth<AuthSession>(
        "/api/auth/switch-tenant",
        "Failed to switch tenant",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
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
  });
}
