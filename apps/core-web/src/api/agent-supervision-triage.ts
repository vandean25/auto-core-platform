import { i18n } from '@/lib/i18n'
import { useEffect } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'
import { getErrorMessageFromResponse as getErrorMessage } from '@/lib/error-utils'

export type AgentSupervisionTriageItem =
  components['schemas']['AgentSupervisionTriageItemDto']
export type AgentSupervisionTriageListResponse =
  components['schemas']['AgentSupervisionTriageListResponseDto']

export interface AgentSupervisionTriageFilters {
  limit?: number
}

export const agentSupervisionTriageKeys = {
  all: ['agent-supervision', 'triage'] as const,
  lists: () => [...agentSupervisionTriageKeys.all, 'list'] as const,
  list: (filters: AgentSupervisionTriageFilters = {}) =>
    [...agentSupervisionTriageKeys.lists(), filters] as const,
}


export function useAgentSupervisionTriage(
  filters: AgentSupervisionTriageFilters = {},
  enabled = true,
) {
  const infinite = useInfiniteQuery<AgentSupervisionTriageListResponse>({
    queryKey: agentSupervisionTriageKeys.list(filters),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams()
      if (filters.limit !== undefined) {
        params.append('limit', String(filters.limit))
      }
      if (typeof pageParam === 'string' && pageParam.length > 0) {
        params.append('cursor', pageParam)
      }
      const query = params.toString()
      const url = query
        ? `/api/agent-supervision/triage?${query}`
        : '/api/agent-supervision/triage'
      const response = await fetchWithAuth(url)
      if (!response.ok) {
        throw new Error(
          await getErrorMessage(response, i18n.t('agent:approvals.triageLoadFailed')),
        )
      }
      return response.json()
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  })

  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isError,
    isFetchNextPageError,
  } = infinite

  useEffect(() => {
    if (!enabled) {
      return
    }
    if (isError || isFetchNextPageError) {
      return
    }
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [
    enabled,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isError,
    isFetchNextPageError,
  ])

  const mergedItems =
    infinite.data?.pages.flatMap((page) => page.data ?? []) ?? []

  return {
    ...infinite,
    data: {
      data: mergedItems,
      next_cursor: infinite.data?.pages.at(-1)?.next_cursor ?? null,
    },
    isLoading:
      infinite.isLoading ||
      infinite.isFetchingNextPage ||
      (infinite.isFetching && Boolean(hasNextPage) && !isFetchNextPageError),
    refetch: infinite.refetch,
    fetchNextPage,
    isFetchNextPageError,
  }
}
