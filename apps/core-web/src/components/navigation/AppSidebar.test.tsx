import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { DOCUMENTATION_URL } from '@/lib/external-links'
import { changeUiLanguage } from '@/lib/i18n'
import { registerGermanUiForTests } from '@/test/german-ui'
import { AppSidebar } from './AppSidebar'

registerGermanUiForTests()

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(cleanup)

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
  activeRole: 'ADMIN' as const,
}

function renderSidebar(path = '/dashboard') {
  return render(
    <SavedViewsProvider userKey="test-user">
      <MemoryRouter initialEntries={[path]}>
        <SidebarProvider>
          <AppSidebar {...sidebarProps} />
        </SidebarProvider>
      </MemoryRouter>
    </SavedViewsProvider>,
  )
}

function mainNavigation() {
  return screen.getByRole('navigation', { name: 'Hauptnavigation' })
}

function openAccountMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'admin@example.com' }), { key: 'Enter' })
}

describe('AppSidebar navigation', () => {
  it('groups the entries under labelled sections that start open', () => {
    renderSidebar()

    for (const label of ['Übersicht', 'Verkauf', 'Werkstatt', 'Fahrzeuge', 'Lager & Einkauf', 'Finanzen', 'Verwaltung']) {
      expect(within(mainNavigation()).getByRole('button', { name: label })).toHaveAttribute('aria-expanded', 'true')
    }
  })

  it('lists Invoices directly after Sales Orders', () => {
    renderSidebar()

    const labels = within(mainNavigation())
      .getAllByRole('link')
      .map((link) => link.textContent)
    const salesOrdersIndex = labels.indexOf('Kundenaufträge')

    expect(salesOrdersIndex).toBeGreaterThanOrEqual(0)
    expect(labels[salesOrdersIndex + 1]).toBe('Rechnungen')
  })

  it('links Invoices to the invoice list and marks it current on that list', () => {
    renderSidebar('/sales/invoices')

    const invoicesLink = screen.getByRole('link', { name: 'Rechnungen' })
    expect(invoicesLink).toHaveAttribute('href', '/sales/invoices')
    expect(invoicesLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Kundenaufträge' })).not.toHaveAttribute('aria-current', 'page')
  })

  it('keeps Invoices current on invoice detail pages without activating Sales Orders', () => {
    renderSidebar('/sales/invoices/inv-1')

    expect(screen.getByRole('link', { name: 'Rechnungen' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Kundenaufträge' })).not.toHaveAttribute('aria-current', 'page')
  })

  it('shows the due-list entry as current without activating Vehicles', () => {
    renderSidebar('/vehicles/gewaehrleistung-due')

    const dueListLink = screen.getByRole('link', { name: 'Gewährleistung fällig' })
    expect(dueListLink).toHaveAttribute('href', '/vehicles/gewaehrleistung-due')
    expect(dueListLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Fahrzeuge' })).not.toHaveAttribute('aria-current', 'page')
  })

  it('opens a closed group that holds the current page', () => {
    window.localStorage.setItem('acp:sidebar-groups', '{"sales":false}')
    renderSidebar('/sales-orders/so-1')

    expect(screen.getByRole('button', { name: 'Verkauf' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Kundenaufträge' })).toHaveAttribute('aria-current', 'page')
  })

  it('hides the entries of a group the user closed, and stores the choice', () => {
    renderSidebar()

    fireEvent.click(screen.getByRole('button', { name: 'Verkauf' }))

    expect(screen.getByRole('button', { name: 'Verkauf' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Kundenaufträge' })).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('acp:sidebar-groups') ?? '{}')).toMatchObject({ sales: false })
  })

  it('keeps the help link in the account menu, outside the navigation', () => {
    renderSidebar()
    // An open menu hides the rest of the page from assistive tech, so the navigation is taken first.
    const navigation = mainNavigation()

    openAccountMenu()

    const helpLink = screen.getByRole('menuitem', { name: 'Hilfe / Dokumentation' })
    expect(helpLink).toHaveAttribute('href', DOCUMENTATION_URL)
    expect(helpLink).toHaveAttribute('target', '_blank')
    expect(helpLink.getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    expect(helpLink).toHaveAccessibleDescription(/öffnet in neuem Tab/i)
    expect(navigation.querySelector(`a[href="${DOCUMENTATION_URL}"]`)).toBeNull()
  })

  it('switches the group and navigation labels to English without a reload', async () => {
    renderSidebar()

    await changeUiLanguage('en')

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sales' })).toBeInTheDocument()
  })

  it('has no accessibility violations', async () => {
    const { container } = renderSidebar()

    const { violations } = await axe.run(container)

    expect(violations).toEqual([])
  })
})
