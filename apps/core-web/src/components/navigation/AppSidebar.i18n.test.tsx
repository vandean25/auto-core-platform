import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { changeUiLanguage } from '@/lib/i18n'
import { useGermanUiInTests } from '@/test/german-ui'
import { AppSidebar } from './AppSidebar'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'

afterEach(cleanup)

useGermanUiInTests()

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

function renderSidebar() {
  return render(
    <SavedViewsProvider userKey="test-user">
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppSidebar {...sidebarProps} />
      </MemoryRouter>
    </SavedViewsProvider>,
  )
}

describe('AppSidebar i18n', () => {
  it('renders DE shell copy by default and switches to EN without reload', async () => {
    renderSidebar()
    expect(screen.getByRole('navigation', { name: /Kernmodule/i })).toBeInTheDocument()

    await changeUiLanguage('en')
    expect(screen.getByRole('navigation', { name: /Core modules/i })).toBeInTheDocument()
  })
})
