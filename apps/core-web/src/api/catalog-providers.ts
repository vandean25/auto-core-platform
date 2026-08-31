import { useQuery } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { CatalogProviderSettings } from './types'

const SETTINGS_API = '/api/settings/catalog-providers'

export const catalogProviderKeys = {
  all: ['settings', 'catalog-providers'] as const,
  settings: () => [...catalogProviderKeys.all, 'settings'] as const,
}

export function useCatalogProviderSettings() {
  return useQuery<CatalogProviderSettings>({
    queryKey: catalogProviderKeys.settings(),
    queryFn: async () => {
      const response = await fetchWithAuth(SETTINGS_API)
      if (!response.ok) throw new Error('Failed to fetch catalog provider settings')
      return response.json()
    },
  })
}
