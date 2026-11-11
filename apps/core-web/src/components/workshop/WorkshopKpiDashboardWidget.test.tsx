import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuthSession } from '@/api/auth-session'
import { useMySites } from '@/api/sites'
import { useWorkshopKpiReport } from '@/api/workshop-kpi-reports'
import { WorkshopKpiDashboardWidget } from './WorkshopKpiDashboardWidget'

vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({ useMySites: vi.fn() }))
vi.mock('@/api/workshop-kpi-reports', () => ({ useWorkshopKpiReport: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ useLazyNamespaceBundleReady: () => ({ status: 'ready' as const }) }))

afterEach(cleanup)

describe('WorkshopKpiDashboardWidget', () => {
  it('AUT-971: WHEN KPI data is present while query is paused THEN skeleton is not shown (legacy isLoading=isPending would)', () => {
    vi.mocked(useAuthSession).mockReturnValue({ data: { activeSiteId: 'site-1', activeRole: 'ADMIN' } } as never)
    vi.mocked(useMySites).mockReturnValue({ data: [{ id: 'site-1', name: 'Wien' }] } as never)
    vi.mocked(useWorkshopKpiReport).mockReturnValue({
      data: { totals: { utilisation_percent: '0.82', productivity_percent: '0.71' }, rows: [] },
      isPending: true,
      isFetching: false,
      isLoading: true,
    } as never)

    const { container } = render(
      <MemoryRouter>
        <WorkshopKpiDashboardWidget />
      </MemoryRouter>,
    )

    expect(container.querySelector('.animate-pulse')).toBeNull()
    expect(screen.getAllByText(/0,8/).length).toBeGreaterThan(0)
  })

  it('AUT-971: WHEN KPI query is paused pending without data THEN skeleton is not shown', () => {
    vi.mocked(useAuthSession).mockReturnValue({ data: { activeSiteId: 'site-1', activeRole: 'ADMIN' } } as never)
    vi.mocked(useMySites).mockReturnValue({ data: [{ id: 'site-1', name: 'Wien' }] } as never)
    vi.mocked(useWorkshopKpiReport).mockReturnValue({
      data: undefined,
      isPending: true,
      isFetching: false,
    } as never)

    const { container } = render(<MemoryRouter><WorkshopKpiDashboardWidget /></MemoryRouter>)

    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('renders a safe empty state when there are no report rows', () => {
    vi.mocked(useAuthSession).mockReturnValue({ data: { activeSiteId: 'site-1', activeRole: 'ADMIN' } } as never)
    vi.mocked(useMySites).mockReturnValue({ data: [{ id: 'site-1', name: 'Wien' }] } as never)
    vi.mocked(useWorkshopKpiReport).mockReturnValue({ isLoading: false, data: undefined } as never)

    render(<MemoryRouter><WorkshopKpiDashboardWidget /></MemoryRouter>)

    expect(screen.getByText('Noch keine Workshop-Daten für diesen Monat.')).toBeInTheDocument()
    expect(screen.getByText('Zum Workshop-Bericht')).toBeInTheDocument()
  })

  it('does not request or show workshop KPIs for roles without report access', () => {
    vi.mocked(useAuthSession).mockReturnValue({ data: { activeSiteId: 'site-1', activeRole: 'TECH' } } as never)
    vi.mocked(useMySites).mockReturnValue({ data: [{ id: 'site-1', name: 'Wien' }] } as never)
    vi.mocked(useWorkshopKpiReport).mockReturnValue({ isLoading: false, data: undefined } as never)

    render(<MemoryRouter><WorkshopKpiDashboardWidget /></MemoryRouter>)

    expect(screen.queryAllByText('Workshop diesen Monat')).toHaveLength(0)
    expect(useWorkshopKpiReport).toHaveBeenCalledWith(expect.anything(), false)
  })
})
