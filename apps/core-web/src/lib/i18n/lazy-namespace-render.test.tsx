import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuthSession } from '@/api/auth-session'
import { useMySites } from '@/api/sites'
import { useWorkshopKpiReport } from '@/api/workshop-kpi-reports'
import { WorkshopKpiDashboardWidget } from '@/components/workshop/WorkshopKpiDashboardWidget'
import MechanicAccessDeniedPage from '@/pages/mechanic/MechanicAccessDeniedPage'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { stripLazyNamespacesForTest } from '@/test/lazy-namespace-test-helpers'

vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({ useMySites: vi.fn() }))
vi.mock('@/api/workshop-kpi-reports', () => ({ useWorkshopKpiReport: vi.fn() }))

afterEach(() => {
  cleanup()
})

describe('lazy namespace render guard (production-like i18n)', () => {
  afterEach(async () => {
    await ensureNamespaceLoaded('workshop')
  })

  it('WorkshopKpiDashboardWidget shows German KPI copy, not raw keys', async () => {
    stripLazyNamespacesForTest()
    vi.mocked(useAuthSession).mockReturnValue({ data: { activeSiteId: 'site-1', activeRole: 'ADMIN' } } as never)
    vi.mocked(useMySites).mockReturnValue({ data: [{ id: 'site-1', name: 'Wien' }] } as never)
    vi.mocked(useWorkshopKpiReport).mockReturnValue({ isLoading: false, data: undefined } as never)

    render(
      <MemoryRouter>
        <WorkshopKpiDashboardWidget />
      </MemoryRouter>,
    )

    expect(document.body.textContent).not.toMatch(/\bkpi\./)
    await screen.findByText('Werkstatt diesen Monat')
    expect(screen.getByText('Zum Workshop-Bericht')).toBeInTheDocument()
  })

  it('MechanicAccessDeniedPage shows German copy, not raw keys', async () => {
    stripLazyNamespacesForTest()

    render(
      <MemoryRouter>
        <MechanicAccessDeniedPage />
      </MemoryRouter>,
    )

    expect(document.body.textContent).not.toMatch(/mechanic\.accessDenied\./)
    await screen.findByRole('heading', { name: 'Bürozugang eingeschränkt' })
    expect(screen.getByRole('link', { name: 'Zur Mechaniker-Warteschlange' })).toBeInTheDocument()
  })
})
