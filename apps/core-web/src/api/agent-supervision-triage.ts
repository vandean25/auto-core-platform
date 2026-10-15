import { useQuery } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'

export type AgentSupervisionTriageItem =
  components['schemas']['AgentSupervisionTriageItemDto']
export type AgentSupervisionTriageListResponse =
  components['schemas']['AgentSupervisionTriageListResponseDto']

export interface AgentSupervisionTriageFilters {
  limit?: number
  cursor?: string
}

export const agentSupervisionTriageKeys = {
  all: ['agent-supervision', 'triage'] as const,
  lists: () => [...agentSupervisionTriageKeys.all, 'list'] as const,
  list: (filters: AgentSupervisionTriageFilters = {}) =>
    [...agentSupervisionTriageKeys.lists(), filters] as const,
}

async function getErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  const payload = (await response.json().catch(() => undefined)) as
    | { message?: string }
    | undefined
  return payload?.message || fallbackMessage
}

export function useAgentSupervisionTriage(
  filters: AgentSupervisionTriageFilters = {},
  enabled = true,
) {
  return useQuery<AgentSupervisionTriageListResponse>({
    queryKey: agentSupervisionTriageKeys.list(filters),
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters.limit !== undefined) {
        params.append('limit', String(filters.limit))
      }
      if (filters.cursor) {
        params.append('cursor', filters.cursor)
      }
      const query = params.toString()
      const url = query
        ? `/api/agent-supervision/triage?${query}`
        : '/api/agent-supervision/triage'
      const response = await fetchWithAuth(url)
      if (!response.ok) {
        throw new Error(
          await getErrorMessage(response, 'Failed to fetch supervision triage'),
        )
      }
      return response.json()
    },
  })
}
