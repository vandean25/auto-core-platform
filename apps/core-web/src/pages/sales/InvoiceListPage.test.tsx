import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Invoice } from '@/api/types'
import * as salesApi from '@/api/sales'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import InvoiceListPage from './InvoiceListPage'

vi.mock('@/api/sales')

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const customer = {
  id: 'cust-1',
  type: 'PRIVATE' as const,
  first_name: 'Ada',
  last_name: 'Lovelace',
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    status: 'FINALIZED',
    customer_id: customer.id,
    customer,
    date: '2026-01-15T00:00:00.000Z',
    due_date: '2026-01-29T00:00:00.000Z',
    total_net: '100.00',
    total_tax: '19.00',
    total_gross: '119.00',
    items: [],
    invoice_number: 'RE-2026-0001',
    ...overrides,
  }
}

function renderPage(initialPath = '/sales/invoices') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SavedViewsProvider userKey="test-user">
        <MemoryRouter initialEntries={[initialPath]}>
          <InvoiceListPage />
        </MemoryRouter>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

describe('InvoiceListPage', () => {
  beforeEach(() => {
    asMock(salesApi.useInvoices).mockReturnValue({
      data: [makeInvoice()],
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the invoice list DataTable (AUT-311)', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Sales Invoices' })).toBeInTheDocument()
    expect(screen.getByText('RE-2026-0001')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
  })

  it('reorders rows when sortField and sortDirection change', () => {
    asMock(salesApi.useInvoices).mockReturnValue({
      data: [
        makeInvoice({
          id: 'inv-newer',
          invoice_number: 'RE-2026-0002',
          date: '2026-02-01T00:00:00.000Z',
        }),
        makeInvoice({
          id: 'inv-older',
          invoice_number: 'RE-2026-0001',
          date: '2026-01-01T00:00:00.000Z',
        }),
      ],
      isLoading: false,
    })

    renderPage('/sales/invoices?sortField=date&sortDirection=asc')

    const rows = screen.getAllByRole('row')
    const bodyRows = rows.slice(1)
    expect(bodyRows[0]).toHaveTextContent('RE-2026-0001')
    expect(bodyRows[1]).toHaveTextContent('RE-2026-0002')
  })
})
