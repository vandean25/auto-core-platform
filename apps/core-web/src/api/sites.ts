import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'
import { authSessionKeys } from './auth-session'
import { inventoryKeys } from './inventory'
import { vehicleStockKeys } from './vehicle-stock'
import { workshopKeys } from './workshop'
import { stockTransferKeys } from './stock-transfers'

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
  me: () => [...siteKeys.all, 'me'] as const,
  directory: () => [...siteKeys.all, 'directory'] as const,
}

const SITE_SCOPED_QUERY_KEYS = [
  workshopKeys.all,
  inventoryKeys.all,
  vehicleStockKeys.all,
  stockTransferKeys.all,
] as const

async function getErrorMessage(response: Response, fallbackMessage: string) {
  const payload = (await response.json().catch(() => undefined)) as
    { message?: string } | undefined
  return payload?.message || fallbackMessage
}

/**
 * GET /api/me/sites — only activatable sites for the current tenant
 * (ruling 47: Site.is_active AND active SiteMembership AND active TenantMember).
 */
export function useMySites(enabled = true) {
  return useQuery<MeSite[]>({
    queryKey: siteKeys.me(),
    enabled,
    queryFn: async () => {
      const response = await fetchWithAuth('/api/me/sites')
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to load sites'))
      }
      return response.json() as Promise<MeSite[]>
    },
  })
}

/**
 * GET /api/sites — active names-only directory for transfer from/to pickers.
 */
export function useSiteDirectory(enabled = true) {
  return useQuery<SiteDirectoryEntry[]>({
    queryKey: siteKeys.directory(),
    enabled,
    queryFn: async () => {
      const response = await fetchWithAuth('/api/sites')
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to load sites'))
      }
      return response.json() as Promise<SiteDirectoryEntry[]>
    },
  })
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
      const response = await fetchWithAuth('/api/me/active-site', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(
          await getErrorMessage(response, 'Failed to switch active site'),
        )
      }

      return response.json() as Promise<ActiveSiteResponse>
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: authSessionKeys.all,
        refetchType: 'active',
      })
      await queryClient.invalidateQueries({
        queryKey: siteKeys.me(),
        refetchType: 'active',
      })
      for (const queryKey of SITE_SCOPED_QUERY_KEYS) {
        await queryClient.invalidateQueries({
          queryKey,
          refetchType: 'active',
        })
      }
    },
  })
}
