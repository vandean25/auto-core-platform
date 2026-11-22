import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import { EntityActionConfirmHost } from '@/features/actions/action-confirm-host'
import { SidebarProvider } from '@/components/ui/sidebar'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { DOCUMENTATION_URL } from '@/lib/external-links'
import { changeUiLanguage } from '@/lib/i18n'
import { registerGermanUiForTests } from '@/test/german-ui'
import { AppSidebar } from './AppSidebar'

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchWithAuth: vi.fn(),
}))

const capabilities = vi.hoisted(() => ({ pickerl57a: true }))
vi.mock('@/api/auth-session', async (original) => ({
  ...await original<typeof import('@/api/auth-session')>(),
  useAuthSession: () => ({ data: { effectiveCapabilities: capabilities, activeRole: 'ADMIN' } }),
}))

registerGermanUiForTests()

beforeEach(() => {
  capabilities.pickerl57a = true
  window.localStorage.clear()
  vi.mocked(fetchWithAuth).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
  } as Response)
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

function renderSidebar(path = '/dashboard', tenantId: string | null = null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SavedViewsProvider userKey="test-user" tenantId={tenantId}>
        <MemoryRouter initialEntries={[path]}>
          <SidebarProvider>
            <AppSidebar {...sidebarProps} />
          </SidebarProvider>
          <EntityActionConfirmHost />
        </MemoryRouter>
      </SavedViewsProvider>
    </QueryClientProvider>,
  )
}

function mainNavigation() {
  return screen.getByRole('navigation', { name: 'Hauptnavigation' })
}

function openAccountMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'admin@example.com' }), { key: 'Enter' })
}

describe('AppSidebar navigation', () => {
  it('hides saved Pickerl views when the capability is unavailable', async () => {
    capabilities.pickerl57a = false
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 'p',
            listPath: '/vehicles/pickerl-due',
            name: 'Saved Pickerl view',
            href: '/vehicles/pickerl-due?status=OVERDUE',
            visibility: 'PERSONAL',
            ownerUserId: 'test-user',
            version: 1,
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
          {
            id: 'w',
            listPath: '/workshop/orders',
            name: 'Saved Workshop view',
            href: '/workshop/orders?status=OPEN',
            visibility: 'PERSONAL',
            ownerUserId: 'test-user',
            version: 1,
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
        ],
      }),
    } as Response)
    renderSidebar('/dashboard', 'tenant-a')
    expect(await screen.findByRole('link', { name: 'Saved Workshop view' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Saved Pickerl view' })).not.toBeInTheDocument()
  })

  it('requires confirmation before deleting a team view from the sidebar favorites menu', async () => {
    const deleteCalls: string[] = []
    vi.mocked(fetchWithAuth).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/saved-views') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'team-1',
                listPath: '/workshop/orders',
                name: 'Team Aufträge',
                href: '/workshop/orders?status=OPEN',
                visibility: 'TENANT',
                ownerUserId: 'admin-1',
                version: 1,
                createdAt: '2026-01-01',
                updatedAt: '2026-01-01',
              },
            ],
          }),
        } as Response
      }
      if (url === '/api/saved-views/team-1?version=1' && init?.method === 'DELETE') {
        deleteCalls.push(url)
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`)
    })

    renderSidebar('/dashboard', 'tenant-a')

    expect(await screen.findByRole('link', { name: /Team Aufträge/ })).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Weitere Aktionen' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ansicht entfernen' }))

    expect(deleteCalls).toEqual([])
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Ansicht entfernen?')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Ansicht entfernen' }))

    await vi.waitFor(() => expect(deleteCalls).toEqual(['/api/saved-views/team-1?version=1']))
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })
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
