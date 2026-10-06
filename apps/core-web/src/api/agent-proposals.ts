import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { agentActionKeys } from './agent-actions'
import { fetchWithAuth } from './client'

export type AgentProposal = components['schemas']['AgentProposalResponseDto']
export type AgentProposalListResponse = components['schemas']['AgentProposalListResponseDto']
export type RejectAgentProposalPayload = components['schemas']['RejectAgentProposalDto']

export type AgentProposalStatus = AgentProposal['status']
export type AgentPolicyTier = AgentProposal['tier']

export interface AgentProposalFilters {
  status?: string
  limit?: number
}

export interface RejectAgentProposalParams {
  id: string
  reason?: string
}

export const agentProposalKeys = {
  all: ['agent-proposals'] as const,
  lists: () => [...agentProposalKeys.all, 'list'] as const,
  list: (filters: { status?: string; limit?: number } = {}) => [...agentProposalKeys.lists(), filters] as const,
  details: () => [...agentProposalKeys.all, 'detail'] as const,
  detail: (id: string) => [...agentProposalKeys.details(), id] as const,
}

async function getErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const payload = (await response.json().catch(() => undefined)) as { message?: string } | undefined
  return payload?.message || fallbackMessage
}

export function useAgentProposals(filters: AgentProposalFilters = {}) {
  return useQuery<AgentProposalListResponse>({
    queryKey: agentProposalKeys.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters.status) params.append('status', filters.status)
      if (filters.limit !== undefined) params.append('limit', String(filters.limit))

      const query = params.toString()
      const url = query ? `/api/agent-proposals?${query}` : '/api/agent-proposals'
      const response = await fetchWithAuth(url)

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch agent proposals'))
      }

      return response.json()
    },
  })
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
    },
  })
}
