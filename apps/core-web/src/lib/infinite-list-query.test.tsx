import type { InfiniteData } from '@tanstack/react-query'
import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import {
  infiniteListQueryMeta,
  isInfiniteDataShape,
  listRowIdsFromCache,
  markInfiniteListStale,
  refreshInfiniteList,
} from '@/lib/infinite-list-query'

vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))

describe('infinite-list-query helpers', () => {
  it('detects infinite data and row order', () => {
    const cache: InfiniteData<{ data: { id: string }[] }> = {
      pages: [{ data: [{ id: 'a' }, { id: 'b' }] }, { data: [{ id: 'c' }] }],
      pageParams: [undefined, 'cursor-2'],
    }
    expect(isInfiniteDataShape(cache)).toBe(true)
    expect(listRowIdsFromCache(cache)).toEqual(['a', 'b', 'c'])
  })

  it('refreshInfiniteList loads page one and count', async () => {
    const listKey = ['test', 'refresh'] as const
    const countKey = ['test', 'refresh', 'count'] as const
    const LIST_URL = 'http://127.0.0.1:3000/api/test/refresh'
    const COUNT_URL = 'http://127.0.0.1:3000/api/test/refresh/count'
    let listGets = 0
    let countGets = 0
    vi.mocked(fetchWithAuth).mockImplementation((input) => {
      const url = String(input)
      if (url === LIST_URL) {
        listGets += 1
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'a', label: 'A' }], meta: { next_cursor: null } }),
        } as Response)
      }
      if (url === COUNT_URL) {
        countGets += 1
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ count: 1, isCapped: false }),
        } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    renderHook(
      () => {
        useInfiniteQuery({
          queryKey: listKey,
          meta: infiniteListQueryMeta(countKey),
          initialPageParam: undefined as string | undefined,
          queryFn: async () => (await fetchWithAuth(LIST_URL)).json(),
          getNextPageParam: () => undefined,
          staleTime: Infinity,
          initialData: {
            pages: [
              { data: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], meta: { next_cursor: 'x' } },
              { data: [{ id: 'c', label: 'C' }], meta: { next_cursor: null } },
            ],
            pageParams: [undefined, 'x'],
          },
        })
        useQuery({
          queryKey: countKey,
          queryFn: async () => (await fetchWithAuth(COUNT_URL)).json(),
          staleTime: Infinity,
          initialData: { count: 3, isCapped: false },
        })
      },
      { wrapper },
    )

    await act(async () => {
      await refreshInfiniteList(queryClient, listKey)
    })

    await waitFor(() => expect(listGets).toBe(1))
    expect(countGets).toBe(1)
    expect(queryClient.getQueryData<InfiniteData<unknown>>(listKey)?.pages).toHaveLength(1)
  })

  it('refreshInfiniteList works after stale marking', async () => {
    const listKey = ['test', 'refresh-stale'] as const
    const LIST_URL = 'http://127.0.0.1:3000/api/test/refresh-stale'
    let listGets = 0
    vi.mocked(fetchWithAuth).mockImplementation((input) => {
      if (String(input) === LIST_URL) {
        listGets += 1
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'a', label: 'A' }], meta: { next_cursor: null } }),
        } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    renderHook(
      () =>
        useInfiniteQuery({
          queryKey: listKey,
          meta: infiniteListQueryMeta(),
          initialPageParam: undefined as string | undefined,
          queryFn: async () => (await fetchWithAuth(LIST_URL)).json(),
          getNextPageParam: () => undefined,
          staleTime: Infinity,
          initialData: {
            pages: [{ data: [{ id: 'a', label: 'A' }], meta: { next_cursor: null } }],
            pageParams: [undefined],
          },
        }),
      { wrapper },
    )
    markInfiniteListStale(queryClient, listKey)
    const query = queryClient.getQueryCache().find({ queryKey: listKey, exact: true })
    expect(query?.state.isInvalidated).toBe(true)
    await act(async () => {
      await refreshInfiniteList(queryClient, listKey)
    })
    await waitFor(() => expect(listGets).toBe(1))
    expect(query?.state.isInvalidated).toBe(false)
    expect(queryClient.getQueryData<InfiniteData<unknown>>(listKey)?.pages).toHaveLength(1)
  })

  describe('explicit refresh of a list that changes while it loads', () => {
    const key = ['test', 'refresh-race'] as const

    function listWithOnePage() {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const answers: Array<(page: { data: { id: string }[] }) => void> = []
      queryClient.getQueryCache().build(queryClient, {
        queryKey: key,
        meta: infiniteListQueryMeta(),
        initialPageParam: 0,
        queryFn: () => new Promise<{ data: { id: string }[] }>((resolve) => answers.push(resolve)),
      } as never)
      queryClient.setQueryData(key, { pages: [{ data: [{ id: 'old' }] }], pageParams: [0] })
      return { queryClient, answers }
    }

    // ADR-0035 §7: setQueryData for the new page one clears the stale flag, which dropped the event that arrived meanwhile.
    it('WHEN an event arrives during the refresh THEN the list is still marked stale after page one landed', async () => {
      const { queryClient, answers } = listWithOnePage()
      const refresh = refreshInfiniteList(queryClient, key)
      await waitFor(() => expect(answers.length).toBeGreaterThan(0))

      markInfiniteListStale(queryClient, key)
      answers.at(-1)?.({ data: [{ id: 'fresh' }] })
      await refresh

      expect(listRowIdsFromCache(queryClient.getQueryData(key))).toEqual(['fresh'])
      expect(queryClient.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated).toBe(true)
    })

    // Two refreshes (or a filter change) can overlap; the answer of the abandoned one must never replace the newer page one.
    it('WHEN a newer refresh supersedes a running one THEN the late answer of the first is dropped', async () => {
      const { queryClient, answers } = listWithOnePage()
      const firstRefresh = refreshInfiniteList(queryClient, key)
      await waitFor(() => expect(answers.length).toBe(1))
      const secondRefresh = refreshInfiniteList(queryClient, key)
      await waitFor(() => expect(answers.length).toBe(2))

      answers[1]({ data: [{ id: 'newer' }] })
      await secondRefresh
      answers[0]({ data: [{ id: 'older' }] })
      await firstRefresh

      expect(listRowIdsFromCache(queryClient.getQueryData(key))).toEqual(['newer'])
    })
  })
})
