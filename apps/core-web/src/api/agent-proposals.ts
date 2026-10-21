import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useMemo } from 'react'
import type { components } from './generated/openapi'
import { agentActionKeys } from './agent-actions'
import { agentSupervisionTriageKeys } from './agent-supervision-triage'
import { fetchWithAuth } from './client'

export type AgentProposal = components['schemas']['AgentProposalResponseDto']
export type AgentProposalListResponse = components['schemas']['AgentProposalListResponseDto']

export const MAX_AGENT_PROPOSAL_IDS_PER_REQUEST = 100

export interface AgentProposalFilters {
  status?: string
  limit?: number
  ids?: string[]
}

export interface RejectAgentProposalParams {
  id: string
  reason?: string
}

export const agentProposalKeys = {
  all: ['agent-proposals'] as const,
  lists: () => [...agentProposalKeys.all, 'list'] as const,
  list: (filters: AgentProposalFilters = {}) =>
    [...agentProposalKeys.lists(), filters] as const,
  details: () => [...agentProposalKeys.all, 'detail'] as const,
  detail: (id: string) => [...agentProposalKeys.details(), id] as const,
}

async function getErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const payload = (await response.json().catch(() => undefined)) as { message?: string } | undefined
  return payload?.message || fallbackMessage
}

export function chunkAgentProposalIds(
  ids: string[],
  chunkSize = MAX_AGENT_PROPOSAL_IDS_PER_REQUEST,
): string[][] {
  if (chunkSize <= 0) {
    return []
  }
  const chunks: string[][] = []
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize))
  }
  return chunks
}

export async function fetchAgentProposalsList(
  filters: AgentProposalFilters = {},
): Promise<AgentProposalListResponse> {
  const params = new URLSearchParams()
  if (filters.status) params.append('status', filters.status)
  if (filters.limit !== undefined) params.append('limit', String(filters.limit))
  if (filters.ids?.length) {
    for (const id of filters.ids) {
      params.append('ids', id)
    }
  }

  const query = params.toString()
  const url = query ? `/api/agent-proposals?${query}` : '/api/agent-proposals'
  const response = await fetchWithAuth(url)

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, 'Failed to fetch agent proposals'))
  }

  return response.json()
}

export function useAgentProposals(
  filters: AgentProposalFilters = {},
  enabled = true,
) {
  return useQuery<AgentProposalListResponse>({
    queryKey: agentProposalKeys.list(filters),
    enabled,
    queryFn: () => fetchAgentProposalsList(filters),
  })
}

export function useAgentProposalsByIds(
  ids: string[],
  options: { status?: string; enabled?: boolean } = {},
) {
  const { status = 'PENDING', enabled = true } = options
  const chunks = useMemo(() => chunkAgentProposalIds(ids), [ids])

  const results = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: agentProposalKeys.list({
        status,
        limit: chunk.length,
        ids: chunk,
      }),
      enabled: enabled && chunk.length > 0,
      queryFn: () =>
        fetchAgentProposalsList({
          status,
          limit: chunk.length,
          ids: chunk,
        }),
    })),
  })

  const data = useMemo((): AgentProposalListResponse => {
    const merged = results.flatMap((result) => result.data?.data ?? [])
    return { data: merged }
  }, [results])

  const isLoading = results.some((result) => result.isLoading)
  const isError = results.some((result) => result.isError)

  const refetch = () => {
    for (const result of results) {
      void result.refetch()
    }
  }

  return { data, isLoading, isError, refetch }
}

export function useApproveAgentProposal() {
  const queryClient = useQueryClient()

  return useMutation<AgentProposal, Error, string>({
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/agent-proposals/${id}/approve`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to approve agent proposal'))
      }

      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentProposalKeys.all })
      queryClient.invalidateQueries({ queryKey: agentActionKeys.all })
      queryClient.invalidateQueries({ queryKey: agentSupervisionTriageKeys.all })
    },
  })
}

export function useRejectAgentProposal() {
  const queryClient = useQueryClient()

  return useMutation<AgentProposal, Error, RejectAgentProposalParams>({
    mutationFn: async ({ id, reason }: RejectAgentProposalParams) => {
      const response = await fetchWithAuth(`/api/agent-proposals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason !== undefined ? { reason } : {}),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to reject agent proposal'))
      }

      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentProposalKeys.all })
      queryClient.invalidateQueries({ queryKey: agentActionKeys.all })
      queryClient.invalidateQueries({ queryKey: agentSupervisionTriageKeys.all })
    },
  })
}
