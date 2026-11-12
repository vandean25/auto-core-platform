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
  resetScopeContextClientForTests,
  seedValidatedScopeContextForTests,
} from '@/auth/scope-context-client'
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
    expect(result.current.tableProps.isError).toBe(false)
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
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (String(url).includes('/api/auth/scope-context')) {
        return { ok: false, status: 503, json: async () => ({}) } as Response
      }
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'hidden' }],
          meta: { nextCursor: null, hasNextPage: false, scopeContextDigest: 'digest-a' },
        }),
      } as Response
    })

    resetScopeContextClientForTests()
    seedValidatedScopeContextForTests(testScope)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const scopedListKey = [...baseOptions().listKey, 'digest-a'] as const
    const { result } = renderHook(() => useCursorList<Row>(baseOptions()), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'hidden' }]))

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
  })
})
