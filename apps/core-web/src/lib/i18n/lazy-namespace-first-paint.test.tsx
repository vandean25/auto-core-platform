import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthSession } from '@/api/auth-session'
import { useMySites } from '@/api/sites'
import { useWorkshopKpiReport } from '@/api/workshop-kpi-reports'
import { useDueTyreSets, useTyreSets } from '@/api/tyre-storage'
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
import { TyreSetsSummary } from '@/features/tyre-storage/TyreSetsSummary'
import { InvoiceSettlementActions } from '@/components/finance/InvoiceSettlementActions'
import { useInvoiceSettlement } from '@/api/useInvoiceSettlement'
import deInventory from '../../../../../locales/de/inventory.json'
import deReports from '../../../../../locales/de/reports.json'
import deSettings from '../../../../../locales/de/settings.json'
import deFinance from '../../../../../locales/de/finance.json'
import { changeUiLanguage, ensureNamespaceLoaded } from '@/lib/i18n'
import { stripLazyNamespacesForTest } from '@/test/lazy-namespace-test-helpers'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'

vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({ useMySites: vi.fn() }))
vi.mock('@/api/workshop-kpi-reports', () => ({ useWorkshopKpiReport: vi.fn() }))
vi.mock('@/api/tyre-storage', () => ({
  useTyreSets: vi.fn(),
  useDueTyreSets: vi.fn(),
  useTyreSetsByVehicle: vi.fn(),
  useTyreSetsByCustomer: vi.fn(),
  useCreateTyreSet: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTyreSet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
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
  })

  afterEach(async () => {
    await changeUiLanguage('de')
    await ensureNamespaceLoaded('inventory')
    await ensureNamespaceLoaded('reports')
    await ensureNamespaceLoaded('settings')
    await ensureNamespaceLoaded('vehicleStock')
    await ensureNamespaceLoaded('finance')
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

  it('embeds tyre summary and fiscal-off copy only after the finance/inventory bundle loads', async () => {
    vi.mocked(useTyreSetsByVehicle).mockReturnValue({
      data: { data: [] },
      isLoading: true,
    } as never)
    vi.mocked(useInvoiceSettlement).mockReturnValue({
      data: { rksvMode: 'OFF', payment: null },
      isLoading: false,
    } as never)

    const { container: tyreContainer } = render(<TyreSetsSummary vehicleId="veh-1" />)
    expect(tyreContainer.textContent).not.toMatch(/tyreStorage\.summary/)
    await screen.findByText('Laden…')
    cleanup()

    render(<InvoiceSettlementActions invoiceId="inv-1" invoiceStatus="ISSUED" canManage />)
    expect(document.body.textContent).not.toMatch(/settlement\.fiscalOff/)
    expect(await screen.findByText(deFinance.settlement.fiscalOff)).toBeInTheDocument()
  })
})
