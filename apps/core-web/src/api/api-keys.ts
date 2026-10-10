import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'

export type TenantApiKey = components['schemas']['TenantApiKeyResponseDto']
export type TenantApiKeyCreated = components['schemas']['TenantApiKeyCreatedResponseDto']
export type TenantApiKeyList = components['schemas']['TenantApiKeyListResponseDto']
export type CreateTenantApiKeyPayload = components['schemas']['CreateTenantApiKeyDto']
export type PublicApiScope = CreateTenantApiKeyPayload['scopes'][number]

export const API_KEY_SCOPE_OPTIONS: readonly { value: PublicApiScope; label: string; description: string }[] = [
  { value: 'customers:read', label: 'Customers', description: 'Names, contact details and addresses.' },
  { value: 'vehicles:read', label: 'Vehicles', description: 'Vehicle identity: make, model, VIN and plate.' },
  { value: 'invoices:read', label: 'Invoices', description: 'Invoice headers and totals.' },
  { value: 'workshop-orders:read', label: 'Workshop orders', description: 'Status and scheduling of workshop orders.' },
  { value: 'stock:read', label: 'Parts stock', description: 'Parts quantities per storage location.' },
]

export const tenantApiKeyKeys = {
  all: ['tenant-api-keys'] as const,
  list: () => [...tenantApiKeyKeys.all, 'list'] as const,
}

async function getErrorMessage(response: Response, fallbackMessage: string) {
  const payload = (await response.json().catch(() => undefined)) as { message?: string | string[] } | undefined
  const message = payload?.message
  if (Array.isArray(message)) {
    return message.join(', ') || fallbackMessage
  }
  return message || fallbackMessage
}

export function useTenantApiKeys() {
  return useQuery<TenantApiKeyList>({
    queryKey: tenantApiKeyKeys.list(),
    queryFn: async () => {
      const response = await fetchWithAuth('/api/tenant-api-keys')
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to load API keys'))
      }
      return response.json()
    },
  })
}

export function useCreateTenantApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateTenantApiKeyPayload) => {
      const response = await fetchWithAuth('/api/tenant-api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to create API key'))
      }

      return response.json() as Promise<TenantApiKeyCreated>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tenantApiKeyKeys.all })
    },
  })
}

export function useRevokeTenantApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/tenant-api-keys/${id}/revoke`, { method: 'POST' })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to revoke API key'))
      }

      return response.json() as Promise<TenantApiKey>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tenantApiKeyKeys.all })
    },
  })
}
