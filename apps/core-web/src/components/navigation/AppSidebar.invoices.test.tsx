import { cleanup, render, screen, within } from '@testing-library/react'
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

function renderSidebar(path: string) {
  return render(
    <SavedViewsProvider userKey="test-user">
      <MemoryRouter initialEntries={[path]}>
        <AppSidebar {...sidebarProps} />
      </MemoryRouter>
    </SavedViewsProvider>,
  )
}

describe('AppSidebar Invoices navigation', () => {
  it('lists Invoices directly after Sales Orders in the core modules nav', () => {
    renderSidebar('/dashboard')

    const coreModules = screen.getByRole('navigation', { name: 'Kernmodule' })
    const labels = within(coreModules)
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

  it('does not mark Invoices current on sales order pages', () => {
    renderSidebar('/sales-orders/so-1')

    expect(screen.getByRole('link', { name: 'Kundenaufträge' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Rechnungen' })).not.toHaveAttribute('aria-current', 'page')
  })
})
