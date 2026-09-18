import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import { siteKeys } from './sites'

export type LegalEntityRecord = {
  id: string
  tenant_id: string
  name: string
  country_iso: 'AT' | 'DE'
  is_active: boolean
}

export type AdminSiteRecord = {
  id: string
  tenant_id: string
  legal_entity_id: string
  code: string
  name: string
  is_active: boolean
  legal_entity?: {
    id: string
    name: string
    country_iso: string
  }
  _count?: {
    memberships: number
    bays: number
    storageLocations: number
  }
}

export type SiteMembershipRecord = {
  id: string
  tenant_id: string
  user_id: string
  site_id: string
  is_active: boolean
  user: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
  }
  tenantMember: {
    role: string
    is_active: boolean
  }
}

export const siteAdminKeys = {
  all: ['site-admin'] as const,
  legalEntities: () => [...siteAdminKeys.all, 'legal-entities'] as const,
  sites: (includeInactive = true) =>
    [...siteAdminKeys.all, 'sites', { includeInactive }] as const,
  memberships: (siteId: string) =>
    [...siteAdminKeys.all, 'memberships', siteId] as const,
}

async function getErrorMessage(response: Response, fallbackMessage: string) {
  const payload = (await response.json().catch(() => undefined)) as
    | { message?: string }
    | undefined
  return payload?.message || fallbackMessage
}

export function useLegalEntities() {
  return useQuery<LegalEntityRecord[]>({
    queryKey: siteAdminKeys.legalEntities(),
    queryFn: async () => {
      const response = await fetchWithAuth('/api/legal-entities')
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to load legal entities'))
      }
      return response.json()
    },
  })
}

export function useCreateLegalEntity() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { name: string; countryIso: 'AT' | 'DE' }) => {
      const response = await fetchWithAuth('/api/legal-entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to create legal entity'))
      }
      return response.json() as Promise<LegalEntityRecord>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteAdminKeys.legalEntities() })
    },
  })
}

export function useUpdateLegalEntity() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { id: string; name?: string; isActive?: boolean }) => {
      const response = await fetchWithAuth(`/api/legal-entities/${payload.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
        }),
      })
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to update legal entity'))
      }
      return response.json() as Promise<LegalEntityRecord>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteAdminKeys.legalEntities() })
      queryClient.invalidateQueries({ queryKey: siteAdminKeys.all })
    },
  })
}

export function useAdminSites(includeInactive = true) {
  return useQuery<AdminSiteRecord[]>({
    queryKey: siteAdminKeys.sites(includeInactive),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/sites?includeInactive=${includeInactive ? 'true' : 'false'}`,
      )
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to load sites'))
      }
      return response.json()
    },
  })
}

export function useSiteMemberships(siteId: string | null) {
  return useQuery<SiteMembershipRecord[]>({
    queryKey: siteAdminKeys.memberships(siteId ?? ''),
    enabled: !!siteId,
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/sites/${siteId}/memberships`)
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to load site memberships'))
      }
      return response.json()
    },
  })
}

export function useAddSiteMembership() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { siteId: string; userId: string }) => {
      const response = await fetchWithAuth(`/api/sites/${payload.siteId}/memberships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: payload.userId }),
      })
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to add site membership'))
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: siteAdminKeys.memberships(variables.siteId),
      })
      queryClient.invalidateQueries({ queryKey: siteAdminKeys.sites(true) })
      queryClient.invalidateQueries({ queryKey: siteKeys.me() })
    },
  })
}

export function useRemoveSiteMembership() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { siteId: string; userId: string }) => {
      const response = await fetchWithAuth(
        `/api/sites/${payload.siteId}/memberships/${payload.userId}`,
        { method: 'DELETE' },
      )
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to remove site membership'))
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: siteAdminKeys.memberships(variables.siteId),
      })
      queryClient.invalidateQueries({ queryKey: siteAdminKeys.sites(true) })
      queryClient.invalidateQueries({ queryKey: siteKeys.me() })
    },
  })
}
