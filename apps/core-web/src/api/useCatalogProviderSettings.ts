import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CatalogProviderSettings,
  UpdateCatalogProviderSettingsPayload,
} from './types'
import { fetchWithAuth } from './client'

export const catalogProviderSettingsKeys = {
  all: ['catalog-provider-settings'] as const,
  settings: () => [...catalogProviderSettingsKeys.all, 'settings'] as const,
}

async function readErrorMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => undefined)) as
    | { message?: string | string[] }
    | undefined
  const message = payload?.message
  if (Array.isArray(message)) {
    return message.join(', ')
  }
  return message || fallback
}

export function useCatalogProviderSettings(options?: { enabled?: boolean }) {
  return useQuery<CatalogProviderSettings>({
    queryKey: catalogProviderSettingsKeys.settings(),
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const response = await fetchWithAuth('/api/settings/catalog-providers')
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, 'Failed to fetch vehicle data settings'),
        )
      }
      return response.json()
    },
  })
}

export function useUpdateCatalogProviderSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: UpdateCatalogProviderSettingsPayload) => {
      const response = await fetchWithAuth('/api/settings/catalog-providers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, 'Failed to update vehicle data settings'),
        )
      }

      return response.json() as Promise<CatalogProviderSettings>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: catalogProviderSettingsKeys.settings() })
    },
  })
}
