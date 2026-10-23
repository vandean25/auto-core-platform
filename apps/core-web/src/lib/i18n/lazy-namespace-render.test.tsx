import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuthSession } from '@/api/auth-session'
import { useMySites } from '@/api/sites'
import { useWorkshopKpiReport } from '@/api/workshop-kpi-reports'
import { WorkshopKpiDashboardWidget } from '@/components/workshop/WorkshopKpiDashboardWidget'
import MechanicAccessDeniedPage from '@/pages/mechanic/MechanicAccessDeniedPage'
import { changeUiLanguage, ensureNamespaceLoaded } from '@/lib/i18n'
import { stripLazyNamespacesForTest } from '@/test/lazy-namespace-test-helpers'

vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/sites', () => ({ useMySites: vi.fn() }))
vi.mock('@/api/workshop-kpi-reports', () => ({ useWorkshopKpiReport: vi.fn() }))

afterEach(() => {
  cleanup()
})

describe('lazy namespace gates (production-like i18n)', () => {
  afterEach(async () => {
    await changeUiLanguage('de')
    await ensureNamespaceLoaded('workshop')
  })

  describe('WorkshopKpiDashboardWidget', () => {
    beforeEach(() => {
      stripLazyNamespacesForTest()
      vi.mocked(useAuthSession).mockReturnValue({ data: { activeSiteId: 'site-1', activeRole: 'ADMIN' } } as never)
      vi.mocked(useMySites).mockReturnValue({ data: [{ id: 'site-1', name: 'Wien' }] } as never)
      vi.mocked(useWorkshopKpiReport).mockReturnValue({ isLoading: false, data: undefined } as never)
    })

    it('renders German KPI copy, not raw keys', async () => {
      render(
        <MemoryRouter>
          <WorkshopKpiDashboardWidget />
        </MemoryRouter>,
      )

      expect(document.body.textContent).not.toMatch(/\bkpi\./)
      await screen.findByText('Werkstatt diesen Monat')
      expect(screen.getByText('Zum Workshop-Bericht')).toBeInTheDocument()
    })

    it('renders English KPI copy, not raw keys', async () => {
      await changeUiLanguage('en')

      render(
        <MemoryRouter>
          <WorkshopKpiDashboardWidget />
        </MemoryRouter>,
      )

      expect(document.body.textContent).not.toMatch(/\bkpi\./)
      await screen.findByText('Workshop this month')
      expect(screen.getByText('Open workshop report')).toBeInTheDocument()
    })
  })

  describe('MechanicAccessDeniedPage', () => {
    beforeEach(() => {
      stripLazyNamespacesForTest()
    })

    it('renders German copy, not raw keys', async () => {
      render(
        <MemoryRouter>
          <MechanicAccessDeniedPage />
        </MemoryRouter>,
      )

      expect(document.body.textContent).not.toMatch(/mechanic\.accessDenied\./)
      await screen.findByRole('heading', { name: 'Bürozugang eingeschränkt' })
      expect(screen.getByRole('link', { name: 'Zur Mechaniker-Warteschlange' })).toBeInTheDocument()
    })

    it('renders English copy, not raw keys', async () => {
      await changeUiLanguage('en')

      render(
        <MemoryRouter>
          <MechanicAccessDeniedPage />
        </MemoryRouter>,
      )

      expect(document.body.textContent).not.toMatch(/mechanic\.accessDenied\./)
      await screen.findByRole('heading', { name: 'Office access restricted' })
      expect(screen.getByRole('link', { name: 'Go to mechanic queue' })).toBeInTheDocument()
    })
  })
})
