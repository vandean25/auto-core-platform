import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bumpProtectedScopeGeneration,
  resetScopeContextClientForTests,
  seedValidatedScopeContextForTests,
} from '@/auth/scope-context-client'
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

    await waitFor(() => expect(result.current.tableProps.isError || result.current.rows.length === 0).toBe(true))
    expect(result.current.rows).toEqual([])
  })

  it('external scope change blocks', async () => {
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
          json: async () => ({ count: 0, isCapped: false, scopeContextDigest: 'digest-a' }),
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
      const { handshakeScopeContext } = await import('@/auth/scope-context-client')
      await handshakeScopeContext({ force: true })
    })

    expect(result.current.rows).toEqual([])
    const { isScopeContextQuarantined } = await import('@/auth/scope-context-client')
    expect(isScopeContextQuarantined()).toBe(true)
  })
})
