import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CreditNoteDetailPage from './CreditNoteDetailPage'
import type { CreditNoteResponseDto } from '@/api/useCreditNotes'
import type { Invoice } from '@/api/types'
import * as creditNotesApi from '@/api/useCreditNotes'
import * as salesApi from '@/api/sales'
import { triggerBlobDownload } from '@/lib/download'
import deFinance from '../../../../../locales/de/finance.json'

const mockPostPdfDownload = vi.fn()
let mockActiveRole = 'OWNER'

vi.mock('@/api/useCreditNotes')
vi.mock('@/api/sales')
vi.mock('@/lib/download', () => ({
  triggerBlobDownload: vi.fn(),
}))
vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({ data: { activeRole: mockActiveRole } }),
}))
vi.mock('@/hooks/usePdfDownload', () => ({
  usePdfDownload: () => ({
    download: mockPostPdfDownload,
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

function makeCreditNote(
  overrides: Partial<CreditNoteResponseDto> = {},
): CreditNoteResponseDto {
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
    ...overrides,
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

function renderPage(creditNote: CreditNoteResponseDto = makeCreditNote()) {
  asMock(creditNotesApi.useCreditNote).mockReturnValue({
    data: creditNote,
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

  it('labels each credited quantity input for assistive technology', () => {
    renderPage()

    const quantityInput = screen.getByLabelText(
      deFinance.creditNotes.quantityInputAria.replace('{{description}}', lineDescription),
    )
    expect(quantityInput).toHaveAttribute('id', `credit-line-quantity-${lineItemId}`)
  })
})

describe('CreditNoteDetailPage PDF for SALES (AUT-911)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveRole = 'SALES'
    asMock(salesApi.useInvoice).mockReturnValue({
      data: makeInvoice(),
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
  })

  afterEach(() => {
    cleanup()
    mockActiveRole = 'OWNER'
  })

  it('downloads an already-generated PDF over GET only and never POSTs', async () => {
    const blob = new Blob(['pdf'], { type: 'application/pdf' })
    asMock(creditNotesApi.downloadCreditNotePdf).mockResolvedValue(blob)
    renderPage(
      makeCreditNote({
        status: 'FINALIZED',
        creditNumber: 'CN-2026-0001',
        pdfGeneratedAt: '2026-03-02T00:00:00.000Z',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: deFinance.actions.print }))

    await waitFor(() =>
      expect(creditNotesApi.downloadCreditNotePdf).toHaveBeenCalledWith('cn-1', {
        poll: false,
      }),
    )
    expect(triggerBlobDownload).toHaveBeenCalledWith(
      blob,
      'credit_note_cn_2026_0001.pdf',
    )
    expect(mockPostPdfDownload).not.toHaveBeenCalled()
  })

  it('hides Print and shows a short hint when no PDF was generated yet', () => {
    renderPage(
      makeCreditNote({
        status: 'FINALIZED',
        creditNumber: 'CN-2026-0001',
        pdfGeneratedAt: null,
      }),
    )

    expect(
      screen.queryByRole('button', { name: deFinance.actions.print }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(deFinance.creditNotes.detail.pdfNotGeneratedHint),
    ).toBeInTheDocument()
    expect(mockPostPdfDownload).not.toHaveBeenCalled()
  })

  it('shows no write actions and the read-only draft hint on a draft', () => {
    renderPage(makeCreditNote({ status: 'DRAFT' }))

    expect(
      screen.queryByRole('button', { name: deFinance.actions.finalize }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: deFinance.actions.void }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(deFinance.creditNotes.detail.draftEditHint),
    ).toBeInTheDocument()
  })
})
