import { cleanup, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CreditNoteDetailPage from './CreditNoteDetailPage'
import type { CreditNoteResponseDto } from '@/api/useCreditNotes'
import type { Invoice } from '@/api/types'
import * as creditNotesApi from '@/api/useCreditNotes'
import * as salesApi from '@/api/sales'

vi.mock('@/api/useCreditNotes')
vi.mock('@/api/sales')
vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({ data: { activeRole: 'OWNER' } }),
}))
vi.mock('@/hooks/usePdfDownload', () => ({
  usePdfDownload: () => ({
    download: vi.fn(),
    isLoading: false,
    isDownloading: false,
  }),
}))
vi.mock('@/hooks/useDebouncedAutoSave', () => ({
  useDebouncedAutoSave: () => ({
    saveStatus: 'idle',
    triggerAutoSave: vi.fn(),
    clearPendingSave: vi.fn(),
    abortInFlightSave: vi.fn(),
  }),
}))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const lineItemId = 'inv-line-1'
const lineDescription = 'Brake pads front'

function makeCreditNote(): CreditNoteResponseDto {
  return {
    id: 'cn-1',
    originalInvoiceId: 'inv-1',
    status: 'DRAFT',
    creditNumber: null,
    date: '2026-03-01',
    reason: 'Pricing correction',
    version: 1,
    totalNet: '50.00',
    totalTax: '9.50',
    totalGross: '59.50',
    items: [
      {
        id: 'cn-line-1',
        originalInvoiceItemId: lineItemId,
        description: lineDescription,
        quantity: '1',
        unitPrice: '50.00',
        taxRate: '19',
        lineNet: '50.00',
        lineTax: '9.50',
        lineGross: '59.50',
      },
    ],
  }
}

function makeInvoice(): Invoice {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-100',
    status: 'PAID',
    date: '2026-02-01',
    dueDate: '2026-03-01',
    customerId: 'cust-1',
    customerName: 'Jane Smith',
    totalNet: '100.00',
    totalTax: '19.00',
    totalGross: '119.00',
    items: [
      {
        id: lineItemId,
        description: lineDescription,
        quantity: '2',
        unitPrice: '50.00',
        taxRate: '19',
        lineNet: '100.00',
        lineTax: '19.00',
        lineGross: '119.00',
      },
    ],
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  asMock(creditNotesApi.useCreditNote).mockReturnValue({
    data: makeCreditNote(),
    isLoading: false,
    error: null,
  })
  asMock(creditNotesApi.useUpdateCreditNote).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  })
  asMock(creditNotesApi.useCreditNoteRemainingQuantities).mockReturnValue({
    data: [{ originalInvoiceItemId: lineItemId, remainingQuantity: '1' }],
    isLoading: false,
  })
  asMock(salesApi.useInvoice).mockReturnValue({
    data: makeInvoice(),
    isLoading: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/finance/credit-notes/cn-1']}>
        <Routes>
          <Route path="/finance/credit-notes/:id" element={<CreditNoteDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CreditNoteDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders draft credit note lines', () => {
    renderPage()

    expect(screen.getByText(lineDescription)).toBeInTheDocument()
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()
  })
})
