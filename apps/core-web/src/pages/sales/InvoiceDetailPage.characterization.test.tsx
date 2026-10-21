import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InvoiceDetailPage from './InvoiceDetailPage'
import { deSales } from '@/test/de-sales'
import * as salesApi from '@/api/sales'
import type { Invoice, InvoiceItem } from '@/api/types'
import { formatCurrency } from '@/lib/utils'
import { formatDateShort } from '@/lib/format'

const detail = deSales.invoices.detail

let mockRole = 'OWNER'
let mockCreditContext: unknown
let mockSettlement: unknown
let mockWorkshop: { data?: unknown; isLoading: boolean; error: unknown }
const creditContextArgs: string[] = []
const workshopOrderArgs: string[] = []
const settlementArgs: (string | undefined)[] = []

vi.mock('@/hooks/usePdfDownload', () => ({
  usePdfDownload: () => ({ download: vi.fn(), isLoading: false, isDownloading: false }),
}))
vi.mock('@/api/sales')
vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({ data: { activeRole: mockRole } }),
}))
vi.mock('@/api/useCreditNotes', () => ({
  useInvoiceCreditContext: (invoiceId: string) => {
    creditContextArgs.push(invoiceId)
    return { data: mockCreditContext }
  },
}))
vi.mock('@/api/workshop', () => ({
  useWorkshopOrder: (id: string) => {
    workshopOrderArgs.push(id)
    return mockWorkshop
  },
}))
vi.mock('@/api/invoices', () => ({
  fetchInvoicePdfGenerationError: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/api/useInvoiceSettlement', () => ({
  useInvoiceSettlement: (invoiceId?: string) => {
    settlementArgs.push(invoiceId)
    return { data: mockSettlement }
  },
}))
vi.mock('@/components/finance/InvoiceSettlementActions', () => ({
  InvoiceSettlementActions: (props: object) => (
    <div data-testid="settlement-actions">{JSON.stringify(props)}</div>
  ),
}))
vi.mock('@/components/finance/InvoiceSettlementPanel', () => ({
  InvoiceSettlementPanel: (props: object) => (
    <div data-testid="settlement-panel">{JSON.stringify(props)}</div>
  ),
}))
vi.mock('@/components/finance/create-credit-note-dialog-content', () => ({
  CreateCreditNoteDialog: (props: {
    invoice: Invoice
    open: boolean
    onCreated: (creditNoteId: string) => void
  }) => (
    <div data-testid="credit-note-dialog" data-open={String(props.open)} data-invoice={props.invoice.id}>
      <button type="button" onClick={() => props.onCreated('cn-9')}>
        stub-created
      </button>
    </div>
  ),
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

function makeItem(overrides: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    id: 'item-1',
    description: 'Oil filter',
    quantity: '1.00',
    unit_price: '10.00',
    tax_rate: 20,
    ...overrides,
  }
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
    total_tax: '20.00',
    total_gross: '120.00',
    items: [],
    invoice_number: 'RE-2026-0001',
    ...overrides,
  }
}

function makeCreditNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cn-1',
    originalInvoiceId: 'inv-1',
    status: 'FINALIZED',
    creditNumber: 'GS-2026-0001',
    date: '2026-01-20',
    reason: 'Damaged part',
    version: 1,
    totalNet: '10.00',
    totalTax: '2.00',
    totalGross: '12.00',
    items: [],
    remainingLines: [],
    ...overrides,
  }
}

function setInvoiceQuery(query: { data?: Invoice; isLoading?: boolean; isError?: boolean; error?: unknown }) {
  asMock(salesApi.useInvoice).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    ...query,
  })
}

