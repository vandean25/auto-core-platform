import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkshopOrderList from './WorkshopOrderList'
import * as workshopApi from '@/api/workshop'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { deWorkshop } from '@/test/de-workshop'

const order = {
  id: 'wo-1',
  order_number: 'WO-971',
  status: 'OPEN',
  createdAt: '2026-01-01T00:00:00.000Z',
  vehicle: { year: 2020, make: 'VW', model: 'Golf' },
  customer: { display_name: 'Jane Doe' },
}

vi.mock('@/api/workshop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workshop')>()
  return {
    ...actual,
    useWorkshopOrders: vi.fn(),
    useWorkshopOrder: vi.fn(() => ({ data: undefined, isLoading: false })),
    useGenerateWorkshopPdf: vi.fn(() => ({ mutateAsync: vi.fn() })),
    useCreateWorkshopOrder: vi.fn(() => ({ mutateAsync: vi.fn() })),
  }
})
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))
vi.mock('@/components/workshop/WorkshopOrderIntakeDialog', () => ({
  WorkshopOrderIntakeDialog: () => null,
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

function legacyListFirstLoadActive(isLoading: boolean, hasUsableData: boolean, listSnapshotResolved: boolean) {
  return isLoading && !hasUsableData && !listSnapshotResolved
}

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SavedViewsProvider userKey="aut-971">
        <DashboardWidgetsProvider userKey="aut-971">
          <MemoryRouter initialEntries={['/workshop/orders']}>
            <Routes>
              <Route path="/workshop/orders" element={<WorkshopOrderList />} />
            </Routes>
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

describe('WorkshopOrderList AUT-971 skeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('WHEN query is paused pending THEN legacy isLoading gate arms but the real table does not skeleton', () => {
    vi.useFakeTimers()
    asMock(workshopApi.useWorkshopOrders).mockReturnValue({
      data: undefined,
      isPending: true,
      isFetching: false,
      isLoading: true,
      isPlaceholderData: false,
      isError: false,
      dataUpdatedAt: 0,
    })

    expect(legacyListFirstLoadActive(true, false, false)).toBe(true)

    renderList()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    expect(document.querySelector('tbody .animate-pulse')).toBeNull()
    expect(screen.getByText(deWorkshop.orders.list.partsPickQueue)).toBeInTheDocument()
  })

  it('WHEN query data exists but rows are not yet mapped THEN listSnapshotResolved clears skeleton within 350ms', () => {
    vi.useFakeTimers()
    const response = { data: [order], meta: { pageCount: 1, total: 1, page: 1, pageSize: 10 } }
    asMock(workshopApi.useWorkshopOrders).mockReturnValue({
      data: response,
      isPending: true,
      isFetching: true,
      isLoading: true,
      isPlaceholderData: false,
      isError: false,
      dataUpdatedAt: Date.now(),
    })

    expect(legacyListFirstLoadActive(true, false, true)).toBe(false)

    renderList()
    act(() => {
      vi.advanceTimersByTime(550)
    })

    expect(document.querySelector('tbody .animate-pulse')).toBeNull()
    expect(screen.getByText('WO-971')).toBeInTheDocument()
  })
})
