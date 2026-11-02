import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import * as readinessApi from '@/api/useAccountingExportReadiness'
import * as siteAdminApi from '@/api/site-admin'
import deFinance from '../../../../../locales/de/finance.json'
import { registerGermanUiForTests } from '@/test/german-ui'
import AccountingExportReadinessPage from './AccountingExportReadinessPage'

registerGermanUiForTests()

vi.mock('@/api/useAccountingExportReadiness')
vi.mock('@/api/site-admin')

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

const berlin = {
  id: 'le-berlin',
  name: 'Berlin Motors GmbH',
  country_iso: 'DE',
  is_active: true,
}

const readinessResponse = {
  legalEntityId: 'le-berlin',
  dateFrom: '2026-03-01',
  dateTo: '2026-03-31',
  periodClosed: true,
  summary: {
    documentCount: 5,
    exportableCount: 3,
    blockedCount: 2,
    reasons: [
      { code: 'LEGACY_DOCUMENT_UNSUPPORTED', documentCount: 1 },
      { code: 'UNSUPPORTED_EXPORT_COUNTRY', documentCount: 1 },
    ],
  },
  tenantWideBlockers: [
    {
      code: 'MISSING_OWNERSHIP_EVIDENCE',
      message: 'Document ownership or numbering evidence is incomplete.',
      documentId: 'inv-no-entity',
      documentKind: 'INVOICE',
      documentNumber: 'RE-2026-0009',
    },
  ],
  data: [
    {
      id: 'inv-at',
      kind: 'INVOICE',
      number: 'RE-2026-0002',
      date: '2026-03-12',
      site: { id: 'site-berlin', code: 'DE-BER', name: 'Berlin Branch' },
      status: 'BLOCKED',
      blockers: [
        {
          code: 'UNSUPPORTED_EXPORT_COUNTRY',
          message: 'Only DE domestic STANDARD VAT exports are enabled in slice 1.',
        },
      ],
      href: '/sales/invoices/inv-at',
    },
    {
      id: 'cn-de',
      kind: 'CREDIT_NOTE',
      number: 'CN-2026-0001',
      date: '2026-03-25',
      site: { id: 'site-berlin', code: 'DE-BER', name: 'Berlin Branch' },
      status: 'EXPORTABLE',
      blockers: [],
      href: '/finance/credit-notes/cn-de',
    },
  ],
  exportProfile: { configured: true, canGenerate: true },
  meta: { total: 2, page: 1, limit: 25, pageCount: 1 },
}

// Sets what the readiness query returns on the next render.
function mockReadiness(result: { data?: unknown; error?: Error | null } = {}) {
  asMock(readinessApi.useAccountingExportReadiness).mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    ...result,
  })
}

