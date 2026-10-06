import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import {
  agentActionKeys,
  useAgentActions,
  useAgentActionTraceDetail,
  type AgentActionLogListResponse,
  type AgentActionTraceDetailResponse,
} from './agent-actions'
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

describe('agent-actions api hooks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('agentActionKeys', () => {
    it('generates consistent structured query keys', () => {
      expect(agentActionKeys.all).toEqual(['agent-actions'])
      expect(agentActionKeys.lists()).toEqual(['agent-actions', 'list'])
      expect(agentActionKeys.list({ status: 'EXECUTED', limit: 20 })).toEqual([
        'agent-actions',
        'list',
        { status: 'EXECUTED', limit: 20 },
      ])
      expect(agentActionKeys.details()).toEqual(['agent-actions', 'detail'])
      expect(agentActionKeys.detail('trace-123')).toEqual([
        'agent-actions',
        'detail',
        'trace-123',
      ])
    })
  })

  describe('useAgentActions', () => {
    it('fetches agent actions without filters', async () => {
      const mockData: AgentActionLogListResponse = {
        data: [
          {
            id: 'act-1',
            tenantId: 'tenant-1',
            traceId: 'trace-1',
            actorType: 'AGENT',
            actionType: 'workshop_order.add_line',
            tier: 'PROPOSE',
            status: 'EXECUTED',
            reversible: false,
            createdAt: '2026-10-04T12:00:00.000Z',
          },
        ],
        nextCursor: null,
      }

      vi.mocked(fetchWithAuth).mockResolvedValue(createJsonResponse(mockData))

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useAgentActions(), { wrapper })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(fetchWithAuth).toHaveBeenCalledWith('/api/agent-actions')
      expect(result.current.data?.pages).toEqual([mockData])
    })

    it('fetches agent actions with filters including fromDate and toDate mapped to startDate and endDate', async () => {
      const mockData: AgentActionLogListResponse = {
        data: [],
        nextCursor: null,
      }

      vi.mocked(fetchWithAuth).mockResolvedValue(createJsonResponse(mockData))

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(
        () =>
          useAgentActions({
            traceId: 'trace-abc',
            agentId: 'agent-1',
            status: 'EXECUTED',
            tier: 'AUTO',
            entityType: 'WorkshopOrder',
            entityId: 'wo-1',
            fromDate: '2026-10-01T00:00:00.000Z',
            toDate: '2026-10-04T23:59:59.000Z',
            limit: 25,
            cursor: 'cursor-token',
          }),
        { wrapper },
      )

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      const expectedUrl =
        '/api/agent-actions?traceId=trace-abc&agentId=agent-1&status=EXECUTED&tier=AUTO&entityType=WorkshopOrder&entityId=wo-1&startDate=2026-10-01T00%3A00%3A00.000Z&endDate=2026-10-04T23%3A59%3A59.000Z&limit=25&cursor=cursor-token'
      expect(fetchWithAuth).toHaveBeenCalledWith(expectedUrl)
      expect(result.current.data?.pages).toEqual([mockData])
    })

    it('handles error response from server', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ message: 'Forbidden' }, false),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(() => useAgentActions(), { wrapper })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error?.message).toBe('Forbidden')
    })
  })

  describe('useAgentActionTraceDetail', () => {
    it('fetches trace details by traceId', async () => {
      const mockDetail: AgentActionTraceDetailResponse = {
        logs: [
          {
            id: 'log-1',
            tenantId: 'tenant-1',
            traceId: 'trace-xyz',
            actorType: 'AGENT',
            actionType: 'workshop_order.add_line',
            tier: 'PROPOSE',
            status: 'EXECUTED',
            reversible: false,
            createdAt: '2026-10-04T12:00:00.000Z',
          },
        ],
        auditEntries: [
          {
            id: 'audit-1',
            tenantId: 'tenant-1',
            entityType: 'WorkshopOrder',
            entityId: 'wo-1',
            action: 'UPDATE',
            actorType: 'SYSTEM',
            occurredAt: '2026-10-04T12:00:00.000Z',
          },
        ],
      }

      vi.mocked(fetchWithAuth).mockResolvedValue(createJsonResponse(mockDetail))

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(
        () => useAgentActionTraceDetail('trace-xyz'),
        { wrapper },
      )

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(fetchWithAuth).toHaveBeenCalledWith('/api/agent-actions/trace-xyz')
      expect(result.current.data).toEqual(mockDetail)
    })

    it('handles error response when trace detail fails', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ message: 'Trace not found' }, false),
      )

      const queryClient = createQueryClient()
      const wrapper = createWrapper(queryClient)

      const { result } = renderHook(
        () => useAgentActionTraceDetail('trace-err'),
        { wrapper },
      )

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error?.message).toBe('Trace not found')
    })
  })
})
