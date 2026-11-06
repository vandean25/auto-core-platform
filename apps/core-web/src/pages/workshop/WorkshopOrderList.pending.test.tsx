import { render, renderHook, screen, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as workshopApi from '@/api/workshop'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deCommon from '../../../../../locales/de/common.json'
import WorkshopOrderList from './WorkshopOrderList'
import { useWorkshopOrderListRows } from './useWorkshopOrderListPendingRows'

vi.mock('@/api/workshop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workshop')>()
  return {
    ...actual,
    useWorkshopOrders: vi.fn(),
    useWorkshopOrder: vi.fn(() => ({ data: undefined, isLoading: false })),
    useCreateWorkshopOrder: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useRegisterIntake: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    useWorkshopSearch: vi.fn(() => ({ data: undefined, isLoading: false })),
    useGenerateWorkshopPdf: vi.fn(() => ({ mutateAsync: vi.fn() })),
  }
})
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ claims: { role: 'ADMIN' } }),
}))
vi.mock('@/components/workshop/WorkshopOrderIntakeDialog', () => ({
  WorkshopOrderIntakeDialog: (props: {
    onPendingOrder: (row: object, meta: { localId: string }) => void
    onPendingOrderFailed: (localId: string, message: string) => void
    onPendingOrderSettled: (localId: string, serverOrderId: string) => void
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          props.onPendingOrder(
            {
              id: 'local-1',
              __dataTablePending: true,
              orderNo: '',
              customer: 'Pilot customer',
              vehicle: '2018 VW Golf',
              openedAt: '',
              status: 'SCHEDULED',
            },
            { localId: 'local-1' },
          )
        }
      >
        add pending
      </button>
      <button type="button" onClick={() => props.onPendingOrderFailed('local-1', 'create failed')}>
        fail pending
      </button>
      <button type="button" onClick={() => props.onPendingOrderSettled('local-1', 'server-1')}>
        settle pending
      </button>
    </div>
  ),
}))

const orders = { data: [] as { id: string; order_number: string; createdAt: string; status: 'SCHEDULED'; vehicle: { year: number; make: string; model: string }; customer: { first_name: string; last_name: string } }[], meta: { pageCount: 1 } }

function mockOrders() {
  vi.mocked(workshopApi.useWorkshopOrders).mockReturnValue({
    data: orders,
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    isError: false,
    refetch: vi.fn(),
  } as never)
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">
          <MemoryRouter>
            <WorkshopOrderList />
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

describe('WorkshopOrderList pending rows', () => {
  beforeEach(() => {
    orders.data = []
    mockOrders()
  })

  it('shows a pending row after submit and an error marker when create fails', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'add pending' }))
    expect(screen.getByText('Pilot customer')).toBeInTheDocument()
    expect(screen.getByText(deCommon.dataTable.loading.pendingRow)).toHaveClass('sr-only')
    fireEvent.contextMenu(screen.getByText('Pilot customer'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'fail pending' }))
    expect(screen.getByRole('alert')).toHaveTextContent('create failed')

    fireEvent.click(screen.getByRole('button', { name: deCommon.dataTable.loading.dismiss }))
    expect(screen.queryByText('Pilot customer')).not.toBeInTheDocument()
  })

  it('keeps the pending row until the loaded page contains the server order', () => {
    const { result, rerender } = renderHook(
      ({ data }) => useWorkshopOrderListRows(data, false),
      { initialProps: { data: orders as never } },
    )
    act(() => {
      result.current.intakePendingProps.onPendingOrder({
        id: 'local-1',
        __dataTablePending: true,
        orderNo: '',
        customer: 'Pilot customer',
        vehicle: '2018 VW Golf',
        openedAt: '',
        status: 'SCHEDULED',
      })
      result.current.intakePendingProps.onPendingOrderSettled('local-1', 'server-1')
    })
    expect(result.current.tableRows.some((row) => row.id === 'local-1')).toBe(true)

    rerender({
      data: {
        data: [{
          id: 'server-1',
          order_number: 'WO-9',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'SCHEDULED',
          vehicle: { year: 2018, make: 'VW', model: 'Golf' },
          customer: { first_name: 'Other', last_name: 'Person', type: 'PRIVATE' },
        }],
        meta: { pageCount: 1, total: 1, page: 1, pageSize: 10 },
      } as never,
    })
    expect(result.current.tableRows.some((row) => row.id === 'local-1')).toBe(false)
    expect(result.current.tableRows.some((row) => row.id === 'server-1')).toBe(true)
  })

  it('drops a settled pending row when the next page does not contain the server order', () => {
    const { result, rerender } = renderHook(
      ({ data, updatedAt }) => useWorkshopOrderListRows(data, false, updatedAt),
      { initialProps: { data: orders as never, updatedAt: 0 } },
    )
    act(() => {
      result.current.intakePendingProps.onPendingOrder({
        id: 'local-1',
        __dataTablePending: true,
        orderNo: '',
        customer: 'Pilot customer',
        vehicle: '2018 VW Golf',
        openedAt: '',
        status: 'SCHEDULED',
      })
      result.current.intakePendingProps.onPendingOrderSettled('local-1', 'server-1')
    })
    expect(result.current.tableRows.some((row) => row.id === 'local-1')).toBe(true)

    rerender({ data: orders as never, updatedAt: 1 })
    expect(result.current.tableRows.some((row) => row.id === 'local-1')).toBe(false)
  })
})