function renderPage(invoice?: Invoice) {
  if (invoice) setInvoiceQuery({ data: invoice })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/sales/invoices/inv-1']}>
        <Routes>
          <Route path="/sales/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/sales/invoices/:id/edit" element={<div>Draft editor</div>} />
          <Route path="/finance/credit-notes/:id" element={<div>Credit note page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function totalsValue(label: string) {
  return screen.getByText(label, { selector: 'span' }).nextSibling
}

function bodyRows() {
  const [, body] = screen.getAllByRole('rowgroup')
  return within(body)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRole = 'OWNER'
  mockCreditContext = undefined
  mockSettlement = undefined
  mockWorkshop = { data: undefined, isLoading: false, error: null }
  creditContextArgs.length = 0
  workshopOrderArgs.length = 0
  settlementArgs.length = 0
})

afterEach(() => {
  cleanup()
})

describe('InvoiceDetailPage characterization: load states', () => {
  it('shows the loading text while the invoice loads', () => {
    setInvoiceQuery({ isLoading: true })
    renderPage()
    expect(screen.getByText(detail.loading)).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('shows not found for a 404 error', () => {
    setInvoiceQuery({ isError: true, error: { status: 404, message: 'Not Found' } })
    renderPage()
    expect(screen.getByText(detail.notFound)).toBeInTheDocument()
  })

  it('shows the load-failed fallback for other errors', () => {
    setInvoiceQuery({ isError: true, error: 'boom' })
    renderPage()
    expect(screen.getByText(deSales.errors.loadFailed)).toBeInTheDocument()
    expect(screen.queryByText(detail.notFound)).not.toBeInTheDocument()
  })

  it('shows not found when the query settles without an invoice', () => {
    setInvoiceQuery({})
    renderPage()
    expect(screen.getByText(detail.notFound)).toBeInTheDocument()
  })

  it('keeps a draft without a sales order on the detail page', () => {
    renderPage(makeInvoice({ status: 'DRAFT', invoice_number: null, id: 'inv-12345678-abcd' }))
    expect(screen.queryByText('Draft editor')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rechnung inv-1234' })).toBeInTheDocument()
  })
})

describe('InvoiceDetailPage characterization: header and info', () => {
  it('shows status, customer name and formatted dates', () => {
    renderPage(makeInvoice())
    expect(screen.getByRole('heading', { name: 'RE-2026-0001' })).toBeInTheDocument()
    expect(screen.getByText(detail.invoiceInfo)).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText(formatDateShort('2026-01-15T00:00:00.000Z'))).toBeInTheDocument()
    expect(screen.getByText(formatDateShort('2026-01-29T00:00:00.000Z'))).toBeInTheDocument()
  })

  it('names a company by its company name', () => {
    renderPage(
      makeInvoice({
        customer: { ...customer, type: 'COMPANY', company_name: 'Garage GmbH' },
      }),
    )
    expect(screen.getByText('Garage GmbH')).toBeInTheDocument()
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
  })

  it('falls back to the trimmed person name for a company without a company name', () => {
    renderPage(
      makeInvoice({
        customer: { ...customer, type: 'COMPANY', company_name: '', last_name: '' },
      }),
    )
    expect(screen.getByText('Ada', { exact: true })).toBeInTheDocument()
  })
})

describe('InvoiceDetailPage characterization: credit notes', () => {
  it('lets an owner open the credit note dialog and navigates to the created note', () => {
    renderPage(makeInvoice())
    expect(creditContextArgs.every((arg) => arg === 'inv-1')).toBe(true)
    const dialog = screen.getByTestId('credit-note-dialog')
    expect(dialog).toHaveAttribute('data-open', 'false')
    expect(dialog).toHaveAttribute('data-invoice', 'inv-1')
    expect(screen.queryByText(detail.creditNoteGuidance)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: detail.creditNote }))
    expect(screen.getByTestId('credit-note-dialog')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'stub-created' }))
    expect(screen.getByText('Credit note page')).toBeInTheDocument()
  })

  it.each(['ISSUED', 'PAID'] as const)('offers a credit note on a %s invoice', (status) => {
    renderPage(makeInvoice({ status }))
    expect(screen.getByRole('button', { name: detail.creditNote })).toBeInTheDocument()
  })

  it('shows guidance instead of the action to a role that cannot manage credit notes', () => {
    mockRole = 'STAFF'
    renderPage(makeInvoice())
    expect(creditContextArgs.every((arg) => arg === '')).toBe(true)
    expect(screen.getByText(detail.creditNoteGuidance)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: detail.creditNote })).not.toBeInTheDocument()
    expect(screen.queryByTestId('credit-note-dialog')).not.toBeInTheDocument()
  })

  it('offers neither action nor guidance on a non-eligible invoice', () => {
    mockRole = 'STAFF'
    renderPage(makeInvoice({ status: 'DRAFT' }))
    expect(screen.queryByText(detail.creditNoteGuidance)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: detail.creditNote })).not.toBeInTheDocument()
  })

  it('hides the action and shows the coverage badge on a fully credited invoice', () => {
    mockCreditContext = { creditNotes: [], remainingLines: [], coverageStatus: 'FULLY_CREDITED' }
    renderPage(makeInvoice())
    expect(screen.getByText(detail.creditFully)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: detail.creditNote })).not.toBeInTheDocument()
  })

  it('keeps the action and shows the partial badge on a partially credited invoice', () => {
    mockCreditContext = { creditNotes: [], remainingLines: [], coverageStatus: 'PARTIALLY_CREDITED' }
    renderPage(makeInvoice())
    expect(screen.getByText(detail.creditPartially)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: detail.creditNote })).toBeInTheDocument()
  })

  it('shows no coverage badge and no related card without credit notes', () => {
    mockCreditContext = { creditNotes: [], remainingLines: [], coverageStatus: 'NONE' }
    renderPage(makeInvoice())
    expect(screen.queryByText(detail.creditPartially)).not.toBeInTheDocument()
    expect(screen.queryByText(detail.creditFully)).not.toBeInTheDocument()
    expect(screen.queryByText(detail.relatedCreditNotes)).not.toBeInTheDocument()
  })

  it('lists related credit notes with link, reason, amount and status', () => {
    mockCreditContext = {
      creditNotes: [
        makeCreditNote(),
        makeCreditNote({ id: 'cn-draft-123456', creditNumber: null, reason: 'Goodwill', totalGross: '5.50', status: 'DRAFT' }),
      ],
      remainingLines: [],
      coverageStatus: 'PARTIALLY_CREDITED',
    }
    renderPage(makeInvoice())
    expect(screen.getByText(detail.relatedCreditNotes)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'GS-2026-0001' })).toHaveAttribute('href', '/finance/credit-notes/cn-1')
    expect(screen.getByRole('link', { name: 'Entwurf cn-draft' })).toHaveAttribute(
      'href',
      '/finance/credit-notes/cn-draft-123456',
    )
    expect(screen.getByText('Damaged part')).toBeInTheDocument()
    expect(screen.getByText('Goodwill')).toBeInTheDocument()
    expect(screen.getByText(formatCurrency(12), { normalizer: (text) => text })).toBeInTheDocument()
    expect(screen.getByText(formatCurrency(5.5), { normalizer: (text) => text })).toBeInTheDocument()
  })
})

