import { fetchJsonWithAuth } from "./api-error";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { clearLocalSiteSwitch, markLocalSiteSwitch } from './local-site-switch'
import { resetClientSession } from '@/auth/client-session-reset'

export type MeSite = components['schemas']['MeSiteDto']
export type SetActiveSitePayload = components['schemas']['SetActiveSiteDto']
export type ActiveSiteResponse = components['schemas']['ActiveSiteResponseDto']

/** Names-only active site directory entry from GET /api/sites */
export type SiteDirectoryEntry = {
  id: string
  code: string
  name: string
  legalEntityId: string
  legalEntityName?: string
}

export const siteKeys = {
  all: ['sites'] as const,
  /** `tenantId` scopes the list to one tenant's cache entry; without it the key is the prefix that covers all of them. */
  me: (tenantId?: string) => (tenantId ? ([...siteKeys.all, 'me', tenantId] as const) : ([...siteKeys.all, 'me'] as const)),
  directory: () => [...siteKeys.all, 'directory'] as const,
}

/**
 * GET /api/me/sites — only activatable sites for the current tenant
 * (ruling 47: Site.is_active AND active SiteMembership AND active TenantMember).
 */
export function useMySites(enabled = true, tenantId?: string) {
  return useQuery<MeSite[]>({
    queryKey: siteKeys.me(tenantId),
    enabled,
    queryFn: async () => {
      return fetchJsonWithAuth<MeSite[]>(
        "/api/me/sites",
        "Failed to load sites",
      );
    },
  });
}

/**
 * GET /api/sites — active names-only directory for transfer from/to pickers.
 */
export function useSiteDirectory(enabled = true) {
  return useQuery<SiteDirectoryEntry[]>({
    queryKey: siteKeys.directory(),
    enabled,
    queryFn: async () => {
      return fetchJsonWithAuth<SiteDirectoryEntry[]>(
        "/api/sites",
        "Failed to load sites",
      );
    },
  });
}

/**
 * PATCH /api/me/active-site — switches the session site and emits
 * site:context_updated on user_{firebaseUid} for every other tab.
 */
export function useSetActiveSite() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (siteId: string | null) => {
      const payload: SetActiveSitePayload = { siteId }
      markLocalSiteSwitch(siteId)
      return fetchJsonWithAuth<ActiveSiteResponse>(
        "/api/me/active-site",
        "Failed to switch active site",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
    },
    onError: clearLocalSiteSwitch,
    onSuccess: async () => {
      // Every cached query may belong to the site being left, not only the operational families. The same user
      // keeps saved views, the dashboard layout and the push registration across a site switch.
      await resetClientSession(queryClient, 'context')
    },
  });
}
