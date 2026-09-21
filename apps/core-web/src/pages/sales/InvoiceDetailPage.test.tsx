import { cleanup, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InvoiceDetailPage from './InvoiceDetailPage'
import * as salesApi from '@/api/sales'
import type { Invoice } from '@/api/types'

vi.mock('@/api/sales')
vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({ data: { activeRole: 'OWNER' } }),
}))
vi.mock('@/api/useCreditNotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/useCreditNotes')>()
  return {
    ...actual,
    useInvoiceCreditContext: () => ({ data: undefined }),
    useCreateCreditNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  }
})
vi.mock('@/api/workshop', () => ({
  useWorkshopOrder: () => ({ data: undefined, isLoading: false, error: null }),
}))
vi.mock('@/api/invoices', () => ({
  useGenerateInvoicePdf: () => ({ mutateAsync: vi.fn(), isPending: false }),
  downloadInvoicePdf: vi.fn(),
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const customer = {
  id: 'cust-1',
  type: 'PRIVATE' as const,
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
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

function renderPage(invoice: Invoice) {
  asMock(salesApi.useInvoice).mockReturnValue({
    data: invoice,
    isLoading: false,
    isError: false,
    error: null,
  })

  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/sales/invoices/${invoice.id}`]}>
        <Routes>
          <Route path="/sales/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/sales/invoices/:id/edit" element={<div>Draft editor</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('InvoiceDetailPage draft routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('redirects sales-order drafts to the edit route', () => {
    renderPage(
      makeInvoice({
        status: 'DRAFT',
        invoice_number: undefined,
        sales_order_id: 'so-1',
      }),
    )

    expect(screen.getByText('Draft editor')).toBeInTheDocument()
  })

  it('stays on detail when cached invoice is FINALIZED with an RE number', () => {
    renderPage(
      makeInvoice({
        sales_order_id: 'so-1',
        status: 'FINALIZED',
        invoice_number: 'RE-2026-0001',
      }),
    )

    expect(screen.getByRole('heading', { name: 'RE-2026-0001' })).toBeInTheDocument()
    expect(screen.queryByText('Draft editor')).not.toBeInTheDocument()
  })
})
