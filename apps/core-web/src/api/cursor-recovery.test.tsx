import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getCursorEpisodeCounter,
  resetScopeContextClientForTests,
  seedValidatedScopeContextForTests,
} from '@/auth/scope-context-client'
import {
  cursorEpisodeBudgetForTests,
  isAuthBlockedForEpisode,
  resetCursorRecoveryForTests,
  resolveCursorListFailure,
  startNewCursorRecoveryEpisode,
} from './cursor-recovery'
import { CursorListApiError } from './cursor-list-api-error'
import { fetchWithAuth } from './client'
import { useCursorList } from './cursor-list'

vi.mock('./client', () => ({ fetchWithAuth: vi.fn() }))

type Row = { id: string }

const testScope = { scopeContext: 'sc-test', scopeContextDigest: 'digest-a' }

function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const baseOptions = () => ({
  enabled: true,
  path: '/api/inventory',
  countPath: '/api/inventory/capped-count',
  semanticEpisodeKey: 'inventory:{}',
  listKey: ['inventory', 'cursor-list', {}],
  countKey: ['inventory', 'capped-count', {}],
  params: {},
  countParams: {},
})

function apiError(status: number, code: string) {
  return {
    ok: false,
    status,
    json: async () => ({ statusCode: status, code, message: code }),
  } as Response
}

describe('cursor recovery (ADR-0038 §9)', () => {
  beforeEach(() => {
    resetScopeContextClientForTests()
    resetCursorRecoveryForTests()
    seedValidatedScopeContextForTests(testScope, 'lineage-1')
  })

  afterEach(() => vi.clearAllMocks())

  it('cursorRecovery_shared_episode_budget', async () => {
    let handshakeCalls = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (!target.includes('scope-context')) {
        return apiError(400, 'LIST_CURSOR_INVALID')
      }
      handshakeCalls += 1
      return {
        ok: true,
        json: async () => ({
          scopeContext: 'sc',
          scopeContextDigest: 'digest-a',
          continuityDigest: 'lineage-1',
        }),
      } as Response
    })

    const client = new QueryClient()
    const listKey = ['inventory', 'cursor-list', {}, 'digest-a']
    const countKey = ['inventory', 'capped-count', {}, 'digest-a']
    const mismatch = new CursorListApiError('CONTEXT_MISMATCH', 412, 'CONTEXT_MISMATCH')

  await Promise.all([
      resolveCursorListFailure(client, {
        error: mismatch,
        semanticKey: 'inventory:{}',
        listKey,
        countKey,
        contextValid: true,
      }),
      resolveCursorListFailure(client, {
        error: mismatch,
        semanticKey: 'inventory:{}',
        listKey,
        countKey,
        contextValid: true,
      }),
    ])

    expect(handshakeCalls).toBe(1)
    expect(cursorEpisodeBudgetForTests('inventory:{}')).toBe(0)
  })

  it('403 blocks without retry', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const listKey = ['inventory', 'cursor-list', {}, 'digest-a']
    const countKey = ['inventory', 'capped-count', {}, 'digest-a']
    await resolveCursorListFailure(client, {
      error: new CursorListApiError('HTTP_403', 403, 'HTTP_403'),
      semanticKey: 'inventory:{}',
      listKey,
      countKey,
      contextValid: true,
    })
    expect(isAuthBlockedForEpisode('inventory:{}')).toBe(true)

    let listCalls = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 0, isCapped: false }) } as Response
      }
      if (target.includes('pagination=cursor')) {
        listCalls += 1
        return apiError(403, 'HTTP_403')
      }
      return apiError(500, 'HTTP_500')
    })

    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.tableProps.isLoading).toBe(false))
    expect(result.current.rows).toEqual([])
    expect(listCalls).toBe(0)
  })

  it('new sign-in new episode', async () => {
    const before = getCursorEpisodeCounter()
    startNewCursorRecoveryEpisode()
    expect(getCursorEpisodeCounter()).toBe(before + 1)
    resetCursorRecoveryForTests()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 0, isCapped: false }) } as Response
      }
      return apiError(400, 'LIST_CURSOR_INVALID')
    })

    renderHook(() => useCursorList<Row>(baseOptions()), { wrapper: wrapper(client) })
    await waitFor(() => expect(vi.mocked(fetchWithAuth).mock.calls.length).toBeGreaterThan(0))

    startNewCursorRecoveryEpisode()
    renderHook(() => useCursorList<Row>(baseOptions()), { wrapper: wrapper(client) })
    const invalidCalls = vi
      .mocked(fetchWithAuth)
      .mock.calls.filter((call) => String(call[0]).includes('/api/inventory?')).length
    expect(invalidCalls).toBeGreaterThanOrEqual(2)
  })
})
