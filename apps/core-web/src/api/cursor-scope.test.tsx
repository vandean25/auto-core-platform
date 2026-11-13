import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bumpProtectedScopeGeneration,
  handshakeBeforeExplicitListRefresh,
  handshakeScopeContext,
  invalidateProtectedScopeContext,
  isScopeContextQuarantined,
  isScopeExplicitRefreshRequired,
  resetScopeContextClientForTests,
  SCOPE_CONTEXT_HEADER,
  seedValidatedScopeContextForTests,
} from '@/auth/scope-context-client'
import { resetClientContextAndRescope } from '@/auth/client-session-reset'
import { refreshInfiniteList } from '@/lib/infinite-list-query'
import { fetchWithAuth } from './client'
import { useCursorList } from './cursor-list'

vi.mock('./client', () => ({ fetchWithAuth: vi.fn() }))

type Row = { id: string }

const testScope = { scopeContext: 'sc-test', scopeContextDigest: 'digest-a' }

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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

describe('cursor scope (ADR-0038)', () => {
  beforeEach(() => {
    resetScopeContextClientForTests()
    seedValidatedScopeContextForTests(testScope)
  })

  afterEach(() => vi.clearAllMocks())

  it('cursorScope_resync_rejects_late_results', async () => {
    let resolveList: (value: Response) => void
    const listPromise = new Promise<Response>((resolve) => {
      resolveList = resolve
    })

    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return {
          ok: true,
          json: async () => ({ count: 1, isCapped: false, scopeContextDigest: 'digest-a' }),
        } as Response
      }
      return listPromise
    })

    const { result } = renderHook(
      () => useCursorList<Row>(baseOptions()),
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(result.current.tableProps.isLoading).toBe(true))
    act(() => bumpProtectedScopeGeneration())

    resolveList!({
      ok: true,
      json: async () => ({
        data: [{ id: 'late' }],
        meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: 'digest-a' },
      }),
    } as Response)

    await waitFor(() => expect(result.current.rows).toEqual([]))
    await waitFor(
      () => {
        expect(result.current.tableProps.isError).toBe(false)
      },
      { timeout: 2_000 },
    )
  })

  // Regression: a page that echoed another scope was dropped silently and the list stayed empty with no way back.
  it('drops a cursor page that echoes a foreign scope digest and recovers through the explicit refresh', async () => {
    let echoedDigest = 'digest-foreign'
    const readPage = vi.fn(async () => ({
      data: [{ id: echoedDigest === 'digest-a' ? 'fresh' : 'foreign' }],
      meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: echoedDigest },
    }))
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('/api/auth/scope-context')) {
        return { ok: true, json: async () => ({ ...testScope, continuityDigest: 'digest-a' }) } as Response
      }
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 1, isCapped: false, scopeContextDigest: 'digest-a' }) } as Response
      }
      return { ok: true, json: readPage } as unknown as Response
    })

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })

    await waitFor(() => expect(readPage).toHaveBeenCalled())
    await waitFor(() => expect(isScopeExplicitRefreshRequired()).toBe(true))
    expect(isScopeContextQuarantined()).toBe(true)
    expect(result.current.rows).toEqual([])
    expect(result.current.tableProps.isError).toBe(false)

    echoedDigest = 'digest-a'
    await act(async () => {
      expect(await handshakeBeforeExplicitListRefresh()).toBe(true)
      await refreshInfiniteList(client, [...baseOptions().listKey, 'digest-a'])
    })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'fresh' }]))
    expect(isScopeExplicitRefreshRequired()).toBe(false)
  })

  // Regression: before the first handshake the disabled list reported no loading and painted "Keine Ergebnisse.".
  it('keeps the list loading until the first handshake installs a scope', async () => {
    resetScopeContextClientForTests()

    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), { wrapper: wrapper() })

    expect(result.current.tableProps.isLoading).toBe(true)
    expect(result.current.rows).toEqual([])
    expect(fetchWithAuth).not.toHaveBeenCalled()
  })

  // Regression: a site switch refetched lists with the previous scope header, and the late handshake then hid the rows.
  it('loads the list with the new scope after an in-tab site switch and keeps it through a focus handshake', async () => {
    seedValidatedScopeContextForTests(testScope, 'lineage-1')
    let serverScope = testScope
    const listHeaders: Array<string | null> = []
    vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
      const target = String(url)
      const digest = serverScope.scopeContextDigest
      if (target.includes('/api/auth/scope-context')) {
        return { ok: true, json: async () => ({ ...serverScope, continuityDigest: 'lineage-1' }) } as Response
      }
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 1, isCapped: false, scopeContextDigest: digest }) } as Response
      }
      listHeaders.push(new Headers(init?.headers).get(SCOPE_CONTEXT_HEADER))
      return {
        ok: true,
        json: async () => ({ data: [{ id: digest }], meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: digest } }),
      } as Response
    })

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'digest-a' }]))

    serverScope = { scopeContext: 'sc-b', scopeContextDigest: 'digest-b' }
    await act(async () => {
      await resetClientContextAndRescope(client, true)
    })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'digest-b' }]))
    expect(listHeaders).toEqual(['sc-test', 'sc-b'])
    expect(isScopeExplicitRefreshRequired()).toBe(false)

    await act(async () => {
      invalidateProtectedScopeContext()
      await handshakeScopeContext()
    })

    expect(isScopeContextQuarantined()).toBe(false)
    expect(result.current.rows).toEqual([{ id: 'digest-b' }])
  })

  // Regression: a quarantined list hid its rows but painted "Keine Ergebnisse." under the previous capped count.
  it('shows a quarantined list as loading without the previous count', async () => {
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (String(url).includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 7, isCapped: false, scopeContextDigest: 'digest-a' }) } as Response
      }
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'a' }], meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: 'digest-a' } }),
      } as Response
    })

    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.tableProps.infinite.totalCount).toEqual(expect.objectContaining({ count: 7 })))

    act(() => invalidateProtectedScopeContext())

    expect(result.current.rows).toEqual([])
    expect(result.current.tableProps.isLoading).toBe(true)
    expect(result.current.tableProps.infinite.totalCount).toBeUndefined()
  })

  it('external scope change blocks', async () => {
    let activeDigest = 'digest-a'
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('/api/auth/scope-context')) {
        activeDigest = 'digest-b'
        return {
          ok: true,
          json: async () => ({
            scopeContext: 'sc-new',
            scopeContextDigest: 'digest-b',
            continuityDigest: 'lineage-1',
          }),
        } as Response
      }
      if (target.includes('capped-count')) {
        return {
          ok: true,
          json: async () => ({ count: 1, isCapped: false, scopeContextDigest: activeDigest }),
        } as Response
      }
      const rowId = activeDigest === 'digest-b' ? 'refreshed' : 'a'
      return {
        ok: true,
        json: async () => ({
          data: [{ id: rowId }],
          meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: activeDigest },
        }),
      } as Response
    })

    seedValidatedScopeContextForTests(testScope, 'lineage-1')

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(
      () => useCursorList<Row>(baseOptions()),
      {
        wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
      },
    )

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'a' }]))

    await act(async () => {
      await handshakeScopeContext({ force: true })
    })

    expect(result.current.rows).toEqual([])
    const scopeContextClient = await import('@/auth/scope-context-client')
    expect(scopeContextClient.isScopeContextQuarantined()).toBe(true)

    const scopedListKey = [...baseOptions().listKey, 'digest-b'] as const
    await act(async () => {
      expect(await handshakeBeforeExplicitListRefresh()).toBe(true)
      await refreshInfiniteList(client, scopedListKey)
    })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'refreshed' }]))
    expect(scopeContextClient.isScopeContextQuarantined()).toBe(false)
  })

  it('keeps rows empty when a same handshake follows external-scope', async () => {
    seedValidatedScopeContextForTests(testScope, 'lineage-1')
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('/api/auth/scope-context')) {
        return {
          ok: true,
          json: async () => ({
            scopeContext: 'sc-new',
            scopeContextDigest: 'digest-b',
            continuityDigest: 'lineage-1',
          }),
        } as Response
      }
      if (target.includes('capped-count')) {
        return {
          ok: true,
          json: async () => ({ count: 1, isCapped: false, scopeContextDigest: 'digest-a' }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'a' }],
          meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: 'digest-a' },
        }),
      } as Response
    })

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'a' }]))

    await act(async () => {
      await handshakeScopeContext({ force: true })
      await handshakeScopeContext()
    })

    expect(result.current.rows).toEqual([])
    expect(isScopeContextQuarantined()).toBe(true)
  })

  it('does not show rows from the previous digest as placeholder after a session lineage change', async () => {
    seedValidatedScopeContextForTests(testScope, 'lineage-1')
    let sessionDigestActive = false
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('/api/auth/scope-context')) {
        sessionDigestActive = true
        return {
          ok: true,
          json: async () => ({
            scopeContext: 'sc-session',
            scopeContextDigest: 'digest-c',
            continuityDigest: 'lineage-2',
          }),
        } as Response
      }
      const listDigest = sessionDigestActive ? 'digest-c' : 'digest-a'
      if (target.includes('capped-count')) {
        return {
          ok: true,
          json: async () => ({ count: 1, isCapped: false, scopeContextDigest: listDigest }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({
          data: [{ id: sessionDigestActive ? 'session-row' : 'a' }],
          meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: listDigest },
        }),
      } as Response
    })

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'a' }]))

    await act(async () => {
      await handshakeScopeContext({ force: true })
    })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'session-row' }]))
    expect(result.current.rows.some((row) => row.id === 'a')).toBe(false)
  })

  it('quarantined warm cache for the new digest stays hidden until explicit refresh', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const scopedListKey = [...baseOptions().listKey, 'digest-b'] as const
    seedValidatedScopeContextForTests({ scopeContext: 'sc-new', scopeContextDigest: 'digest-b' }, 'lineage-1')
    invalidateProtectedScopeContext()

    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('/api/auth/scope-context')) {
        return {
          ok: true,
          json: async () => ({
            scopeContext: 'sc-new',
            scopeContextDigest: 'digest-b',
            continuityDigest: 'lineage-1',
          }),
        } as Response
      }
      if (target.includes('capped-count')) {
        return {
          ok: true,
          json: async () => ({ count: 1, isCapped: false, scopeContextDigest: 'digest-b' }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'cached' }],
          meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: 'digest-b' },
        }),
      } as Response
    })

    client.setQueryData(scopedListKey, {
      pages: [{ data: [{ id: 'cached' }], meta: { nextCursor: null, hasNextPage: false } }],
      pageParams: [undefined],
    })

    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })

    expect(isScopeContextQuarantined()).toBe(true)
    expect(result.current.rows).toEqual([])
    expect(client.getQueryData(scopedListKey)).toBeDefined()

    await act(async () => {
      expect(await handshakeBeforeExplicitListRefresh()).toBe(true)
      await refreshInfiniteList(client, scopedListKey)
    })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'cached' }]))
  })

  it('failed handshake marks the list stale for explicit refresh', async () => {
    let handshakeFails = true
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (String(url).includes('/api/auth/scope-context')) {
        if (handshakeFails) {
          return { ok: false, status: 503, json: async () => ({}) } as Response
        }
        return {
          ok: true,
          json: async () => ({
            scopeContext: 'sc-test',
            scopeContextDigest: 'digest-a',
            continuityDigest: 'lineage-1',
          }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'refreshed' }],
          meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: 'digest-a' },
        }),
      } as Response
    })

    resetScopeContextClientForTests()
    seedValidatedScopeContextForTests(testScope, 'lineage-1')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const scopedListKey = [...baseOptions().listKey, 'digest-a'] as const
    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'refreshed' }]))

    await act(async () => {
      invalidateProtectedScopeContext()
      const outcome = await handshakeScopeContext({ force: true })
      expect(outcome.kind).toBe('failed')
      client.invalidateQueries({
        predicate: (query) =>
          Boolean(query.meta && (query.meta as { listPagination?: string }).listPagination === 'infinite'),
        refetchType: 'none',
      })
    })

    expect(result.current.rows).toEqual([])
    expect(result.current.tableProps.isError).toBe(false)
    const query = client.getQueryCache().find({ queryKey: scopedListKey, exact: true })
    expect(query?.state.isInvalidated).toBe(true)
    expect(isScopeContextQuarantined()).toBe(true)
    expect(isScopeExplicitRefreshRequired()).toBe(true)

    handshakeFails = false
    await act(async () => {
      const sameAfterFail = await handshakeScopeContext({ force: true })
      expect(sameAfterFail.kind).toBe('same')
    })
    expect(result.current.rows).toEqual([])
    expect(isScopeContextQuarantined()).toBe(true)
    expect(isScopeExplicitRefreshRequired()).toBe(true)

    await act(async () => {
      expect(await handshakeBeforeExplicitListRefresh()).toBe(true)
      await refreshInfiniteList(client, scopedListKey)
    })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'refreshed' }]))
    expect(isScopeContextQuarantined()).toBe(false)
    expect(isScopeExplicitRefreshRequired()).toBe(false)
  })
})