function renderPage(initialPath: string = APP_ROUTE_PATHS.accountingExportReadiness) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path={APP_ROUTE_PATHS.accountingExportReadiness}
            element={<AccountingExportReadinessPage />}
          />
          <Route
            path={APP_ROUTE_PATHS.salesInvoiceDetail}
            element={<div>Invoice detail page</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AccountingExportReadinessPage', () => {
  beforeEach(() => {
    asMock(siteAdminApi.useLegalEntities).mockReturnValue({
      data: [berlin],
      isLoading: false,
    })
    mockReadiness({ data: readinessResponse })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows exportable and blocked counts with the reasons behind the blocks', () => {
    renderPage()

    const summary = screen.getByRole('region', {
      name: deFinance.accountingExportReadiness.summaryRegion,
    })
    expect(summary).toHaveTextContent(new RegExp(`${deFinance.accountingExportReadiness.exportable}\\s*3`))
    expect(summary).toHaveTextContent(new RegExp(`${deFinance.accountingExportReadiness.blocked}\\s*2`))
    for (const reason of [
      deFinance.accountingExportReadiness.blockers.LEGACY_DOCUMENT_UNSUPPORTED,
      deFinance.accountingExportReadiness.blockers.UNSUPPORTED_EXPORT_COUNTRY,
    ]) {
      const escaped = reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(screen.getByRole('button', { name: new RegExp(escaped) })).toBeInTheDocument()
    }
    expect(
      screen.getByText('Document ownership or numbering evidence is incomplete.'),
    ).toBeInTheDocument()
  })

  it('filters the document list by a reason chosen from the breakdown', () => {
    renderPage()

    const chip = screen.getByRole('button', {
      name: new RegExp(deFinance.accountingExportReadiness.blockers.UNSUPPORTED_EXPORT_COUNTRY),
    })
    fireEvent.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(readinessApi.useAccountingExportReadiness).toHaveBeenLastCalledWith(
      expect.objectContaining({
        legalEntityId: 'le-berlin',
        reason: 'UNSUPPORTED_EXPORT_COUNTRY',
      }),
    )
  })

  it('opens a document from its row at the link the API returned', () => {
    renderPage()

    fireEvent.click(screen.getByText('RE-2026-0002'))

    expect(screen.getByText('Invoice detail page')).toBeInTheDocument()
  })

  it('takes the period in the German date format, not in a browser-dependent native date input', () => {
    mockReadiness({ data: readinessResponse })
    renderPage()

    const from = screen.getByLabelText(deFinance.accountingExportReadiness.from)
    const to = screen.getByLabelText(deFinance.accountingExportReadiness.to)
    expect(from).toHaveAttribute('type', 'text')
    expect(to).toHaveAttribute('type', 'text')
    expect((from as HTMLInputElement).value).toMatch(/^\d{2}\.\d{2}\.\d{4}$/)

    fireEvent.change(to, { target: { value: '31.03.2026' } })

    expect(asMock(readinessApi.useAccountingExportReadiness)).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateTo: '2026-03-31' }),
    )
  })

  it('does not query until a legal entity is available', () => {
    asMock(siteAdminApi.useLegalEntities).mockReturnValue({
      data: [],
      isLoading: false,
    })

    renderPage()

    expect(
      screen.getByText(deFinance.accountingExportReadiness.chooseLegalEntityHint),
    ).toBeInTheDocument()
    expect(readinessApi.useAccountingExportReadiness).toHaveBeenLastCalledWith(null)
  })

  it('shows only the refusal when the readiness request fails', () => {
    mockReadiness({ error: new Error('Export scope is incomplete for the current user.') })

    renderPage()

    expect(
      screen.getByText('Export scope is incomplete for the current user.'),
    ).toBeInTheDocument()
    // A refused request has no data, so no cards, reasons, or document rows show.
    expect(
      screen.queryByRole('region', { name: deFinance.accountingExportReadiness.summaryRegion }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('RE-2026-0002')).not.toBeInTheDocument()
    expect(
      screen.queryByText(deFinance.accountingExportReadiness.emptyState),
    ).not.toBeInTheDocument()
  })

  it('sends the default date sort to the API', () => {
    renderPage()

    expect(readinessApi.useAccountingExportReadiness).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortField: 'date', sortDirection: 'asc' }),
    )
  })

  it('returns to the first page when a filter changes', () => {
    renderPage(`${APP_ROUTE_PATHS.accountingExportReadiness}?page=3`)

    expect(readinessApi.useAccountingExportReadiness).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 3 }),
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: new RegExp(deFinance.accountingExportReadiness.blockers.UNSUPPORTED_EXPORT_COUNTRY),
      }),
    )

    expect(readinessApi.useAccountingExportReadiness).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        reason: 'UNSUPPORTED_EXPORT_COUNTRY',
      }),
    )
  })

  it('keeps a hand-edited search and page size inside the API limits', () => {
    const longSearch = 'a'.repeat(300)
    renderPage(
      `${APP_ROUTE_PATHS.accountingExportReadiness}?search=${longSearch}&pageSize=500`,
    )

    expect(readinessApi.useAccountingExportReadiness).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'a'.repeat(200), limit: 100 }),
    )
  })

  it('reads a fractional page or page size as a whole number', () => {
    renderPage(`${APP_ROUTE_PATHS.accountingExportReadiness}?page=2.5&pageSize=10.5`)

    expect(readinessApi.useAccountingExportReadiness).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, limit: 10 }),
    )
  })

  it('warns when the legal entity has no export profile that can generate', () => {
    mockReadiness({
      data: { ...readinessResponse, exportProfile: { configured: false, canGenerate: false } },
    })

    renderPage()

    expect(
      screen.getByText(deFinance.accountingExportReadiness.exportProfileMissing),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: deFinance.actions.openSettings }),
    ).toBeInTheDocument()
  })
})
