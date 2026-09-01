import { useQuery } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type {
  CatalogAssemblyGroupsResponse,
  CatalogExternalSearchResponse,
  CatalogSearchConcern,
  CatalogSearchSource,
} from './types'

const CATALOG_API = '/api/catalog'

type CatalogApiError = Error & {
  status?: number
}

export const catalogExternalKeys = {
  all: ['catalog', 'external'] as const,
  assemblyGroups: (workshopOrderId: string) =>
    [...catalogExternalKeys.all, 'assembly-groups', workshopOrderId] as const,
}

export interface ExternalCatalogSearchParams {
  workshopOrderId: string
  taskId: string
  concern: CatalogSearchConcern
  q?: string
  source?: CatalogSearchSource
  confirmFallback?: boolean
}

async function parseCatalogError(response: Response, fallbackMessage: string): Promise<CatalogApiError> {
  const payload = await response.json().catch(() => ({})) as { message?: string }
  const error = new Error(payload.message || fallbackMessage) as CatalogApiError
  error.status = response.status
  return error
}

function buildExternalSearchUrl(params: ExternalCatalogSearchParams): string {
  const searchParams = new URLSearchParams({
    workshopOrderId: params.workshopOrderId,
    taskId: params.taskId,
    concern: params.concern,
    source: params.source ?? 'AUTO',
    confirmFallback: String(params.confirmFallback ?? false),
  })
  if (params.q?.trim()) {
    searchParams.set('q', params.q.trim())
  }
  return `${CATALOG_API}/external/search?${searchParams.toString()}`
}

export async function fetchExternalCatalogSearch(
  params: ExternalCatalogSearchParams,
): Promise<CatalogExternalSearchResponse> {
  const response = await fetchWithAuth(buildExternalSearchUrl(params))
  if (!response.ok) {
    throw await parseCatalogError(response, 'Failed to search external catalog')
  }
  return response.json()
}

export function useCatalogAssemblyGroups(workshopOrderId: string, enabled = true) {
  const normalizedWorkshopOrderId = workshopOrderId.trim()
  return useQuery<CatalogAssemblyGroupsResponse>({
    queryKey: catalogExternalKeys.assemblyGroups(normalizedWorkshopOrderId),
    queryFn: async () => {
      const params = new URLSearchParams({
        workshopOrderId: normalizedWorkshopOrderId,
        concern: 'PARTS',
      })
      const response = await fetchWithAuth(
        `${CATALOG_API}/external/assembly-groups?${params.toString()}`,
      )
      if (!response.ok) {
        throw await parseCatalogError(response, 'Failed to fetch assembly groups')
      }
      return response.json()
    },
    enabled: enabled && normalizedWorkshopOrderId.length > 0,
  })
}
