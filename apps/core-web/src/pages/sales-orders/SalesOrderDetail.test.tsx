import { act, render, renderHook, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SalesOrderDetail from './SalesOrderDetail'
import { deSales } from '@/test/de-sales'
import * as salesOrdersApi from '@/api/sales-orders'
import * as authSession from '@/api/auth-session'
import { EntityActionConfirmHost } from '@/features/actions/action-confirm-host'
import { takeQueuedInvoiceDraftCreate } from '@/pages/sales/useInvoicePendingCreate'
import type { SalesOrder } from '@/api/types'
import { useSalesOrderActions } from './useSalesOrderActions'

const mockNavigate = vi.fn()

vi.mock('@/api/sales-orders')
vi.mock('@/api/auth-session', async (original) => ({
  ...(await original<typeof import('@/api/auth-session')>()),
  useAuthSession: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const baseOrder = {
  id: 'so-1',
  order_number: 'SO-2026-0001',
  status: 'DRAFT',
  createdAt: '2026-09-21T00:00:00.000Z',
  notes: null,
  customer: {
    id: 'cust-1',
    type: 'PRIVATE',
    first_name: 'Test',
    last_name: 'Customer',
    email: 'test@example.com',
    phone: null,
    address_street: 'Main',
    address_zip: '1010',
    address_city: 'Wien',
    address_country: 'AT',
  },
  items: [],
  invoice: null,
}

describe('SalesOrderDetail create invoice', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    takeQueuedInvoiceDraftCreate()
    vi.clearAllMocks()
    vi.mocked(authSession.useAuthSession).mockReturnValue({
      data: { activeRole: 'ADMIN' },
    } as ReturnType<typeof authSession.useAuthSession>)
    asMock(salesOrdersApi.useSalesOrder).mockReturnValue({
      data: baseOrder,
      isLoading: false,
    })
    asMock(salesOrdersApi.useUpdateSalesOrder).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  it('explains that create invoice confirms a draft sales order', async () => {
    asMock(salesOrdersApi.useCreateInvoiceFromOrder).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/sales-orders/so-1']}>
          <Routes>
            <Route path="/sales-orders/:id" element={<SalesOrderDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: deSales.orders.detail.createInvoice }))

    expect(screen.getByText(deSales.orders.detail.createInvoiceDraftConfirm)).toBeInTheDocument()
  })

  it('hands the draft to the invoice list without posting from the order page', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/sales-orders/so-1']}>
          <Routes>
            <Route path="/sales-orders/:id" element={<SalesOrderDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: deSales.orders.detail.createInvoice }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: deSales.orders.detail.createInvoice }),
    )

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/sales/invoices', { replace: true })
    })
    expect(takeQueuedInvoiceDraftCreate()).toEqual({
      orderId: 'so-1',
      customerName: 'Test Customer',
    })
  })

  it('disables create invoice once the handoff has started', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/sales-orders/so-1']}>
          <Routes>
            <Route path="/sales-orders/:id" element={<SalesOrderDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: deSales.orders.detail.createInvoice }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: deSales.orders.detail.createInvoice }))

    expect(screen.getByRole('button', { name: deSales.orders.detail.createInvoice })).toBeDisabled()
    expect(takeQueuedInvoiceDraftCreate()).toEqual({
      orderId: 'so-1',
      customerName: 'Test Customer',
    })
  })

  it('navigates once when create invoice is requested again before the button can disable', () => {
    const { result } = renderHook(() => useSalesOrderActions('so-1'))
    const order = baseOrder as unknown as SalesOrder
    act(() => {
      result.current.createInvoice(order)
      result.current.createInvoice(order)
    })

    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith('/sales/invoices', { replace: true })
    expect(takeQueuedInvoiceDraftCreate()).toEqual({
      orderId: 'so-1',
      customerName: 'Test Customer',
    })
  })
})

function renderDetail() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/sales-orders/so-1']}>
        <Routes>
          <Route path="/sales-orders/:id" element={<SalesOrderDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SalesOrderDetail states (AUT-659)', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authSession.useAuthSession).mockReturnValue({
      data: { activeRole: 'ADMIN' },
    } as ReturnType<typeof authSession.useAuthSession>)
    asMock(salesOrdersApi.useUpdateSalesOrder).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    asMock(salesOrdersApi.useCreateInvoiceFromOrder).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  })

  // Regression: the loading state was a bare text block instead of a skeleton.
  it('WHEN the sales order is loading THEN a Skeleton is shown instead of the loading text', async () => {
    asMock(salesOrdersApi.useSalesOrder).mockReturnValue({ data: undefined, isLoading: true })
    const { container } = renderDetail()

    expect(await screen.findByRole('status')).toHaveTextContent(deSales.orders.detail.loading)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })

  // Regression: the missing order was a bare text block, not the shared Empty.
  it('WHEN the sales order does not exist THEN the shared Empty is shown with the German text', async () => {
    asMock(salesOrdersApi.useSalesOrder).mockReturnValue({ data: undefined, isLoading: false })
    const { container } = renderDetail()

    await waitFor(() => expect(container.querySelector('[data-slot="empty"]')).not.toBeNull())
    expect(container.querySelector('[data-slot="empty"]')).toHaveTextContent(deSales.orders.detail.notFound)
  })
})

describe('SalesOrderDetail delete header', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authSession.useAuthSession).mockReturnValue({
      data: { activeRole: 'ADMIN' },
    } as ReturnType<typeof authSession.useAuthSession>)
    asMock(salesOrdersApi.useSalesOrder).mockReturnValue({
      data: baseOrder,
      isLoading: false,
    })
    asMock(salesOrdersApi.useUpdateSalesOrder).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    asMock(salesOrdersApi.useCreateInvoiceFromOrder).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    const mutateAsync = vi.fn().mockResolvedValue('so-1')
    asMock(salesOrdersApi.useDeleteSalesOrder).mockReturnValue({
      mutateAsync,
      isPending: false,
    })
  })

  it('confirms delete from the header and returns to the list', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/sales-orders/so-1']}>
          <Routes>
            <Route
              path="/sales-orders/:id"
              element={
                <>
                  <SalesOrderDetail />
                  <EntityActionConfirmHost />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: deSales.shared.delete }))
    const alert = await screen.findByRole('alertdialog')
    fireEvent.click(within(alert).getByRole('button', { name: deSales.shared.delete }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/sales-orders')
    })
  })
})

describe('SalesOrderDetail header navigation', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authSession.useAuthSession).mockReturnValue({
      data: { activeRole: 'ADMIN' },
    } as ReturnType<typeof authSession.useAuthSession>)
    asMock(salesOrdersApi.useSalesOrder).mockReturnValue({
      data: baseOrder,
      isLoading: false,
    })
    asMock(salesOrdersApi.useUpdateSalesOrder).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    asMock(salesOrdersApi.useCreateInvoiceFromOrder).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  it('names the icon-only back link so it points to the sales order list', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/sales-orders/so-1']}>
          <Routes>
            <Route path="/sales-orders/:id" element={<SalesOrderDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('link', { name: deSales.orders.detail.backAria })).toHaveAttribute(
      'href',
      '/sales-orders',
    )
  })
})