describe('InvoiceDetailPage characterization: settlement', () => {
  it.each(['ISSUED', 'PAID'] as const)('shows settlement actions and panel on a %s workshop invoice', (status) => {
    mockSettlement = { payment: { id: 'pay-1' }, rksvMode: 'ACTIVE', siteTimezone: 'Europe/Vienna' }
    mockRole = 'STAFF'
    renderPage(makeInvoice({ status, workshop_order_id: 'wo-1' }))
    expect(settlementArgs.every((arg) => arg === 'inv-1')).toBe(true)
    expect(JSON.parse(screen.getByTestId('settlement-actions').textContent ?? '')).toEqual({
      invoiceId: 'inv-1',
      invoiceStatus: status,
      canManage: false,
    })
    expect(JSON.parse(screen.getByTestId('settlement-panel').textContent ?? '')).toEqual({
      totalGross: 120,
      payment: { id: 'pay-1' },
      rksvMode: 'ACTIVE',
      siteTimezone: 'Europe/Vienna',
    })
  })

  it('hides settlement on a finalized workshop invoice', () => {
    renderPage(makeInvoice({ status: 'FINALIZED', workshop_order_id: 'wo-1' }))
    expect(screen.queryByTestId('settlement-actions')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settlement-panel')).not.toBeInTheDocument()
  })

  it('hides settlement on an issued invoice without a workshop order', () => {
    renderPage(makeInvoice({ status: 'ISSUED' }))
    expect(screen.queryByTestId('settlement-actions')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settlement-panel')).not.toBeInTheDocument()
  })
})

describe('InvoiceDetailPage characterization: line items', () => {
  it('shows the empty row without items', () => {
    renderPage(makeInvoice({ workshop_order_id: 'wo-1' }))
    expect(bodyRows()).toEqual([[detail.noLineItems]])
  })

  it('renders each line with quantity, remaining, price, discount, tax and net', () => {
    mockCreditContext = {
      creditNotes: [],
      remainingLines: [{ originalItemId: 'a', remainingQuantity: '1.500', remainingNet: '0', remainingTax: '0', remainingGross: '0' }],
      coverageStatus: 'PARTIALLY_CREDITED',
    }
    renderPage(
      makeInvoice({
        items: [
          makeItem({ id: 'a', description: 'Plain', quantity: '2.00', unit_price: '10.00', tax_rate: 20 }),
          makeItem({ id: 'b', description: 'Percent', quantity: '1.50', unit_price: '100.00', tax_rate: 10, line_discount_type: 'PERCENTAGE', line_discount_value: '12.5' }),
          makeItem({ id: 'c', description: 'Capped', quantity: '1', unit_price: '40', tax_rate: 0, line_discount_type: 'PERCENTAGE', line_discount_value: '150' }),
          makeItem({ id: 'd', description: 'Flat', quantity: '1', unit_price: '40', tax_rate: 20, line_discount_type: 'FLAT_AMOUNT', line_discount_value: '5' }),
          makeItem({ id: 'e', description: 'Zero', quantity: '1', unit_price: '40', tax_rate: 20, line_discount_type: 'PERCENTAGE', line_discount_value: '0' }),
          makeItem({ id: 'f', description: 'Broken', quantity: 'x', unit_price: 'y', tax_rate: 20 }),
        ],
      }),
    )
    expect(workshopOrderArgs.every((arg) => arg === '')).toBe(true)
    expect(bodyRows()).toEqual([
      ['Plain', '2', '1.5', formatCurrency(10), '—', '20%', formatCurrency(20)],
      ['Percent', '1.5', '—', formatCurrency(100), '12.5%', '10%', formatCurrency(131.25)],
      ['Capped', '1', '—', formatCurrency(40), '100%', '0%', formatCurrency(0)],
      ['Flat', '1', '—', formatCurrency(40), `-${formatCurrency(5)}`, '20%', formatCurrency(35)],
      ['Zero', '1', '—', formatCurrency(40), '—', '20%', formatCurrency(40)],
      ['Broken', '0', '—', formatCurrency(0), '—', '20%', formatCurrency(0)],
    ])
  })
})

describe('InvoiceDetailPage characterization: workshop task groups', () => {
  const workshopItems = [
    makeItem({ id: 'a', description: 'Labour', quantity: '2', unit_price: '50' }),
    makeItem({ id: 'b', description: 'Oil', quantity: '1', unit_price: '20' }),
    makeItem({ id: 'c', description: 'Oil', quantity: '1', unit_price: '20' }),
    makeItem({ id: 'd', description: 'Wiper', quantity: '1', unit_price: '15' }),
  ]

  it('asks for the workshop order and shows a loading row while it loads', () => {
    mockWorkshop = { data: undefined, isLoading: true, error: null }
    renderPage(makeInvoice({ workshop_order_id: 'wo-1', items: workshopItems }))
    expect(workshopOrderArgs.every((arg) => arg === 'wo-1')).toBe(true)
    expect(bodyRows()).toEqual([[detail.loadingTaskGroups]])
  })

  it('shows a failure row and the ungrouped lines when the workshop order fails', () => {
    mockWorkshop = { data: undefined, isLoading: false, error: new Error('nope') }
    renderPage(makeInvoice({ workshop_order_id: 'wo-1', items: workshopItems.slice(0, 1) }))
    expect(bodyRows()).toEqual([
      [detail.taskGroupsFailed],
      ['Labour', '2', '—', formatCurrency(50), '—', '20%', formatCurrency(100)],
    ])
  })

  it('groups lines under matching tasks, once per line, and collects leftovers', () => {
    mockWorkshop = {
      isLoading: false,
      error: null,
      data: {
        id: 'wo-1',
        tasks: [
          {
            id: 't1',
            title: 'Service',
            lineItems: [
              { description: '  LABOUR ', qty: 2, unitPrice: 50 },
              { description: 'oil', qty: 1, unitPrice: 20 },
            ],
          },
          { id: 't2', title: 'Unmatched', lineItems: [{ description: 'Nothing', qty: 1, unitPrice: 1 }] },
          { id: 't3', title: 'No lines' },
          { id: 't4', title: 'Second oil', lineItems: [{ description: 'Oil', qty: 1, unitPrice: 20 }, { description: 'Oil', qty: 1, unitPrice: 20 }] },
        ],
      },
    }
    renderPage(makeInvoice({ workshop_order_id: 'wo-1', items: workshopItems }))
    expect(bodyRows()).toEqual([
      ['Aufgabe: Service'],
      ['Labour', '2', '—', formatCurrency(50), '—', '20%', formatCurrency(100)],
      ['Oil', '1', '—', formatCurrency(20), '—', '20%', formatCurrency(20)],
      [detail.taskSubtotal, formatCurrency(120)],
      ['Aufgabe: Second oil'],
      ['Oil', '1', '—', formatCurrency(20), '—', '20%', formatCurrency(20)],
      [detail.taskSubtotal, formatCurrency(20)],
      [`Aufgabe: ${detail.additionalItems}`],
      ['Wiper', '1', '—', formatCurrency(15), '—', '20%', formatCurrency(15)],
      [detail.taskSubtotal, formatCurrency(15)],
    ])
  })

  it('puts every line under additional items when tasks exist but none match', () => {
    mockWorkshop = {
      isLoading: false,
      error: null,
      data: { id: 'wo-1', tasks: [{ id: 't1', title: 'Other', lineItems: [{ description: 'X', qty: 1, unitPrice: 1 }] }] },
    }
    renderPage(makeInvoice({ workshop_order_id: 'wo-1', items: workshopItems.slice(3) }))
    expect(bodyRows()).toEqual([
      [`Aufgabe: ${detail.additionalItems}`],
      ['Wiper', '1', '—', formatCurrency(15), '—', '20%', formatCurrency(15)],
      [detail.taskSubtotal, formatCurrency(15)],
    ])
  })

  it('falls back to one workshop group when the order has no tasks', () => {
    mockWorkshop = { isLoading: false, error: null, data: { id: 'wo-1', tasks: [] } }
    renderPage(makeInvoice({ workshop_order_id: 'wo-1', items: workshopItems.slice(3) }))
    expect(bodyRows()).toEqual([
      [`Aufgabe: ${detail.workshopTasks}`],
      ['Wiper', '1', '—', formatCurrency(15), '—', '20%', formatCurrency(15)],
      [detail.taskSubtotal, formatCurrency(15)],
    ])
  })

  it('falls back to one workshop group when the order has no data', () => {
    renderPage(makeInvoice({ workshop_order_id: 'wo-1', items: workshopItems.slice(3) }))
    expect(bodyRows()[0]).toEqual([`Aufgabe: ${detail.workshopTasks}`])
  })
})

describe('InvoiceDetailPage characterization: totals', () => {
  it('shows net, tax, savings from line and global discounts, and total', () => {
    renderPage(
      makeInvoice({
        total_net: '80.00',
        total_tax: '16.00',
        total_gross: '96.00',
        global_discount_type: 'FLAT_AMOUNT',
        global_discount_value: '5',
        items: [
          makeItem({ quantity: '1', unit_price: '100', line_discount_type: 'PERCENTAGE', line_discount_value: '10' }),
        ],
      }),
    )
    expect(totalsValue(detail.totals.net)?.textContent).toBe(formatCurrency(80))
    expect(totalsValue(detail.totals.tax)?.textContent).toBe(formatCurrency(16))
    expect(totalsValue(detail.totals.totalSavings)?.textContent).toBe(`-${formatCurrency(15)}`)
    expect(totalsValue(detail.totals.total)?.textContent).toBe(formatCurrency(96))
  })

  it('counts a global percentage discount on the subtotal after line discounts', () => {
    renderPage(
      makeInvoice({
        global_discount_type: 'PERCENTAGE',
        global_discount_value: '50',
        items: [makeItem({ quantity: '1', unit_price: '100', line_discount_type: 'FLAT_AMOUNT', line_discount_value: '20' })],
      }),
    )
    expect(totalsValue(detail.totals.totalSavings)?.textContent).toBe(`-${formatCurrency(60)}`)
  })

  it('hides savings without discounts', () => {
    renderPage(makeInvoice({ items: [makeItem()] }))
    expect(screen.queryByText(detail.totals.totalSavings)).not.toBeInTheDocument()
    expect(screen.getByText(detail.totals.net)).toBeInTheDocument()
  })

  it('shows only the total and the legal note for a margin-scheme invoice', () => {
    renderPage(
      makeInvoice({
        tax_mode: 'MARGIN_SCHEME',
        margin_scheme_legal_note: 'Differenzbesteuerung',
        global_discount_type: 'FLAT_AMOUNT',
        global_discount_value: '5',
        items: [makeItem()],
      }),
    )
    expect(totalsValue(detail.totals.total)?.textContent).toBe(formatCurrency(120))
    expect(screen.getByText('Differenzbesteuerung')).toBeInTheDocument()
    expect(screen.queryByText(detail.totals.net)).not.toBeInTheDocument()
    expect(screen.queryByText(detail.totals.totalSavings)).not.toBeInTheDocument()
  })

  it('shows no legal note paragraph for a margin-scheme invoice without one', () => {
    const { container } = renderPage(makeInvoice({ tax_mode: 'MARGIN_SCHEME', items: [makeItem()] }))
    expect(container.querySelector('p.text-xs')).toBeNull()
  })
})
