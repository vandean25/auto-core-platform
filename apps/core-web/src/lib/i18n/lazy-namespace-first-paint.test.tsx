import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthSession } from '@/api/auth-session'
import { useMySites } from '@/api/sites'
import { useWorkshopKpiReport } from '@/api/workshop-kpi-reports'
import { useDueTyreSets, useTyreSet, useTyreSets } from '@/api/tyre-storage'
import { useLocations } from '@/api/locations'
import * as purchaseApi from '@/api/usePurchaseInvoices'
import { useVehicleStockListState } from '@/api/vehicle-stock-list'
import { useTyreSetsByVehicle } from '@/api/tyre-storage'
import { LazyNamespaceLayout } from '@/features/i18n/LazyNamespaceLayout'
import TyreStorageListPage from '@/pages/tyre-storage/TyreStorageListPage'
import WorkshopKpiReportsPage from '@/pages/reports/WorkshopKpiReportsPage'
import SettingsPage from '@/pages/SettingsPage'
import VehicleStockList from '@/pages/vehicle-stock/VehicleStockList'
import PurchaseBillsPage from '@/pages/purchase-bills/PurchaseBillsPage'
import { LazyNamespaceContentGate } from '@/features/i18n/LazyNamespaceContentGate'
import { TyreSetsSummary } from '@/features/tyre-storage/TyreSetsSummary'
import { InvoiceSettlementActions } from '@/components/finance/InvoiceSettlementActions'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import { useInvoiceSettlement } from '@/api/useInvoiceSettlement'
import * as customersApi from '@/api/customers'
import deInventory from '../../../../../locales/de/inventory.json'
import deReports from '../../../../../locales/de/reports.json'
import deSettings from '../../../../../locales/de/settings.json'
import deFinance from '../../../../../locales/de/finance.json'
import deWorkshop from '../../../../../locales/de/workshop.json'
import { deCustomers } from '@/test/de-customers'
import TyreSetDetailPage from '@/pages/tyre-storage/TyreSetDetailPage'
import { changeUiLanguage, ensureNamespaceLoaded } from '@/lib/i18n'
import * as initI18n from '@/lib/i18n/init-i18n'
import { FinanceLocaleGate } from '@/components/finance/FinanceLocaleGate'
import deCommon from '../../../../../locales/de/common.json'
import { stripLazyNamespacesForTest } from '@/test/lazy-namespace-test-helpers'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'

vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({ useMySites: vi.fn() }))
vi.mock('@/api/workshop-kpi-reports', () => ({ useWorkshopKpiReport: vi.fn() }))
vi.mock('@/api/tyre-storage', () => ({
  useTyreSets: vi.fn(),
  useDueTyreSets: vi.fn(),
  useTyreSet: vi.fn(),
  useTyreSetsByVehicle: vi.fn(),
  useTyreSetsByCustomer: vi.fn(),
  useTyreSetAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateTyreSet: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTyreSet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/api/customers')
vi.mock('@/features/tyre-storage/TyreSetFormDialog', () => ({
  TyreSetFormDialog: () => null,
}))
vi.mock('@/features/actions/use-auth-role', () => ({
  useAuthRole: () => 'ADMIN',
}))
vi.mock('@/api/locations', () => ({ useLocations: vi.fn() }))
vi.mock('@/api/usePurchaseInvoices')
vi.mock('@/api/vehicle-stock-list', () => ({ useVehicleStockListState: vi.fn() }))
vi.mock('@/api/useInvoiceSettlement', () => ({
  useCancelFiscalReceipt: () => ({ mutate: vi.fn(), isPending: false }),
  useInvoiceSettlement: vi.fn(),
  useRecordSettlement: () => ({ mutate: vi.fn(), isPending: false }),
  useReconcileSettlement: () => ({ mutate: vi.fn(), isPending: false }),
  SettlementMutationError: class extends Error {},
  settlementSuccessToastMessageKey: () => undefined,
}))

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SavedViewsProvider userKey="test-user">
        <DashboardWidgetsProvider userKey="test-user">{ui}</DashboardWidgetsProvider>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
})

describe('lazy namespace first paint (AUT-945)', () => {
  beforeEach(() => {
    stripLazyNamespacesForTest()
    vi.mocked(customersApi.useCustomers).mockReturnValue({
      data: { data: [] },
      isLoading: false,
    } as never)
  })

  afterEach(async () => {
    await changeUiLanguage('de')
    await ensureNamespaceLoaded('inventory')
    await ensureNamespaceLoaded('reports')
    await ensureNamespaceLoaded('settings')
    await ensureNamespaceLoaded('vehicleStock')
    await ensureNamespaceLoaded('finance')
    await ensureNamespaceLoaded('customers')
    await ensureNamespaceLoaded('workshop')
  })

  it('hard-reloads tyre storage with German copy, not raw inventory keys', async () => {
    vi.mocked(useTyreSets).mockReturnValue({ data: { data: [], meta: { pageCount: 1 } }, isLoading: false } as never)
    vi.mocked(useDueTyreSets).mockReturnValue({ data: { data: [] }, isLoading: false } as never)
    vi.mocked(useLocations).mockReturnValue({ data: [] } as never)

    renderWithProviders(
      <MemoryRouter initialEntries={['/workshop/tyre-storage']}>
        <Routes>
          <Route element={<LazyNamespaceLayout namespaces={['inventory']} />}>
            <Route path="/workshop/tyre-storage" element={<TyreStorageListPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(document.body.textContent).not.toMatch(/tyreStorage\./)
    expect(await screen.findByText(deInventory.tyreStorage.list.title)).toBeInTheDocument()
  })

  it('first-visits KPI reports with German copy and a pre-selected site name', async () => {
    vi.mocked(useMySites).mockReturnValue({ data: [{ id: 'site-1', name: 'Wien' }] } as never)
    vi.mocked(useAuthSession).mockReturnValue({ data: { activeSiteId: 'site-1', activeRole: 'ADMIN' } } as never)
    vi.mocked(useWorkshopKpiReport).mockReturnValue({ isLoading: false, isError: false, data: undefined } as never)

    renderWithProviders(
      <MemoryRouter>
        <Routes>
          <Route element={<LazyNamespaceLayout namespaces={['reports']} />}>
            <Route path="/" element={<WorkshopKpiReportsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(document.body.textContent).not.toMatch(/workshopKpi\./)
    expect(await screen.findByText(deReports.workshopKpi.pageTitle)).toBeInTheDocument()
    expect(screen.getByText('Wien')).toBeInTheDocument()
  })

  it('first-visits notification settings with German copy, not raw settings keys', async () => {
    vi.mocked(useAuthSession).mockReturnValue({
      data: { activeRole: 'ADMIN', user: { email: 'admin@example.com' } },
      isLoading: false,
    } as never)

    renderWithProviders(
      <MemoryRouter initialEntries={['/settings?tab=notifications']}>
        <Routes>
          <Route element={<LazyNamespaceLayout namespaces={['settings']} />}>
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(document.body.textContent).not.toMatch(/\bpage\.title\b/)
    expect(await screen.findByText(deSettings.page.title)).toBeInTheDocument()
    expect(screen.getAllByText(deSettings.tabs.notifications).length).toBeGreaterThan(0)
  })

  it('first-visits vehicle stock and purchase bills in English with translated titles', async () => {
    await changeUiLanguage('en')
    stripLazyNamespacesForTest()

    vi.mocked(useVehicleStockListState).mockReturnValue({
      rows: [],
      tableProps: { pageCount: 1 },
    } as never)
    vi.mocked(purchaseApi.usePurchaseInvoices).mockReturnValue({ data: [], isLoading: false } as never)
    vi.mocked(purchaseApi.useDeletePurchaseInvoice).mockReturnValue({ mutateAsync: vi.fn() } as never)

    const { unmount: unmountStock } = renderWithProviders(
      <MemoryRouter>
        <Routes>
          <Route element={<LazyNamespaceLayout namespaces={['vehicleStock']} />}>
            <Route path="/" element={<VehicleStockList />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(document.body.textContent).not.toMatch(/stockList\./)
    expect(await screen.findByText('Vehicle Stock')).toBeInTheDocument()
    unmountStock()
    cleanup()
    stripLazyNamespacesForTest()

    renderWithProviders(
      <MemoryRouter>
        <Routes>
          <Route element={<LazyNamespaceLayout namespaces={['finance']} />}>
            <Route path="/" element={<PurchaseBillsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(document.body.textContent).not.toMatch(/purchaseBills\./)
    expect(await screen.findByText('Purchase bills')).toBeInTheDocument()
  })

  it('shows German customer search placeholder after the customers bundle loads', async () => {
    vi.mocked(customersApi.useCustomers).mockReturnValue({
      data: { data: [] },
      isLoading: false,
    } as never)

    renderWithProviders(<CustomerSearch value={null} onChange={vi.fn()} />)

    expect(document.body.textContent).not.toMatch(/search\.selectPlaceholder/)
    expect(await screen.findByText(deCustomers.search.selectPlaceholder)).toBeInTheDocument()
  })

  it('tyre set detail shows German workshop copy after the workshop bundle loads', async () => {
    vi.mocked(useAuthSession).mockReturnValue({ data: { activeRole: 'ADMIN' } } as never)
    vi.mocked(useTyreSet).mockReturnValue({
      data: {
        id: 'set-1',
        customerId: 'customer-1',
        vehicleId: 'vehicle-1',
        siteId: 'site-1',
        locationId: 'rack-1',
        label: 'Winter',
        season: 'WINTER',
        tyreCount: 4,
        rimType: 'NONE',
        status: 'IN_STORAGE',
        dotCodes: [],
        events: [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never)

    renderWithProviders(
      <MemoryRouter initialEntries={['/workshop/tyre-storage/set-1']}>
        <Routes>
          <Route path="/workshop/tyre-storage/:id" element={<TyreSetDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(document.body.textContent).not.toMatch(/tyreReport\./)
    expect(await screen.findByText(deWorkshop.tyreReport.empty)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: deWorkshop.tyreReport.record })).toBeInTheDocument()
  })

  it('embeds tyre summary and fiscal-off copy only after the finance/inventory bundle loads', async () => {
    vi.mocked(useTyreSetsByVehicle).mockReturnValue({
      data: { data: [] },
      isLoading: true,
    } as never)
    vi.mocked(useInvoiceSettlement).mockReturnValue({
      data: { rksvMode: 'OFF', payment: null },
      isLoading: false,
    } as never)

    const { container: tyreContainer } = render(
      <LazyNamespaceContentGate namespaces={['inventory']}>
        <TyreSetsSummary vehicleId="veh-1" />
      </LazyNamespaceContentGate>,
    )
    expect(tyreContainer.textContent).not.toMatch(/tyreStorage\.summary/)
    await screen.findByText(deInventory.tyreStorage.summary.loading)
    expect(screen.queryByText('Laden…')).not.toBeInTheDocument()
    cleanup()

    render(<InvoiceSettlementActions invoiceId="inv-1" invoiceStatus="ISSUED" canManage />)
    expect(document.body.textContent).not.toMatch(/settlement\.fiscalOff/)
    expect(await screen.findByText(deFinance.settlement.fiscalOff)).toBeInTheDocument()
  })

  describe('lazy namespace chunk load failure', () => {
    let loadSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      loadSpy = vi.spyOn(initI18n, 'ensureNamespaceLoaded').mockRejectedValue(new Error('chunk failed'))
    })

    afterEach(() => {
      loadSpy.mockRestore()
    })

    async function expectBundleFailureUi() {
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(deCommon.localeBundle.loadFailed)
      expect(screen.getByRole('button', { name: deCommon.localeBundle.retry })).toBeInTheDocument()
    }

    it('LazyNamespaceLayout surfaces bundle failure and retry', async () => {
      renderWithProviders(
        <MemoryRouter>
          <Routes>
            <Route element={<LazyNamespaceLayout namespaces={['inventory']} />}>
              <Route path="/" element={<span>ready child</span>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      )
      await expectBundleFailureUi()
      expect(screen.queryByText('ready child')).not.toBeInTheDocument()
    })

    it('LazyNamespaceContentGate surfaces bundle failure and retry', async () => {
      render(
        <LazyNamespaceContentGate namespaces={['customers']}>
          <span>gated child</span>
        </LazyNamespaceContentGate>,
      )
      await expectBundleFailureUi()
      expect(screen.queryByText('gated child')).not.toBeInTheDocument()
    })

    it('FinanceLocaleGate surfaces bundle failure and retry', async () => {
      render(
        <FinanceLocaleGate>
          <span>finance child</span>
        </FinanceLocaleGate>,
      )
      await expectBundleFailureUi()
      expect(screen.queryByText('finance child')).not.toBeInTheDocument()
    })

    it('TyreSetDetailPage surfaces inventory bundle failure and retry', async () => {
      vi.mocked(useAuthSession).mockReturnValue({ data: { activeRole: 'ADMIN' } } as never)
      vi.mocked(useTyreSet).mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        refetch: vi.fn(),
      } as never)

      renderWithProviders(
        <MemoryRouter initialEntries={['/workshop/tyre-storage/set-1']}>
          <Routes>
            <Route path="/workshop/tyre-storage/:id" element={<TyreSetDetailPage />} />
          </Routes>
        </MemoryRouter>,
      )
      await expectBundleFailureUi()
    })
  })
})
