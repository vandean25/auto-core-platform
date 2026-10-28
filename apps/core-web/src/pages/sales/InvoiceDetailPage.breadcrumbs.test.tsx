import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InvoiceDetailPage from './InvoiceDetailPage'
import { deSales } from '@/test/de-sales'
import * as salesApi from '@/api/sales'
import type { Invoice } from '@/api/types'
import {
  PageBreadcrumbsProvider,
  PageContainerWithBreadcrumbs,
} from '@/components/layout/PageBreadcrumbs'

vi.mock('@/hooks/usePdfDownload', () => ({
  usePdfDownload: () => ({
    download: vi.fn(),
    isLoading: false,
    isDownloading: false,
  }),
}))

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
  fetchInvoicePdfGenerationError: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/api/useInvoiceSettlement', () => ({
  useInvoiceSettlement: () => ({ data: undefined, isLoading: false }),
  useRecordSettlement: () => ({ mutate: vi.fn(), isPending: false }),
  useReconcileSettlement: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelFiscalReceipt: () => ({ mutate: vi.fn(), isPending: false }),
  settlementSuccessToastMessage: () => null,
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

function renderPage(invoice: Partial<ReturnType<typeof salesApi.useInvoice>> & { data?: Invoice }) {
  asMock(salesApi.useInvoice).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    ...invoice,
  })

  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/sales/invoices/inv-1']}>
        <PageBreadcrumbsProvider>
          <PageContainerWithBreadcrumbs>
            <Routes>
              <Route path="/sales/invoices/:id" element={<InvoiceDetailPage />} />
            </Routes>
          </PageContainerWithBreadcrumbs>
        </PageBreadcrumbsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('InvoiceDetailPage breadcrumbs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('links back to the invoice list and marks the invoice number as the current page', () => {
    renderPage({ data: makeInvoice() })

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getByRole('link', { name: 'Rechnungen' })).toHaveAttribute(
      'href',
      '/sales/invoices',
    )
    expect(within(trail).getByText('RE-2026-0001')).toHaveAttribute('aria-current', 'page')
  })

  it('shows a generic current label while the invoice is loading', () => {
    renderPage({ data: undefined, isLoading: true })

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getByText(deSales.shared.breadcrumbInvoice)).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
