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
        id: 'cn-item-1',
        originalInvoiceItemId: lineItemId,
        quantity: '1',
        snapshot: null,
      },
    ],
    remainingLines: [
      {
        originalItemId: lineItemId,
        remainingQuantity: '2',
        remainingNet: '100.00',
        remainingTax: '19.00',
        remainingGross: '119.00',
      },
    ],
  }
}

function makeInvoice(): Invoice {
  return {
    id: 'inv-1',
    status: 'FINALIZED',
    customer_id: 'cust-1',
    customer: {
      id: 'cust-1',
      type: 'PRIVATE',
      first_name: 'Test',
      last_name: 'Customer',
      email: 'test@example.com',
    },
    date: '2026-02-01T00:00:00.000Z',
    due_date: '2026-02-15T00:00:00.000Z',
    total_net: '100.00',
    total_tax: '19.00',
    total_gross: '119.00',
    items: [
      {
        id: lineItemId,
        description: lineDescription,
        quantity: '2',
        unit_price: '50.00',
        tax_rate: 19,
      },
    ],
    invoice_number: 'RE-2026-0001',
  }
}

function renderPage() {
  asMock(creditNotesApi.useCreditNote).mockReturnValue({
    data: makeCreditNote(),
    isLoading: false,
    isError: false,
    error: null,
  })
  asMock(creditNotesApi.useUpdateCreditNoteDraft).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  })
  asMock(creditNotesApi.useFinalizeCreditNote).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  })
  asMock(creditNotesApi.useVoidCreditNote).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  })
  asMock(salesApi.useInvoice).mockReturnValue({
    data: makeInvoice(),
    isLoading: false,
    isError: false,
    error: null,
  })

  return render(
    <QueryClientProvider client={new QueryClient()}>
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
