// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  useUpdateWorkshopCheckInInspection,
  workshopCheckInKeys,
} from './workshop-check-in'

const fetchWithAuth = vi.fn()

vi.mock('./client', () => ({
  fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args),
}))

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

describe('useUpdateWorkshopCheckInInspection', () => {
  it('refetches the check-in record so the next save can use the bumped revision', async () => {
    const orderId = 'order-1'
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(workshopCheckInKeys.record(orderId), {
      id: 'check-in-1',
      revision: 1,
      inspection_id: 'insp-1',
      status: 'DRAFT',
    })

    fetchWithAuth
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Annahme-Check',
          items: [{ id: 'item-1', label_snapshot: 'Lights', passed: true, notes: null }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'check-in-1',
          revision: 2,
          inspection_id: 'insp-1',
          status: 'DRAFT',
        }),
      })

    const { result } = renderHook(() => useUpdateWorkshopCheckInInspection(), {
      wrapper: createWrapper(queryClient),
    })

    await result.current.mutateAsync({
      orderId,
      expectedRevision: 1,
      items: [{ id: 'item-1', passed: true }],
    })

    await waitFor(() => {
      expect(queryClient.getQueryData(workshopCheckInKeys.record(orderId))).toMatchObject({
        revision: 2,
      })
    })

    expect(fetchWithAuth).toHaveBeenCalledTimes(2)
    expect(String(fetchWithAuth.mock.calls[1][0])).toContain(
      `/api/workshop/orders/${orderId}/check-in`,
    )
  })

  it('refetches the record despite the app default staleTime so the revision is not stale', async () => {
    fetchWithAuth.mockReset()
    const orderId = 'order-2'
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 1000 * 60 * 5 },
        mutations: { retry: false },
      },
    })
    queryClient.setQueryData(workshopCheckInKeys.record(orderId), {
      id: 'check-in-2',
      revision: 2,
      inspection_id: 'insp-2',
      status: 'DRAFT',
    })
    fetchWithAuth
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: 'Annahme-Check', items: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'check-in-2',
          revision: 3,
          inspection_id: 'insp-2',
          status: 'DRAFT',
        }),
      })

    const { result } = renderHook(() => useUpdateWorkshopCheckInInspection(), {
      wrapper: createWrapper(queryClient),
    })
    await result.current.mutateAsync({
      orderId,
      expectedRevision: 2,
      items: [{ id: 'item-1', passed: false }],
    })

    expect(queryClient.getQueryData(workshopCheckInKeys.record(orderId))).toMatchObject({
      revision: 3,
    })
  })

  it('rejects with the CHECK_IN_CONFLICT code on a stale revision', async () => {
    fetchWithAuth.mockReset()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    fetchWithAuth.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ code: 'CHECK_IN_CONFLICT', message: 'stale' }),
    })

    const { result } = renderHook(() => useUpdateWorkshopCheckInInspection(), {
      wrapper: createWrapper(queryClient),
    })

    await expect(
      result.current.mutateAsync({
        orderId: 'order-3',
        expectedRevision: 2,
        items: [{ id: 'item-1', passed: true }],
      }),
    ).rejects.toMatchObject({ code: 'CHECK_IN_CONFLICT', status: 409 })
  })
})