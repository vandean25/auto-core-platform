import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import {
  agentProposalKeys,
  chunkAgentProposalIds,
  useAgentProposals,
  useAgentProposalsByIds,
  useApproveAgentProposal,
  useRejectAgentProposal,
  type AgentProposal,
  type AgentProposalListResponse,
} from './agent-proposals'
import { agentActionKeys } from './agent-actions'
import { agentSupervisionTriageKeys } from './agent-supervision-triage'
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
  effective_summary: {
    target_type: 'WorkshopOrder',
    target_id: 'wo-1',
    amount_eur: null,
  },
  workshop_order_summary: null,
  preview_json: { description: 'Brake pads' },
  created_by_agent: null,
  decided_by: null,
  decided_by_name: null,
  decided_by_email: null,
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
      expect(agentProposalKeys.detail('prop-123')).toEqual([
        'agent-proposals',
        'detail',
        'prop-123',
      ])
    })
  })

  describe('chunkAgentProposalIds', () => {
    it('splits ids into batches of at most 100', () => {
      const ids = Array.from({ length: 205 }, (_, index) => `id-${index}`)
      const chunks = chunkAgentProposalIds(ids)
      expect(chunks).toHaveLength(3)
      expect(chunks[0]).toHaveLength(100)
      expect(chunks[1]).toHaveLength(100)
      expect(chunks[2]).toHaveLength(5)
    })
  })

  describe('useAgentProposalsByIds', () => {
    it('fetches each id batch and merges proposal rows', async () => {
      const ids = Array.from({ length: 101 }, (_, index) => `prop-${index}`)
      const firstBatch = ids.slice(0, 100).map((id) => ({
        ...mockProposal,
        id,
      }))
      const secondBatch = [{ ...mockProposal, id: ids[100] }]

      vi.mocked(fetchWithAuth)
        .mockResolvedValueOnce(createJsonResponse({ data: firstBatch }))
        .mockResolvedValueOnce(createJsonResponse({ data: secondBatch }))

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useAgentProposalsByIds(ids), {
        wrapper,
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(fetchWithAuth).toHaveBeenCalledTimes(2)
      expect(result.current.data?.data).toHaveLength(101)
      expect(result.current.isError).toBe(false)
    })
  })

  describe('useAgentProposals', () => {
    it('fetches proposals without filters', async () => {
      const mockResponse: AgentProposalListResponse = {
        data: [mockProposal],
      }

      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(mockResponse),
      )

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

      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(mockResponse),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(
        () => useAgentProposals({ status: 'PENDING', limit: 20 }),
        { wrapper },
      )

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/agent-proposals?status=PENDING&limit=20',
      )
      expect(result.current.data).toEqual(mockResponse)
    })

    it('handles query error', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(
          { message: 'Unauthorized supervisor access' },
          false,
        ),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useAgentProposals(), { wrapper })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error?.message).toBe('Agenten-Vorschläge konnten nicht geladen werden')
      expect(result.current.error?.message).not.toContain('Unauthorized supervisor access')
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

      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(approvedProposal),
      )

      const queryClient = createQueryClient()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useApproveAgentProposal(), {
        wrapper,
      })

      await result.current.mutateAsync('prop-1')

      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/agent-proposals/prop-1/approve',
        {
          method: 'POST',
        },
      )
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: agentProposalKeys.all,
      })
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: agentActionKeys.all,
      })
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: agentSupervisionTriageKeys.all,
      })
    })

    it('handles approve failure', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(
          { message: 'Action requires human execution' },
          false,
        ),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useApproveAgentProposal(), {
        wrapper,
      })

      await expect(result.current.mutateAsync('prop-1')).rejects.toThrow(
        'Fehler beim Genehmigen des Vorschlags',
      )
      await expect(result.current.mutateAsync('prop-1')).rejects.not.toThrow(
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

      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(rejectedProposal),
      )

      const queryClient = createQueryClient()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useRejectAgentProposal(), { wrapper })

      await result.current.mutateAsync({
        id: 'prop-1',
        reason: 'Customer cancelled requested repair',
      })

      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/api/agent-proposals/prop-1/reject',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: 'Customer cancelled requested repair',
          }),
        },
      )
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: agentProposalKeys.all,
      })
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: agentActionKeys.all,
      })
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: agentSupervisionTriageKeys.all,
      })
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
      ).rejects.toThrow('Fehler beim Ablehnen des Vorschlags')
      await expect(
        result.current.mutateAsync({ id: 'prop-1', reason: 'Too late' }),
      ).rejects.not.toThrow('Proposal already rejected')
    })
  })
})
