import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkshopOrderList from './WorkshopOrderList'
import * as workshopApi from '@/api/workshop'
import { deWorkshop } from '@/test/de-workshop'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'

vi.mock('@/api/workshop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workshop')>()
  return {
    ...actual,
    useWorkshopOrders: vi.fn(),
    useGenerateWorkshopPdf: vi.fn(() => ({ mutateAsync: vi.fn() })),
  }
})

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ role: 'ADMIN' }),
}))

vi.mock('@/components/workshop/WorkshopOrderIntakeDialog', () => ({
  WorkshopOrderIntakeDialog: () => null,
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const actions = deWorkshop.orders.list.actions

describe('WorkshopOrderList registry context menu', () => {
  beforeEach(() => {
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

  it('shows registry actions on right-click and omits check-in for invoiced orders', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <SavedViewsProvider userKey="test-user">
          <DashboardWidgetsProvider userKey="test-user">
            <MemoryRouter>
              <WorkshopOrderList />
            </MemoryRouter>
          </DashboardWidgetsProvider>
        </SavedViewsProvider>
      </QueryClientProvider>,
    )

    fireEvent.contextMenu(screen.getByText('WO-1'))
    expect(screen.getByRole('button', { name: actions.checkIn })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: actions.open })).toBeInTheDocument()
  })
})
