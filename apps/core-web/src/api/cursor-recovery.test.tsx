import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as scopeContextClient from '@/auth/scope-context-client'
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
    const handshakeSpy = vi.spyOn(scopeContextClient, 'handshakeScopeContext').mockResolvedValue({
      kind: 'same',
      context: testScope,
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

    expect(handshakeSpy).toHaveBeenCalledTimes(1)
    expect(cursorEpisodeBudgetForTests('inventory:{}')).toBe(0)
    handshakeSpy.mockRestore()
  })

  it('403 blocks without retry', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let listCalls = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 0, isCapped: false, scopeContextDigest: 'digest-a' }) } as Response
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
    expect(isAuthBlockedForEpisode('inventory:{}')).toBe(true)
    expect(listCalls).toBe(1)
  })

  it('new sign-in new episode', async () => {
    const before = getCursorEpisodeCounter()
    startNewCursorRecoveryEpisode()
    expect(getCursorEpisodeCounter()).toBe(before + 1)
    resetCursorRecoveryForTests()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const blockedEpisodeCounter = getCursorEpisodeCounter()
    let listsForFreshEpisode = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 1, isCapped: false, scopeContextDigest: 'digest-a' }) } as Response
      }
      if (!target.includes('pagination=cursor')) return apiError(500, 'HTTP_500')
      if (getCursorEpisodeCounter() === blockedEpisodeCounter) {
        return apiError(400, 'LIST_CURSOR_INVALID')
      }
      listsForFreshEpisode += 1
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'fresh' }],
          meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: 'digest-a' },
        }),
      } as Response
    })

    renderHook(() => useCursorList<Row>(baseOptions()), { wrapper: wrapper(client) })
    await waitFor(() => expect(cursorEpisodeBudgetForTests('inventory:{}')).toBe(0))

    startNewCursorRecoveryEpisode()

    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'fresh' }]))
    expect(listsForFreshEpisode).toBeGreaterThanOrEqual(1)
  })

  it('LIST_CURSOR_INVALID restarts page one with a live signal', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let servedFirstPage = false
    let sawRestartWithoutCursor = false
    vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 2, isCapped: false, scopeContextDigest: 'digest-a' }) } as Response
      }
      const params = new URL(target, 'http://acp.test').searchParams
      if (params.get('cursor') === 'cur-1') {
        return apiError(400, 'LIST_CURSOR_INVALID')
      }
      if (!params.get('cursor') && servedFirstPage) {
        expect(init?.signal?.aborted).toBe(false)
        sawRestartWithoutCursor = true
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'restarted' }],
            meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: 'digest-a' },
          }),
        } as Response
      }
      servedFirstPage = true
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'a' }],
          meta: { nextCursor: 'cur-1', hasNextPage: true, scopeContextDigest: 'digest-a' },
        }),
      } as Response
    })

    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'a' }]))
  await act(async () => {
      await result.current.tableProps.infinite.fetchNextPage()
    })
    await waitFor(() => expect(result.current.rows.some((row) => row.id === 'restarted')).toBe(true))
    expect(sawRestartWithoutCursor).toBe(true)
  })
})
