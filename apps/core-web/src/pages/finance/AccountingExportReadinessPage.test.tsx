import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import * as readinessApi from '@/api/useAccountingExportReadiness'
import * as siteAdminApi from '@/api/site-admin'
import AccountingExportReadinessPage from './AccountingExportReadinessPage'

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
  lockDate: '2026-03-31T00:00:00.000Z',
  summary: {
    documentCount: 5,
    exportableCount: 3,
    blockedCount: 2,
    documentKinds: [
      { kind: 'INVOICE', documentCount: 4, exportableCount: 2, blockedCount: 2 },
      {
        kind: 'CREDIT_NOTE',
        documentCount: 1,
        exportableCount: 1,
        blockedCount: 0,
      },
    ],
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
  meta: { total: 2, page: 1, limit: 25, pageCount: 1 },
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[APP_ROUTE_PATHS.accountingExportReadiness]}>
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
    asMock(readinessApi.useAccountingExportReadiness).mockReturnValue({
      data: readinessResponse,
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows exportable and blocked counts with the reasons behind the blocks', () => {
    renderPage()

    const summary = screen.getByRole('region', { name: 'Readiness summary' })
    expect(within(summary).getByText('Exportable')).toBeInTheDocument()
    expect(within(summary).getByText('Blocked')).toBeInTheDocument()
    expect(within(summary).getByText('3')).toBeInTheDocument()
    expect(within(summary).getByText('2')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Legacy document/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Outside DE export/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Document ownership or numbering evidence is incomplete.'),
    ).toBeInTheDocument()
  })

  it('filters the document list by a reason chosen from the breakdown', () => {
    renderPage()

    const chip = screen.getByRole('button', { name: /Outside DE export/ })
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

  it('does not query until a legal entity is available', () => {
    asMock(siteAdminApi.useLegalEntities).mockReturnValue({
      data: [],
      isLoading: false,
    })

    renderPage()

    expect(
      screen.getByText('Choose a legal entity to see its export readiness.'),
    ).toBeInTheDocument()
    expect(readinessApi.useAccountingExportReadiness).toHaveBeenLastCalledWith(
      null,
    )
  })

  it('shows the refusal message when the readiness request fails', () => {
    asMock(readinessApi.useAccountingExportReadiness).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Export scope is incomplete for the current user.'),
    })

    renderPage()

    expect(
      screen.getByText('Export scope is incomplete for the current user.'),
    ).toBeInTheDocument()
  })
})
