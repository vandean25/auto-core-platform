import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SalesOrderDetail from './SalesOrderDetail'
import { deSales } from '@/test/de-sales'
import * as salesOrdersApi from '@/api/sales-orders'
import {
  PageBreadcrumbsProvider,
  PageContainerWithBreadcrumbs,
} from '@/components/layout/PageBreadcrumbs'

vi.mock('@/api/sales-orders')
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

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/sales-orders/so-1']}>
        <PageBreadcrumbsProvider>
          <PageContainerWithBreadcrumbs>
            <Routes>
              <Route path="/sales-orders/:id" element={<SalesOrderDetail />} />
            </Routes>
          </PageContainerWithBreadcrumbs>
        </PageBreadcrumbsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SalesOrderDetail breadcrumbs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(salesOrdersApi.useUpdateSalesOrder).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('links back to the sales order list and marks the order number as the current page', () => {
    asMock(salesOrdersApi.useSalesOrder).mockReturnValue({ data: baseOrder, isLoading: false })

    renderPage()

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getByRole('link', { name: 'Kundenaufträge' })).toHaveAttribute(
      'href',
      '/sales-orders',
    )
    expect(within(trail).getByText('SO-2026-0001')).toHaveAttribute('aria-current', 'page')
  })

  it('shows a generic current label while the order is loading', () => {
    asMock(salesOrdersApi.useSalesOrder).mockReturnValue({ data: undefined, isLoading: true })

    renderPage()

    expect(screen.getByText(deSales.orders.detail.breadcrumbFallback)).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
