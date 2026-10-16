import { cleanup, render, screen, within } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
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

function renderSidebar({ collapsed = false } = {}) {
  return render(
    <SavedViewsProvider userKey="test-user">
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppSidebar {...sidebarProps} collapsed={collapsed} />
      </MemoryRouter>
    </SavedViewsProvider>,
  )
}

describe('AppSidebar Help / Docs link', () => {
  it('opens the documentation in a new tab with safe rel attributes', () => {
    renderSidebar()

    const link = screen.getByRole('link', { name: 'Hilfe / Dokumentation' })
    expect(link).toHaveAttribute('href', 'https://autocore-platform.mintlify.site/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
  })

  it('tells assistive tech that the link opens in a new tab', () => {
    renderSidebar()

    expect(screen.getByRole('link', { name: 'Hilfe / Dokumentation' })).toHaveAccessibleDescription(
      /neuem Tab/i,
    )
  })

  it('keeps its accessible name when the sidebar is collapsed', () => {
    renderSidebar({ collapsed: true })

    const link = screen.getByRole('link', { name: 'Hilfe / Dokumentation' })
    expect(link).toHaveAttribute('href', 'https://autocore-platform.mintlify.site/')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('sits in the footer, outside the core modules navigation', () => {
    renderSidebar()

    const coreModules = screen.getByRole('navigation', { name: 'Kernmodule' })
    expect(within(coreModules).queryByRole('link', { name: 'Hilfe / Dokumentation' })).not.toBeInTheDocument()
  })

  it('has no accessibility violations', async () => {
    const { container } = renderSidebar()

    const { violations } = await axe.run(container)

    expect(violations).toEqual([])
  })
})
