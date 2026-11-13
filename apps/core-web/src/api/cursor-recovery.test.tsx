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
import { useInfiniteListRefresh } from '@/hooks/useInfiniteListRefresh'
import { resetClientContextAndRescope } from '@/auth/context-switch-reset'

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
    const handshakeSpy = vi.spyOn(scopeContextClient, 'handshakeFollowingNewerFlight').mockResolvedValue({
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
      }),
      resolveCursorListFailure(client, {
        error: mismatch,
        semanticKey: 'inventory:{}',
        listKey,
        countKey,
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

  // Regression: a 403 after a loaded page kept showing those rows, and "Liste aktualisieren" requested the list again.
  it('403 after a loaded page empties the rows and offers no refresh that calls the list again', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let listCalls = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 1, isCapped: false, scopeContextDigest: 'digest-a' }) } as Response
      }
      if (!target.includes('pagination=cursor')) return apiError(500, 'HTTP_500')
      listCalls += 1
      if (listCalls > 1) return apiError(403, 'HTTP_403')
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'loaded' }],
          meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: 'digest-a' },
        }),
      } as Response
    })

    const { result } = renderHook(
      () => {
        const list = useCursorList<Row>(baseOptions())
        return { list, refresh: useInfiniteListRefresh(list.tableProps.infinite.queryKey) }
      },
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current.list.rows).toEqual([{ id: 'loaded' }]))

    // refetchQueries skips static queries; the observer retry is what the table calls.
    act(() => result.current.list.tableProps.onRetry?.())

    await waitFor(() => expect(isAuthBlockedForEpisode('inventory:{}')).toBe(true))
    await waitFor(() => expect(result.current.list.rows).toEqual([]))
    expect(result.current.refresh.needsRefresh).toBe(false)
    await act(async () => {
      await result.current.refresh.refreshExplicitly()
    })
    expect(listCalls).toBe(2)
  })

  // Regression: a site switch kept the 403 block of the site being left, so the list stayed empty at the new site.
  it('a site switch starts a new episode, so a 403 at the previous site does not block the list', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let site = 'a'
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('/api/auth/scope-context')) {
        return { ok: true, json: async () => ({ scopeContext: 'sc-b', scopeContextDigest: 'digest-b', continuityDigest: 'lineage-1' }) } as Response
      }
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 1, isCapped: false, scopeContextDigest: `digest-${site}` }) } as Response
      }
      if (site === 'a') return apiError(403, 'HTTP_403')
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'site-b' }], meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: 'digest-b' } }),
      } as Response
    })

    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), { wrapper: wrapper(client) })
    await waitFor(() => expect(isAuthBlockedForEpisode('inventory:{}')).toBe(true))

    site = 'b'
    await act(async () => {
      await resetClientContextAndRescope(client, true)
    })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'site-b' }]))
    expect(isAuthBlockedForEpisode('inventory:{}')).toBe(false)
  })

  // Regression: recovery during load-more threw a cancel that TanStack recorded as a failed next page.
  it('recovers a CONTEXT_MISMATCH on load-more to page one without a load-more error', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('/api/auth/scope-context')) {
        return { ok: true, json: async () => ({ ...testScope, continuityDigest: 'lineage-1' }) } as Response
      }
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 2, isCapped: false, scopeContextDigest: 'digest-a' }) } as Response
      }
      if (new URL(target, 'http://acp.test').searchParams.get('cursor') === 'c1') return apiError(412, 'CONTEXT_MISMATCH')
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'a' }], meta: { nextCursor: 'c1', hasNextPage: true, scopeContextDigest: 'digest-a' } }),
      } as Response
    })

    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.tableProps.infinite.hasNextPage).toBe(true))

    await act(async () => {
      await result.current.tableProps.infinite.fetchNextPage()
    })

    await waitFor(() => expect(result.current.tableProps.isFetching).toBe(false))
    expect(result.current.rows).toEqual([{ id: 'a' }])
    expect(result.current.tableProps.infinite.isFetchNextPageError).toBe(false)
    expect(result.current.tableProps.isError).toBe(false)
  })

  it('new sign-in new episode', async () => {
    const before = getCursorEpisodeCounter()
    startNewCursorRecoveryEpisode()
    expect(getCursorEpisodeCounter()).toBe(before + 1)
    resetCursorRecoveryForTests()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const blockedEpisodeCounter = getCursorEpisodeCounter()
    let listsForFreshEpisode = 0
    let listsForBlockedEpisode = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 1, isCapped: false, scopeContextDigest: 'digest-a' }) } as Response
      }
      if (!target.includes('pagination=cursor')) return apiError(500, 'HTTP_500')
      if (getCursorEpisodeCounter() === blockedEpisodeCounter) {
        listsForBlockedEpisode += 1
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
    // First page plus its one page-1 restart.
    await waitFor(() => expect(listsForBlockedEpisode).toBe(2))

    startNewCursorRecoveryEpisode()

    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'fresh' }]))
    expect(listsForFreshEpisode).toBeGreaterThanOrEqual(1)
  })

  it('LIST_CURSOR_INVALID returns restart-page-one when context is valid', async () => {
    const client = new QueryClient()
    const outcome = await resolveCursorListFailure(client, {
      error: new CursorListApiError('LIST_CURSOR_INVALID', 400, 'LIST_CURSOR_INVALID'),
      semanticKey: 'inventory:{}',
      listKey: ['inventory', 'cursor-list', {}, 'digest-a'],
      countKey: ['inventory', 'capped-count', {}, 'digest-a'],
    })
    expect(outcome.type).toBe('restart-page-one')
  })

  // Regression: an invalid-cursor restart spent the handshake budget, so a later CONTEXT_MISMATCH never handshook and
  // "Liste aktualisieren" kept sending the stale scope header.
  it('invalid-cursor restart keeps the handshake budget, and a spent budget makes the explicit refresh handshake', async () => {
    let handshakes = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (!String(url).includes('/api/auth/scope-context')) throw new Error(`unexpected ${url}`)
      handshakes += 1
      return { ok: true, json: async () => ({ ...testScope, continuityDigest: 'lineage-1' }) } as Response
    })
    const failure = (error: CursorListApiError) =>
      resolveCursorListFailure(new QueryClient(), {
        error,
        semanticKey: 'inventory:{}',
        listKey: ['inventory', 'cursor-list', {}, 'digest-a'],
        countKey: ['inventory', 'capped-count', {}, 'digest-a'],
      })
    const mismatch = new CursorListApiError('CONTEXT_MISMATCH', 412, 'CONTEXT_MISMATCH')

    expect(await failure(new CursorListApiError('LIST_CURSOR_INVALID', 400, 'LIST_CURSOR_INVALID'))).toEqual({
      type: 'restart-page-one',
    })
    expect(await failure(mismatch)).toEqual({ type: 'restart-page-one' })
    expect(handshakes).toBe(1)
    expect(scopeContextClient.isScopeExplicitRefreshRequired()).toBe(false)

    expect(await failure(mismatch)).toEqual({ type: 'blocked', externalScope: false })
    expect(handshakes).toBe(1)
    expect(scopeContextClient.isScopeExplicitRefreshRequired()).toBe(true)

    expect(await scopeContextClient.handshakeBeforeExplicitListRefresh()).toBe(true)
    expect(handshakes).toBe(2)
  })

  // Regression: after a spent handshake budget the list kept "Erneut laden" beside "Liste aktualisieren".
  it('offers no retry controls once a spent handshake budget latches the explicit refresh', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('/api/auth/scope-context')) {
        return { ok: true, json: async () => ({ ...testScope, continuityDigest: 'lineage-1' }) } as Response
      }
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 1, isCapped: false, scopeContextDigest: 'digest-a' }) } as Response
      }
      return apiError(412, 'CONTEXT_MISMATCH')
    })

    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.tableProps.isError).toBe(true))

    act(() => result.current.tableProps.onRetry?.())

    await waitFor(() => expect(scopeContextClient.isScopeExplicitRefreshRequired()).toBe(true))
    await waitFor(() => expect(result.current.tableProps.onRetry).toBeUndefined())
    expect(result.current.tableProps.isError).toBe(false)
    expect(result.current.tableProps.infinite.retryCount).toBeUndefined()
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
    await waitFor(() => expect(result.current.tableProps.infinite.hasNextPage).toBe(true))
    await act(async () => {
      await result.current.tableProps.infinite.fetchNextPage()
    })
    expect(sawRestartWithoutCursor).toBe(true)
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'restarted' }]))
  })
})
