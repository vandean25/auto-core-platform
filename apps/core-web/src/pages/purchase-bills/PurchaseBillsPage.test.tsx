import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { PurchaseInvoice } from '@/api/types'
import * as purchaseApi from '@/api/usePurchaseInvoices'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import PurchaseBillsPage from './PurchaseBillsPage'

vi.mock('@/api/usePurchaseInvoices')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const vendor = {
  id: 'vendor-1',
  name: 'Bosch',
  email: 'bosch@example.com',
  account_number: 'A-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

function makeBill(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: 'bill-draft',
    vendor_id: vendor.id,
    vendor,
    vendor_invoice_number: 'VB-001',
    status: 'DRAFT',
    invoice_date: '2026-08-01',
    due_date: '2026-08-15',
    total_amount: '100.00',
    lines: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">
          <MemoryRouter initialEntries={['/purchase-bills']}>
            <PurchaseBillsPage />
          </MemoryRouter>
        </DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

describe('PurchaseBillsPage row context Delete', () => {
  const mutateAsync = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    asMock(purchaseApi.useDeletePurchaseInvoice).mockReturnValue({
      mutateAsync,
      isPending: false,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('exposes Delete for draft bills', () => {
    asMock(purchaseApi.usePurchaseInvoices).mockReturnValue({
      data: { data: [makeBill()], meta: { pageCount: 1, page: 1, pageSize: 10, total: 1 } },
      isLoading: false,
    })

    renderPage()
    fireEvent.contextMenu(screen.getByText('VB-001'))

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('hides Delete for posted bills', () => {
    asMock(purchaseApi.usePurchaseInvoices).mockReturnValue({
      data: {
        data: [makeBill({ id: 'bill-posted', vendor_invoice_number: 'VB-002', status: 'POSTED' })],
        meta: { pageCount: 1, page: 1, pageSize: 10, total: 1 },
      },
      isLoading: false,
    })

    renderPage()
    fireEvent.contextMenu(screen.getByText('VB-002'))

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('deletes a draft bill after confirmation', async () => {
    mutateAsync.mockResolvedValue('bill-draft')
    asMock(purchaseApi.usePurchaseInvoices).mockReturnValue({
      data: { data: [makeBill()], meta: { pageCount: 1, page: 1, pageSize: 10, total: 1 } },
      isLoading: false,
    })

    renderPage()
    fireEvent.contextMenu(screen.getByText('VB-001'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith('bill-draft')
    })
    expect(toast.success).toHaveBeenCalledWith('Bill deleted')
  })

  it('toasts the backend error when delete is rejected', async () => {
    mutateAsync.mockRejectedValue(new Error('Invoice not found or no longer in DRAFT status'))
    asMock(purchaseApi.usePurchaseInvoices).mockReturnValue({
      data: { data: [makeBill()], meta: { pageCount: 1, page: 1, pageSize: 10, total: 1 } },
      isLoading: false,
    })

    renderPage()
    fireEvent.contextMenu(screen.getByText('VB-001'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Invoice not found or no longer in DRAFT status')
    })
  })
})
