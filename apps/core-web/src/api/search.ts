import { fetchJsonWithAuth } from './api-error'
import type { components } from './generated/openapi'

export type SearchResponse = components['schemas']['SearchResponseDto']
export type SearchGroup = components['schemas']['SearchGroupDto']
export type SearchResult = components['schemas']['SearchResultDto']
export type SearchResultType = SearchResult['type']

export const searchKeys = {
  all: ['search'] as const,
  results: (q: string, types: readonly SearchResultType[] | undefined) =>
    [...searchKeys.all, q, types ?? []] as const,
}

/** GET /api/search: one grouped request for every entity type the session role may see. */
export function fetchSearch(
  q: string,
  types?: readonly SearchResultType[],
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q })
  if (types?.length) params.set('types', types.join(','))

  return fetchJsonWithAuth<SearchResponse>(`/api/search?${params}`, 'Search failed', { signal })
}
