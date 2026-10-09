import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import * as decisionShadowApi from './decision-shadow-logs'
import {
  decisionShadowLogKeys,
  useDecisionShadowLogs,
  type DecisionShadowLogListResponse,
} from './decision-shadow-logs'
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

const madeUpRow = {
  id: 'shadow-1',
  traceId: '00000000-0000-4000-8000-00000000a001',
  useCase: 'document_sort' as const,
  suggestion: {
    choice: 'Lieferschein',
    confidence: 0.6,
    rationale: 'Made-up delivery note keywords',
  },
  actualOutcome: { choice: 'Rechnung', source: 'heuristic_classifier' },
  latencyMs: 95,
  error: null,
  provider: 'openrouter-jev',
  model: 'typesafe/jev-1.13',
  match: false,
  createdAt: '2026-10-02T09:30:00.000Z',
}

describe('decision-shadow-logs api hooks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('exposes stable query keys', () => {
    expect(decisionShadowLogKeys.all).toEqual(['decision-shadow-logs'])
    expect(decisionShadowLogKeys.lists()).toEqual([
      'decision-shadow-logs',
      'list',
    ])
    expect(
      decisionShadowLogKeys.list({ useCase: 'document_sort', limit: 50 }),
    ).toEqual([
      'decision-shadow-logs',
      'list',
      { useCase: 'document_sort', limit: 50 },
    ])
  })

  it('exports only read hooks, so no apply or mutate hook is reachable from the UI', () => {
    const hookNames = Object.keys(decisionShadowApi).filter((name) =>
      /^use/.test(name),
    )
    expect(hookNames).toEqual(['useDecisionShadowLogs'])
  })

  it('fetches without query params when no filters are given', async () => {
    const mockData: DecisionShadowLogListResponse = {
      data: [madeUpRow],
      nextCursor: null,
    }
    vi.mocked(fetchWithAuth).mockResolvedValue(createJsonResponse(mockData))

    const { result } = renderHook(() => useDecisionShadowLogs(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(fetchWithAuth).toHaveBeenCalledWith('/api/decision-shadow-logs')
    expect(result.current.data?.pages).toEqual([mockData])
  })

  it('serialises use case and created_at filters into the GET query string', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse({ data: [], nextCursor: null }),
    )

    const { result } = renderHook(
      () =>
        useDecisionShadowLogs({
          useCase: 'import_row_matching',
          startDate: '2026-10-01T00:00:00.000Z',
          endDate: '2026-10-03T23:59:59.999Z',
          limit: 50,
        }),
      { wrapper: createWrapper(createQueryClient()) },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(fetchWithAuth).toHaveBeenCalledWith(
      '/api/decision-shadow-logs?useCase=import_row_matching&startDate=2026-10-01T00%3A00%3A00.000Z&endDate=2026-10-03T23%3A59%3A59.999Z&limit=50',
    )
  })

  it('requests the next page with the server cursor', async () => {
    vi.mocked(fetchWithAuth)
      .mockResolvedValueOnce(
        createJsonResponse({ data: [madeUpRow], nextCursor: 'older-cursor' }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          data: [{ ...madeUpRow, id: 'shadow-0' }],
          nextCursor: null,
        }),
      )

    const { result } = renderHook(
      () => useDecisionShadowLogs({ limit: 1 }),
      { wrapper: createWrapper(createQueryClient()) },
    )

    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true)
    })

    await result.current.fetchNextPage()

    await waitFor(() => {
      expect(result.current.data?.pages).toHaveLength(2)
    })
    expect(fetchWithAuth).toHaveBeenLastCalledWith(
      '/api/decision-shadow-logs?limit=1&cursor=older-cursor',
    )
  })

  it('surfaces the server message when the request is forbidden', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse({ message: 'Tenant supervisor or admin access is required.' }, false),
    )

    const { result } = renderHook(() => useDecisionShadowLogs(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toEqual(
      new Error('Tenant supervisor or admin access is required.'),
    )
  })
})
