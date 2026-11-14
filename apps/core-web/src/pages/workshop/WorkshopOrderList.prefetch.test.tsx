import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WorkshopOrderList from './WorkshopOrderList'
import * as workshopApi from '@/api/workshop'
import { workshopKeys } from '@/api/workshop'
import { fetchWithAuth } from '@/api/client'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { resetIntentPrefetchScheduler } from '@/lib/intent-prefetch'

vi.mock('@/api/workshop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workshop')>()
  return { ...actual, useWorkshopOrders: vi.fn() }
})

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))

vi.mock('@/api/client', () => ({ fetchWithAuth: vi.fn() }))

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

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <SavedViewsProvider userKey="test-user">
          <DashboardWidgetsProvider userKey="test-user">
            {/* A non-cursor sort keeps the offset list this test mocks (AUT-956). */}
            <MemoryRouter initialEntries={['/workshop/orders?sortField=orderNo&sortDirection=asc']}>
              <WorkshopOrderList />
            </MemoryRouter>
          </DashboardWidgetsProvider>
        </SavedViewsProvider>
      </QueryClientProvider>,
    )

    const row = container.querySelector('tbody tr[data-table-row="true"]')
    expect(row).not.toBeNull()

    fireEvent.pointerEnter(row!, { pointerType: 'mouse' })
    vi.advanceTimersByTime(100)
    expect(prefetchSpy).toHaveBeenCalledTimes(1)
    expect(prefetchSpy.mock.calls[0]?.[0]).toMatchObject({
      queryKey: workshopKeys.detail('order-1'),
      staleTime: workshopApi.WORKSHOP_ORDER_DETAIL_STALE_MS,
    })
    expect(orderDetailRequests()).toHaveLength(1)

    fireEvent.pointerEnter(row!, { pointerType: 'mouse' })
    vi.advanceTimersByTime(100)
    expect(prefetchSpy).toHaveBeenCalledTimes(1)
    expect(orderDetailRequests()).toHaveLength(1)

    resolveInFlight({
      ok: true,
      json: async () => ({ id: 'order-1', order_number: 'WO-1', status: 'INTAKE', tasks: [] }),
    } as Response)
    await vi.advanceTimersByTimeAsync(0)
    expect(queryClient.getQueryData(workshopKeys.detail('order-1'))).toMatchObject({
      id: 'order-1',
    })

    fireEvent.pointerEnter(row!, { pointerType: 'mouse' })
    vi.advanceTimersByTime(100)
    expect(prefetchSpy).toHaveBeenCalledTimes(1)
    expect(orderDetailRequests()).toHaveLength(1)
  })
})
