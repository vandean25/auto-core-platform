import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useDeleteEmployee, useEmployees } from './employees'
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

describe('employees api hooks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('requests employees with includeInactive and role filters', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse({
        data: [],
        meta: { total: 0, page: 1, limit: 25, totalPages: 1 },
      }),
    )

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    const { result } = renderHook(
      () => useEmployees({ includeInactive: true, role: 'MECHANIC' }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(fetchWithAuth).toHaveBeenCalledWith('/api/employees?includeInactive=true&role=MECHANIC')
  })

  it('surfaces backend conflict message on delete', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      createJsonResponse({ message: 'Cannot delete employee with 1 linked workshop orders' }, false),
    )

    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    const { result } = renderHook(() => useDeleteEmployee(), { wrapper })

    await expect(result.current.mutateAsync('emp-1')).rejects.toThrow(
      'Cannot delete employee with 1 linked workshop orders',
    )
  })
})
