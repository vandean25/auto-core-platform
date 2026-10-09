import { useInfiniteQuery } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'

export type DecisionShadowLog =
  components['schemas']['DecisionShadowLogResponseDto']
export type DecisionShadowLogListResponse =
  components['schemas']['DecisionShadowLogListResponseDto']
export type DecisionShadowUseCase = DecisionShadowLog['useCase']

export type DecisionShadowLogFilters = {
  useCase?: DecisionShadowUseCase
  startDate?: string
  endDate?: string
  limit?: number
}

export const decisionShadowLogKeys = {
  all: ['decision-shadow-logs'] as const,
  lists: () => [...decisionShadowLogKeys.all, 'list'] as const,
  list: (filters: DecisionShadowLogFilters = {}) =>
    [...decisionShadowLogKeys.lists(), filters] as const,
}

async function getErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  const payload = (await response.json().catch(() => undefined)) as
    { message?: string } | undefined
  return payload?.message || fallbackMessage
}

/** Read-only: this hook only issues GET requests. Suggestions are never applied. */
export function useDecisionShadowLogs(filters: DecisionShadowLogFilters = {}) {
  return useInfiniteQuery({
    queryKey: decisionShadowLogKeys.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams()

      if (filters.useCase) params.append('useCase', filters.useCase)
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)
      if (filters.limit !== undefined)
        params.append('limit', String(filters.limit))
      if (pageParam) params.append('cursor', pageParam)

      const query = params.toString()
      const url = query
        ? `/api/decision-shadow-logs?${query}`
        : '/api/decision-shadow-logs'
      const response = await fetchWithAuth(url)

      if (!response.ok) {
        throw new Error(
          await getErrorMessage(
            response,
            'Failed to fetch decision shadow logs',
          ),
        )
      }

      return (await response.json()) as DecisionShadowLogListResponse
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
}
