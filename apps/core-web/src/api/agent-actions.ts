import { useQuery } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'

export type AgentActionLog = components['schemas']['AgentActionLogResponseDto']
export type AgentActionLogListResponse = components['schemas']['AgentActionLogListResponseDto']
export type AgentActionTraceDetailResponse = components['schemas']['AgentActionTraceDetailResponseDto']

export type AgentActionStatus = AgentActionLog['status']
export type AgentActionTier = AgentActionLog['tier']

export type AgentActionFilters = {
  traceId?: string
  agentId?: string
  status?: AgentActionStatus
  tier?: AgentActionTier
  entityType?: string
  entityId?: string
  fromDate?: string
  toDate?: string
  startDate?: string
  endDate?: string
  limit?: number
  cursor?: string
  [key: string]: unknown
}

export const agentActionKeys = {
  all: ['agent-actions'] as const,
  lists: () => [...agentActionKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown> = {}) => [...agentActionKeys.lists(), filters] as const,
  details: () => [...agentActionKeys.all, 'detail'] as const,
  detail: (traceId: string) => [...agentActionKeys.details(), traceId] as const,
}

async function getErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const payload = (await response.json().catch(() => undefined)) as { message?: string } | undefined
  return payload?.message || fallbackMessage
}

export function useAgentActions(filters: AgentActionFilters = {}) {
  return useQuery<AgentActionLogListResponse>({
    queryKey: agentActionKeys.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams()

      if (filters.traceId) params.append('traceId', filters.traceId)
      if (filters.agentId) params.append('agentId', filters.agentId)
      if (filters.status) params.append('status', filters.status)
      if (filters.tier) params.append('tier', filters.tier)
      if (filters.entityType) params.append('entityType', filters.entityType)
      if (filters.entityId) params.append('entityId', filters.entityId)

      const startDate = filters.startDate ?? filters.fromDate
      if (startDate) params.append('startDate', startDate)

      const endDate = filters.endDate ?? filters.toDate
      if (endDate) params.append('endDate', endDate)

      if (filters.limit !== undefined) params.append('limit', String(filters.limit))
      if (filters.cursor) params.append('cursor', filters.cursor)

      const query = params.toString()
      const url = query ? `/api/agent-actions?${query}` : '/api/agent-actions'
      const response = await fetchWithAuth(url)

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch agent actions'))
      }

      return response.json()
    },
  })
}

export function useAgentActionTraceDetail(traceId: string) {
  return useQuery<AgentActionTraceDetailResponse>({
    queryKey: agentActionKeys.detail(traceId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/agent-actions/${traceId}`)

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch agent action trace detail'))
      }

      return response.json()
    },
    enabled: Boolean(traceId),
  })
}
