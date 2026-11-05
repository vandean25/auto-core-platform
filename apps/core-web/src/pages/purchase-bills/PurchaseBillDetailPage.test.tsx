import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as purchaseInvoicesApi from '@/api/usePurchaseInvoices'
import deFinance from '../../../../../locales/de/finance.json'
import PurchaseBillDetailPage from './PurchaseBillDetailPage'

vi.mock('@/api/usePurchaseInvoices')

const postedBill = {
  id: 'pb-1',
  status: 'POSTED',
  vendor_invoice_number: 'ER-2026-17',
  vendor: { name: 'Teile GmbH' },
  total_amount: '270.00',
  invoice_date: '2026-10-01',
  due_date: '2026-10-31',
  lines: [
    { id: 'l1', description: 'Bremsbeläge vorne', quantity: '2', unit_price: '50.00', line_total: '100.00' },
    { id: 'l2', description: 'Ölfilter', quantity: '2', unit_price: '85.00', line_total: '170.00' },
  ],
}

function mockQuery(result: { data?: unknown; isLoading?: boolean; error?: unknown }) {
  vi.mocked(purchaseInvoicesApi.usePurchaseInvoice).mockReturnValue(
    result as unknown as ReturnType<typeof purchaseInvoicesApi.usePurchaseInvoice>,
  )
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/purchase-bills/pb-1']}>
        <Routes>
          <Route path="/purchase-bills/:id" element={<PurchaseBillDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PurchaseBillDetailPage (AUT-659)', () => {
  beforeEach(() => {
    vi.mocked(purchaseInvoicesApi.usePayPurchaseInvoice).mockReturnValue(
      { mutateAsync: vi.fn(), isPending: false } as unknown as ReturnType<typeof purchaseInvoicesApi.usePayPurchaseInvoice>,
    )
  })
  afterEach(cleanup)

  // Regression: the loading state was a bare text block instead of a skeleton.
  it('WHEN the purchase bill is loading THEN a Skeleton is shown instead of the loading text', async () => {
    mockQuery({ data: undefined, isLoading: true })
    const { container } = renderPage()

    expect(await screen.findByRole('status')).toHaveTextContent(deFinance.purchaseBills.detail.loading)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })

  // Regression: the load failure was a bare text line, not the shared Empty.
  it('WHEN the purchase bill cannot be loaded THEN the shared Empty is shown with the German text', () => {
    mockQuery({ data: undefined, isLoading: false, error: new Error('boom') })
    const { container } = renderPage()

    expect(container.querySelector('[data-slot="empty"]')).toHaveTextContent(deFinance.purchaseBills.detail.loadFailed)
  })

  // Regression: the line items were a hand-built raw <table>.
  it('WHEN the purchase bill renders THEN no raw table remains and all lines are still shown', () => {
    mockQuery({ data: postedBill, isLoading: false, error: null })
    const { container } = renderPage()

    const region = screen.getByRole('region', { name: 'Scrollbare Tabelle' })
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(region.contains(container.querySelector('table'))).toBe(true)
    const table = within(region)
    expect(table.getByText('Bremsbeläge vorne')).toBeInTheDocument()
    expect(table.getByText('Ölfilter')).toBeInTheDocument()
    expect(table.getByText(/170,00/)).toBeInTheDocument()
  })
})
