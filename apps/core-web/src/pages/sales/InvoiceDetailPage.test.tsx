import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InvoiceDetailPage from './InvoiceDetailPage'
import * as salesApi from '@/api/sales'
import * as invoicesApi from '@/api/invoices'
import type { Invoice } from '@/api/types'
import type { UsePdfDownloadConfig } from '@/hooks/usePdfDownload'

const mockDownload = vi.fn().mockResolvedValue(true)
let mockIsLoading = false
let capturedPdfConfig: UsePdfDownloadConfig | undefined

vi.mock('@/hooks/usePdfDownload', () => ({
  usePdfDownload: (config?: UsePdfDownloadConfig) => {
    capturedPdfConfig = config
    return {
      download: mockDownload,
      isLoading: mockIsLoading,
      isDownloading: mockIsLoading,
    }
  },
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

describe('InvoiceDetailPage print action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsLoading = false
    capturedPdfConfig = undefined
  })

  afterEach(() => {
    cleanup()
  })

  it('configures usePdfDownload and triggers download when clicking Print', async () => {
    const invoice = makeInvoice({
      id: 'inv-123',
      invoice_number: 'RE-2026-0042',
      status: 'FINALIZED',
    })
    renderPage(invoice)

    const printButton = screen.getByRole('button', { name: /print/i })
    expect(printButton).toBeInTheDocument()
    expect(printButton).not.toBeDisabled()

    fireEvent.click(printButton)
    expect(mockDownload).toHaveBeenCalledTimes(1)

    expect(capturedPdfConfig).toBeDefined()
    const resolvedPostUrl =
      typeof capturedPdfConfig?.postUrl === 'function'
        ? capturedPdfConfig.postUrl()
        : capturedPdfConfig?.postUrl
    const resolvedGetUrl =
      typeof capturedPdfConfig?.getUrl === 'function'
        ? capturedPdfConfig.getUrl()
        : capturedPdfConfig?.getUrl
    const resolvedFilename =
      typeof capturedPdfConfig?.filename === 'function'
        ? capturedPdfConfig.filename()
        : capturedPdfConfig?.filename

    expect(resolvedPostUrl).toBe('/api/invoices/inv-123/pdf')
    expect(resolvedGetUrl).toBe('/api/invoices/inv-123/pdf')
    expect(resolvedFilename).toBe('invoice_re_2026_0042.pdf')
    expect(capturedPdfConfig?.messages?.success).toBe(
      'Invoice PDF downloaded successfully',
    )
    expect(capturedPdfConfig?.messages?.errorFallback).toBe(
      'Fehler beim Erstellen der Rechnungs-PDF',
    )

    await capturedPdfConfig?.checkGenerationFailed?.()
    expect(invoicesApi.fetchInvoicePdfGenerationError).toHaveBeenCalledWith('inv-123')
  })

  it('renders disabled state with Generating... while printing', () => {
    mockIsLoading = true
    const invoice = makeInvoice({
      id: 'inv-123',
      invoice_number: 'RE-2026-0042',
      status: 'FINALIZED',
    })
    renderPage(invoice)

    const printButton = screen.getByRole('button', { name: /generating\.\.\./i })
    expect(printButton).toBeInTheDocument()
    expect(printButton).toBeDisabled()
  })
})
