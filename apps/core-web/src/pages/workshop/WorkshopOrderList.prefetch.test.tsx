import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WorkshopOrderList from './WorkshopOrderList'
import * as workshopApi from '@/api/workshop'
import { workshopKeys } from '@/api/workshop'
import { fetchWithAuth } from '@/api/client'

vi.mock('@/api/workshop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workshop')>()
  return {
    ...actual,
    useWorkshopOrders: vi.fn(),
  }
})

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))

vi.mock('@/api/client', () => ({
  fetchWithAuth: vi.fn(),
}))

vi.mock('@/components/data-table/DataTable', () => ({
  DataTable: ({
    data,
    rowBehaviour,
  }: {
    data: Array<{ id: string }>
    rowBehaviour?: { onRowPrefetch?: (row: { id: string }) => void }
  }) => (
    <button type="button" onPointerEnter={() => rowBehaviour?.onRowPrefetch?.(data[0])}>
      hover-row
    </button>
  ),
}))

vi.mock('@/components/workshop/WorkshopOrderIntakeDialog', () => ({
  WorkshopOrderIntakeDialog: () => null,
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

describe('WorkshopOrderList row prefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'order-1',
        order_number: 'WO-1',
        status: 'INTAKE',
        tasks: [],
      }),
    } as Response)
  })

  it('prefetches order detail on row hover with staleTime and dedupes within stale window', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery')

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkshopOrderList />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.pointerEnter(screen.getByRole('button', { name: 'hover-row' }))
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(1))
    expect(prefetchSpy.mock.calls[0]?.[0]).toMatchObject({
      queryKey: workshopKeys.detail('order-1'),
      staleTime: workshopApi.WORKSHOP_ORDER_DETAIL_STALE_MS,
    })

    fireEvent.pointerEnter(screen.getByRole('button', { name: 'hover-row' }))
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(1))
  })
})
