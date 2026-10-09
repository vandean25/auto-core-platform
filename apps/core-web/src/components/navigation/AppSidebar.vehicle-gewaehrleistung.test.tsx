import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppSidebar } from './AppSidebar'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'

afterEach(cleanup)

const sidebarProps = {
  userEmail: 'admin@example.com',
  platformRole: null,
  activeTenant: null,
  memberships: [],
  activeSiteId: null,
  sites: [],
  isLoadingSites: false,
  collapsed: false,
  isSwitchingTenant: false,
  isSwitchingSite: false,
  onToggleCollapsed: () => undefined,
  onOpenSearch: () => undefined,
  onSwitchTenant: () => undefined,
  onSwitchSite: () => undefined,
  onSignOut: () => undefined,
  activeRole: 'ADMIN' as const,
}

describe('AppSidebar Gewaehrleistung navigation', () => {
  it('shows the due-list entry and marks it active without activating Vehicles', () => {
    render(
      <SavedViewsProvider userKey="test-user">
        <MemoryRouter initialEntries={['/vehicles/gewaehrleistung-due']}>
          <AppSidebar {...sidebarProps} />
        </MemoryRouter>
      </SavedViewsProvider>,
    )

    const dueListLink = screen.getByRole('link', { name: 'Gewährleistung fällig' })
    expect(dueListLink).toHaveAttribute('href', '/vehicles/gewaehrleistung-due')
    expect(dueListLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Vehicles' })).not.toHaveAttribute('aria-current', 'page')
  })
})
