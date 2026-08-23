import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hrKeys, useHrMeClock, usePunchClock } from './hr'

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
}))

vi.mock('./client', () => ({
  fetchWithAuth: mocks.fetchWithAuth,
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('HR clock hooks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fetches the current clock state', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({
      state: 'CLOCKED_OUT',
      lastEvent: null,
      todayEvents: [],
    }))

    const { result } = renderHook(() => useHrMeClock(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/hr/me/clock')
  })

  it('posts the selected self clock event', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({
      state: 'CLOCKED_IN',
      event: { id: 'event-1' },
    }))

    const { result } = renderHook(() => usePunchClock(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await result.current.mutateAsync({ type: 'CLOCK_IN' })

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/hr/me/clock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'CLOCK_IN' }),
    })
  })

  it('invalidates all HR queries after a successful self clock punch', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({
      state: 'CLOCKED_IN',
      event: { id: 'event-1' },
    }))

    const { result } = renderHook(() => usePunchClock(), {
      wrapper: createWrapper(queryClient),
    })

    await result.current.mutateAsync({ type: 'CLOCK_IN' })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: hrKeys.all })
  })
})
