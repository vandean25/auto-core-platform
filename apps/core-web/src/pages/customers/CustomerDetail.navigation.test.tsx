import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CustomerDetail from './CustomerDetail'
import { deCustomers } from '@/test/de-customers'
import * as customersApi from '@/api/customers'
import {
  PageBreadcrumbsProvider,
  PageContainerWithBreadcrumbs,
} from '@/components/layout/PageBreadcrumbs'

vi.mock('@/api/customers')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const mockCustomer = {
  id: 'cust-100',
  type: 'PRIVATE' as const,
  first_name: 'John',
  last_name: 'Doe',
  company_name: null,
  email: 'john.doe@example.com',
  phone: '+43 123 456789',
  address_street: 'Musterstrasse 1',
  address_zip: '1010',
  address_city: 'Vienna',
  address_country: 'Austria',
  notes: null,
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-02T10:00:00.000Z',
  sales_orders: [],
  workshop_orders: [],
  invoices: [],
  vehicles: [],
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/customers/cust-100']}>
        <PageBreadcrumbsProvider>
          <PageContainerWithBreadcrumbs>
            <Routes>
              <Route path="/customers/:id" element={<CustomerDetail />} />
            </Routes>
          </PageContainerWithBreadcrumbs>
        </PageBreadcrumbsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CustomerDetail navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(customersApi.useCustomer).mockReturnValue({
      data: mockCustomer,
      isLoading: false,
      error: null,
    })
    asMock(customersApi.useUpdateCustomer).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('offers New sales order pointing at the sales order form for this customer', () => {
    renderPage()

    expect(screen.getByRole('link', { name: deCustomers.detail.newSalesOrder })).toHaveAttribute(
      'href',
      '/sales-orders/new?customerId=cust-100',
    )
  })

  it('explains that invoices are created from sales orders', () => {
    renderPage()

    expect(screen.getByText(deCustomers.detail.invoiceHint)).toBeVisible()
  })

  it('does not offer direct invoice creation on the customer page', () => {
    renderPage()

    expect(screen.queryByRole('link', { name: /invoice/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /invoice/i })).not.toBeInTheDocument()
  })

  it('links back to the customer list and marks the customer name as the current page', () => {
    renderPage()

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getByRole('link', { name: 'Kunden' })).toHaveAttribute('href', '/customers')
    expect(within(trail).getByText('John Doe')).toHaveAttribute('aria-current', 'page')
  })
})
