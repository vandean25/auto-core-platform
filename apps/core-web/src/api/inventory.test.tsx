import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { isInventoryCursorSort, useInventory } from './inventory'
import { fetchWithAuth } from './client'
import { SCOPE_CONTEXT_HEADER } from '@/auth/scope-context-client'

vi.mock('./client', () => ({
  fetchWithAuth: vi.fn(),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function createJsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

describe('inventory api hooks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('sends the requested sort column and direction with the list query', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse({ data: [], meta: { total: 0, page: 2, pageSize: 10, pageCount: 0 } }),
    )

    const { result } = renderHook(
      () => useInventory({ page: 2, pageSize: 10, sortField: 'sku', sortDirection: 'desc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    const [url, init] = vi.mocked(fetchWithAuth).mock.calls[0]
    expect(url).toBe('/api/inventory?page=2&pageSize=10&sortField=sku&sortDirection=desc')
    // Regression: the offset read (unsupported-sort fallback) omitted the scope header the cursor reads send.
    expect(new Headers(init?.headers).get(SCOPE_CONTEXT_HEADER)).toBe('vitest-sc')
  })

  it('omits sort parameters when no sort is requested', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse({ data: [], meta: { total: 0, page: 1, pageSize: 10, pageCount: 0 } }),
    )

    const { result } = renderHook(() => useInventory({ page: 1, pageSize: 10 }), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(vi.mocked(fetchWithAuth).mock.calls[0][0]).toBe('/api/inventory?page=1&pageSize=10')
  })
})

describe('isInventoryCursorSort', () => {
  // Regression (AUT-890): the infinite list must only run on the sorts the API whitelists for cursors, else it answers
  // LIST_CURSOR_SORT_UNSUPPORTED. Unsorted lists use the server default (sku).
  it.each([
    [undefined, true],
    ['sku', true],
    ['name', true],
    ['price', true],
    ['status', false],
    ['warehouse_location', false],
  ])('sortField %s -> cursor mode %s', (sortField, expected) => {
    expect(isInventoryCursorSort(sortField)).toBe(expected)
  })
})
