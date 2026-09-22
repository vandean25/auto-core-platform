import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SalesOrderDetail from './SalesOrderDetail'
import * as salesOrdersApi from '@/api/sales-orders'

const mockNavigate = vi.fn()

vi.mock('@/api/sales-orders')
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
}

describe('SalesOrderDetail create invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    fireEvent.click(screen.getByRole('button', { name: /Create Invoice/i }))

    expect(
      screen.getByText(/confirms the sales order and creates a draft invoice/i),
    ).toBeInTheDocument()
  })

  it('navigates to the sourced draft editor after creating an invoice', async () => {
    const createInvoice = vi.fn().mockResolvedValue({ id: 'inv-42', status: 'DRAFT' })
    asMock(salesOrdersApi.useCreateInvoiceFromOrder).mockReturnValue({
      mutateAsync: createInvoice,
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

    fireEvent.click(screen.getByRole('button', { name: /Create Invoice/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Create Invoice$/i }))

    await waitFor(() => {
      expect(createInvoice).toHaveBeenCalledWith('so-1')
      expect(mockNavigate).toHaveBeenCalledWith('/sales/invoices/inv-42/edit')
    })
  })
})
