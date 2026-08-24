import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { AppSidebar } from '@/components/navigation/AppSidebar'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import HrLayout from './HrLayout'

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

    expect(screen.getByRole('heading', { name: 'HR' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Employees' })).toHaveAttribute('href', '/hr/employees')
    expect(screen.getByRole('link', { name: 'Time Clock' })).toHaveAttribute('href', '/hr/clock')
    expect(screen.getByRole('link', { name: 'Leave' })).toHaveAttribute('href', '/hr/leave')
    expect(screen.getByRole('link', { name: 'Employees' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Time Clock' })).not.toHaveAttribute('aria-current', 'page')
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
    collapsed: false,
    isSwitchingTenant: false,
    onToggleCollapsed: () => undefined,
    onOpenSearch: () => undefined,
    onSwitchTenant: () => undefined,
    onSignOut: () => undefined,
  }

  it('exposes one active HR sidebar link in the office shell', () => {
    render(
      <SavedViewsProvider userKey='test-user'>
        <MemoryRouter initialEntries={['/hr']}>
          <AppSidebar {...sidebarProps} activeRole='ADMIN' />
        </MemoryRouter>
      </SavedViewsProvider>,
    )

    const hrLinks = screen.getAllByRole('link', { name: 'HR' })
    expect(hrLinks).toHaveLength(1)
    expect(hrLinks[0]).toHaveAttribute('href', '/hr/employees')
    expect(hrLinks[0]).toHaveClass('bg-slate-800', 'text-white')
  })

  it.each(['/hr/employees', '/hr/clock', '/hr/leave'])(
    'marks HR as the current sidebar link on %s',
    (initialPath) => {
      render(
        <SavedViewsProvider userKey='test-user'>
          <MemoryRouter initialEntries={[initialPath]}>
            <AppSidebar {...sidebarProps} activeRole='ADMIN' />
          </MemoryRouter>
        </SavedViewsProvider>,
      )

      const hrLink = screen.getByRole('link', { name: 'HR' })
      expect(hrLink).toHaveAttribute('aria-current', 'page')
      expect(hrLink).toHaveClass('bg-slate-800', 'text-white')
    },
  )

  it.each(['/hr', '/hr/clock', '/hr/leave'])('does not expose HR navigation to TECH on %s', (initialPath) => {
    render(
      <SavedViewsProvider userKey='test-user-tech'>
        <MemoryRouter initialEntries={[initialPath]}>
          <AppSidebar {...sidebarProps} activeRole='TECH' />
        </MemoryRouter>
      </SavedViewsProvider>,
    )

    expect(screen.queryByRole('link', { name: 'HR' })).not.toBeInTheDocument()
  })
})
