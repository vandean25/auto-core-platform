import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useBays, useDeleteBay } from './bays'
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
      mutations: {
        retry: false,
      },
    },
  })
}

function createWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function createJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('bays api hooks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('requests bays with includeInactive enabled', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse({
        data: [],
        meta: { total: 0, page: 1, limit: 25, totalPages: 1 },
      }),
    )

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    const { result } = renderHook(() => useBays({ includeInactive: true }), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(fetchWithAuth).toHaveBeenCalledWith('/api/bays?includeInactive=true')
  })

  it('surfaces backend conflict message on delete', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse({ message: 'Cannot delete bay with 1 linked workshop orders' }, false),
    )

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    const { result } = renderHook(() => useDeleteBay(), { wrapper })

    await expect(result.current.mutateAsync('bay-1')).rejects.toThrow(
      'Cannot delete bay with 1 linked workshop orders',
    )
  })
})
