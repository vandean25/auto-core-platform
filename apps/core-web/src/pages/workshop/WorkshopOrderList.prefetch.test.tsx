import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WorkshopOrderList from './WorkshopOrderList'
import * as workshopApi from '@/api/workshop'
import { workshopKeys } from '@/api/workshop'
import { fetchWithAuth } from '@/api/client'
import {
  cancelIntentPrefetch,
  resetIntentPrefetchScheduler,
  scheduleIntentPrefetch,
} from '@/lib/intent-prefetch'

vi.mock('@/api/workshop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workshop')>()
  return { ...actual, useWorkshopOrders: vi.fn() }
})

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))

vi.mock('@/api/client', () => ({ fetchWithAuth: vi.fn() }))

vi.mock('@/components/data-table/DataTable', () => ({
  DataTable: ({
    data,
    rowBehaviour,
  }: {
    data: Array<{ id: string }>
    rowBehaviour?: { onRowPrefetch?: (row: { id: string }) => void }
  }) => (
    <button
      type="button"
      onPointerEnter={() =>
        scheduleIntentPrefetch(`row-hover:${data[0]?.id ?? '0'}`, () =>
          rowBehaviour?.onRowPrefetch?.(data[0]),
        )
      }
      onPointerLeave={() => cancelIntentPrefetch(`row-hover:${data[0]?.id ?? '0'}`)}
    >
      hover-row
    </button>
  ),
}))

vi.mock('@/components/workshop/WorkshopOrderIntakeDialog', () => ({
  WorkshopOrderIntakeDialog: () => null,
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

// The peek sheet's run context also reads the (shared, cached) workshop resources; only the order detail requests count here.
function orderDetailRequests() {
  return vi.mocked(fetchWithAuth).mock.calls.filter(([url]) => String(url).includes('/api/workshop/orders/order-1'))
}

describe('WorkshopOrderList row prefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetIntentPrefetchScheduler()
    asMock(workshopApi.useWorkshopOrders).mockReturnValue({
      data: {
        data: [
          {
            id: 'order-1',
            order_number: 'WO-1',
            status: 'INTAKE',
            customer: { first_name: 'Ada', last_name: 'Lovelace' },
            vehicle: { year: 2024, make: 'Audi', model: 'A4' },
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        meta: { pageCount: 1, total: 1, page: 1, pageSize: 10 },
      },
      isLoading: false,
    })
  })

  afterEach(() => {
    resetIntentPrefetchScheduler()
    vi.useRealTimers()
  })

  it('WHEN the same row is hovered again while the request is in flight or fresh THEN no second request is sent', async () => {
    vi.useFakeTimers()
    let resolveInFlight!: (value: Response) => void
    vi.mocked(fetchWithAuth).mockImplementation((url) =>
      String(url).includes('/api/workshop/orders/order-1')
        ? new Promise<Response>((resolve) => {
            resolveInFlight = resolve
          })
        : Promise.resolve({ ok: true, json: async () => ({}) } as Response),
    )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery')

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkshopOrderList />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const row = screen.getByRole('button', { name: 'hover-row' })

    fireEvent.pointerEnter(row)
    vi.advanceTimersByTime(100)
    expect(prefetchSpy).toHaveBeenCalledTimes(1)
    expect(prefetchSpy.mock.calls[0]?.[0]).toMatchObject({
      queryKey: workshopKeys.detail('order-1'),
      staleTime: workshopApi.WORKSHOP_ORDER_DETAIL_STALE_MS,
    })
    expect(orderDetailRequests()).toHaveLength(1)

    fireEvent.pointerEnter(row)
    vi.advanceTimersByTime(100)
    expect(prefetchSpy).toHaveBeenCalledTimes(1)
    expect(orderDetailRequests()).toHaveLength(1)

    resolveInFlight({
      ok: true,
      json: async () => ({ id: 'order-1', order_number: 'WO-1', status: 'INTAKE', tasks: [] }),
    } as Response)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    fireEvent.pointerEnter(row)
    vi.advanceTimersByTime(100)
    expect(prefetchSpy).toHaveBeenCalledTimes(1)
    expect(orderDetailRequests()).toHaveLength(1)
  })
})
