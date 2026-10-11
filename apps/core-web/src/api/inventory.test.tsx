import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useInventory } from './inventory'
import { fetchWithAuth } from './client'

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
    expect(fetchWithAuth).toHaveBeenCalledWith(
      '/api/inventory?page=2&pageSize=10&sortField=sku&sortDirection=desc',
    )
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
    expect(fetchWithAuth).toHaveBeenCalledWith('/api/inventory?page=1&pageSize=10')
  })
})
