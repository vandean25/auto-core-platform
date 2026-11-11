import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as vehicleStockApi from '@/api/vehicle-stock'
import * as vehiclesApi from '@/api/vehicles'
import { AgedStockDashboardWidget } from '@/components/vehicles/AgedStockDashboardWidget'
import { PickerlDueDashboardWidget } from '@/components/vehicles/PickerlDueDashboardWidget'
import { WorkshopKpiDashboardWidget } from '@/components/workshop/WorkshopKpiDashboardWidget'
import { useAuthSession } from '@/api/auth-session'
import { useMySites } from '@/api/sites'
import { useWorkshopKpiReport } from '@/api/workshop-kpi-reports'

vi.mock('@/api/vehicle-stock')
vi.mock('@/api/vehicles')
vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({ useMySites: vi.fn() }))
vi.mock('@/api/workshop-kpi-reports', () => ({ useWorkshopKpiReport: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ useLazyNamespaceBundleReady: () => ({ status: 'ready' as const }) }))

/** Reverting to `isLoading ? skeleton` would fail these: payload is shown even when a stale `isLoading` flag stays true. */
describe('AUT-971 dashboard widgets (stale isLoading)', () => {
  it.each([
    {
      name: 'Pickerl scenario 5',
      setup: () => {
        vi.mocked(vehiclesApi.usePickerlDueList).mockReturnValue({
          data: { meta: { total: 2 } },
          isPending: false,
          isFetching: false,
          isLoading: true,
        } as unknown as ReturnType<typeof vehiclesApi.usePickerlDueList>)
      },
      renderUi: () =>
        render(
          <MemoryRouter>
            <PickerlDueDashboardWidget window={30} />
          </MemoryRouter>,
        ),
      assertContent: () => {
        expect(screen.getByText('2')).toBeInTheDocument()
      },
    },
    {
      name: 'aged stock',
      setup: () => {
        vi.mocked(vehicleStockApi.useVehicleStockAgeReport).mockReturnValue({
          data: { summary: { over_90_count: 5, over_90_cost_basis: '1000.00' } },
          isPending: false,
          isFetching: false,
          isLoading: true,
        } as unknown as ReturnType<typeof vehicleStockApi.useVehicleStockAgeReport>)
      },
      renderUi: () =>
        render(
          <QueryClientProvider client={new QueryClient()}>
            <MemoryRouter>
              <AgedStockDashboardWidget />
            </MemoryRouter>
          </QueryClientProvider>,
        ),
      assertContent: () => {
        expect(screen.getByText('5')).toBeInTheDocument()
      },
    },
    {
      name: 'workshop KPI',
      setup: () => {
        vi.mocked(useAuthSession).mockReturnValue({ data: { activeSiteId: 'site-1', activeRole: 'ADMIN' } } as never)
        vi.mocked(useMySites).mockReturnValue({ data: [{ id: 'site-1', name: 'Wien' }] } as never)
        vi.mocked(useWorkshopKpiReport).mockReturnValue({
          data: { totals: { utilisation_percent: '0.82', productivity_percent: '0.71' } },
          isPending: false,
          isFetching: false,
          isLoading: true,
        } as never)
      },
      renderUi: () =>
        render(
          <MemoryRouter>
            <WorkshopKpiDashboardWidget />
          </MemoryRouter>,
        ),
      assertContent: () => {
        expect(screen.getAllByText(/0,8 %/).length).toBeGreaterThan(0)
      },
    },
  ])('WHEN $name has payload but stale isLoading THEN skeleton is not shown', ({ setup, renderUi, assertContent }) => {
    setup()
    const { container } = renderUi()
    assertContent()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })
})
