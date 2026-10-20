import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { AppSidebar } from '@/components/navigation/AppSidebar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import deHr from '../../../../../locales/de/hr.json'
import { registerGermanUiForTests } from '@/test/german-ui'
import HrLayout from './HrLayout'

registerGermanUiForTests()

afterEach(cleanup)

function LocationProbe() {
  const location = useLocation()
  return <output data-testid='location'>{location.pathname}</output>
}

function renderHrRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path='/hr' element={<HrLayout />}>
          <Route index element={<Navigate to='employees' replace />} />
          <Route path='employees' element={<div>Employees route content</div>} />
          <Route path='clock' element={<div>Clock route content</div>} />
          <Route path='leave' element={<div>Leave route content</div>} />
        </Route>
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('HrLayout', () => {
  it('renders HR tabs with their route targets and nested content', () => {
    renderHrRoutes('/hr/employees')

    expect(screen.getByRole('heading', { name: deHr.layout.title })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: deHr.layout.sectionsAria })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: deHr.layout.tabs.employees })).toHaveAttribute('href', '/hr/employees')
    expect(screen.getByRole('link', { name: deHr.layout.tabs.clock })).toHaveAttribute('href', '/hr/clock')
    expect(screen.getByRole('link', { name: deHr.layout.tabs.leave })).toHaveAttribute('href', '/hr/leave')
    expect(screen.getByRole('link', { name: deHr.layout.tabs.employees })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: deHr.layout.tabs.clock })).not.toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Employees route content')).toBeInTheDocument()
  })

  it('redirects the HR index to employees', () => {
    renderHrRoutes('/hr')

    expect(screen.getByTestId('location')).toHaveTextContent('/hr/employees')
    expect(screen.getByText('Employees route content')).toBeInTheDocument()
  })
})

describe('HR navigation visibility', () => {
  const sidebarProps = {
    userEmail: 'admin@example.com',
    platformRole: null,
    activeTenant: null,
    memberships: [],
    activeSiteId: null,
    sites: [],
    isLoadingSites: false,
    isSwitchingTenant: false,
    isSwitchingSite: false,
    onOpenSearch: () => undefined,
    onSwitchTenant: () => undefined,
    onSwitchSite: () => undefined,
    onSignOut: () => undefined,
  }

  function renderSidebar(path: string, activeRole: 'ADMIN' | 'TECH') {
    return render(
      <SavedViewsProvider userKey={`test-user-${activeRole}`}>
        <MemoryRouter initialEntries={[path]}>
          <SidebarProvider>
            <AppSidebar {...sidebarProps} activeRole={activeRole} />
          </SidebarProvider>
        </MemoryRouter>
      </SavedViewsProvider>,
    )
  }

  it('exposes one active HR sidebar link in the office shell', () => {
    renderSidebar('/hr', 'ADMIN')

    const hrLinks = screen.getAllByRole('link', { name: 'Personal' })
    expect(hrLinks).toHaveLength(1)
    expect(hrLinks[0]).toHaveAttribute('href', '/hr/employees')
    expect(hrLinks[0]).toHaveAttribute('data-active', 'true')
  })

  it.each(['/hr/employees', '/hr/clock', '/hr/leave'])(
    'marks HR as the current sidebar link on %s',
    (initialPath) => {
      renderSidebar(initialPath, 'ADMIN')

      const hrLink = screen.getByRole('link', { name: 'Personal' })
      expect(hrLink).toHaveAttribute('aria-current', 'page')
      expect(hrLink).toHaveAttribute('data-active', 'true')
    },
  )

  it.each(['/hr', '/hr/clock', '/hr/leave'])('does not expose HR navigation to TECH on %s', (initialPath) => {
    renderSidebar(initialPath, 'TECH')

    expect(screen.queryByRole('link', { name: 'Personal' })).not.toBeInTheDocument()
  })
})
