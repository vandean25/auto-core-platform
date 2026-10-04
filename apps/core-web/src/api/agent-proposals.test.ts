import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import {
  agentProposalKeys,
  useAgentProposals,
  useApproveAgentProposal,
  useRejectAgentProposal,
  type AgentProposal,
  type AgentProposalListResponse,
} from './agent-proposals'
import { agentActionKeys } from './agent-actions'
import { fetchWithAuth } from './client'

vi.mock('./client', () => ({
  fetchWithAuth: vi.fn(),
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

function createWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

function createJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

const mockProposal: AgentProposal = {
  id: 'prop-1',
  tenant_id: 'tenant-1',
  trace_id: 'trace-1',
  action_type: 'workshop_order.add_line',
  tier: 'PROPOSE',
  status: 'PENDING',
  payload_json: { order_id: 'wo-1' },
  preview_json: { description: 'Brake pads' },
  decided_by: null,
  decided_at: null,
  reason: null,
  expires_at: '2026-10-05T12:00:00.000Z',
  created_at: '2026-10-04T12:00:00.000Z',
  updated_at: '2026-10-04T12:00:00.000Z',
}

describe('agent-proposals api hooks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('agentProposalKeys', () => {
    it('generates consistent structured query keys', () => {
      expect(agentProposalKeys.all).toEqual(['agent-proposals'])
      expect(agentProposalKeys.lists()).toEqual(['agent-proposals', 'list'])
      expect(agentProposalKeys.list({ status: 'PENDING', limit: 10 })).toEqual([
        'agent-proposals',
        'list',
        { status: 'PENDING', limit: 10 },
      ])
      expect(agentProposalKeys.details()).toEqual(['agent-proposals', 'detail'])
      expect(agentProposalKeys.detail('prop-123')).toEqual(['agent-proposals', 'detail', 'prop-123'])
    })
  })

  describe('useAgentProposals', () => {
    it('fetches proposals without filters', async () => {
      const mockResponse: AgentProposalListResponse = {
        data: [mockProposal],
      }

      vi.mocked(fetchWithAuth).mockResolvedValue(createJsonResponse(mockResponse))

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useAgentProposals(), { wrapper })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(fetchWithAuth).toHaveBeenCalledWith('/api/agent-proposals')
      expect(result.current.data).toEqual(mockResponse)
    })

    it('fetches proposals with status and limit query params', async () => {
      const mockResponse: AgentProposalListResponse = {
        data: [mockProposal],
      }

      vi.mocked(fetchWithAuth).mockResolvedValue(createJsonResponse(mockResponse))

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(
        () => useAgentProposals({ status: 'PENDING', limit: 20 }),
        { wrapper },
      )

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(fetchWithAuth).toHaveBeenCalledWith('/api/agent-proposals?status=PENDING&limit=20')
      expect(result.current.data).toEqual(mockResponse)
    })

    it('handles query error', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ message: 'Unauthorized supervisor access' }, false),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useAgentProposals(), { wrapper })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error?.message).toBe('Unauthorized supervisor access')
    })
  })

  describe('useApproveAgentProposal', () => {
    it('approves proposal and invalidates proposal and action queries', async () => {
      const approvedProposal: AgentProposal = {
        ...mockProposal,
        status: 'EXECUTED',
        decided_by: 'user-1',
        decided_at: '2026-10-04T12:05:00.000Z',
      }

      vi.mocked(fetchWithAuth).mockResolvedValue(createJsonResponse(approvedProposal))

      const queryClient = createQueryClient()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useApproveAgentProposal(), { wrapper })

      await result.current.mutateAsync('prop-1')

      expect(fetchWithAuth).toHaveBeenCalledWith('/api/agent-proposals/prop-1/approve', {
        method: 'POST',
      })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: agentProposalKeys.all })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: agentActionKeys.all })
    })

    it('handles approve failure', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ message: 'Action requires human execution' }, false),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useApproveAgentProposal(), { wrapper })

      await expect(result.current.mutateAsync('prop-1')).rejects.toThrow(
        'Action requires human execution',
      )
    })
  })

  describe('useRejectAgentProposal', () => {
    it('rejects proposal with reason and invalidates proposal and action queries', async () => {
      const rejectedProposal: AgentProposal = {
        ...mockProposal,
        status: 'REJECTED',
        decided_by: 'user-1',
        decided_at: '2026-10-04T12:05:00.000Z',
        reason: 'Customer cancelled requested repair',
      }

      vi.mocked(fetchWithAuth).mockResolvedValue(createJsonResponse(rejectedProposal))

      const queryClient = createQueryClient()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useRejectAgentProposal(), { wrapper })

      await result.current.mutateAsync({
        id: 'prop-1',
        reason: 'Customer cancelled requested repair',
      })

      expect(fetchWithAuth).toHaveBeenCalledWith('/api/agent-proposals/prop-1/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Customer cancelled requested repair' }),
      })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: agentProposalKeys.all })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: agentActionKeys.all })
    })

    it('handles reject failure', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ message: 'Proposal already rejected' }, false),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useRejectAgentProposal(), { wrapper })

      await expect(
        result.current.mutateAsync({ id: 'prop-1', reason: 'Too late' }),
      ).rejects.toThrow('Proposal already rejected')
    })
  })
})
