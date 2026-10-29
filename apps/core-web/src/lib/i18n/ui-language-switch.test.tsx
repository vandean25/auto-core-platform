import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as inventoryApi from '@/api/inventory'
import * as locationsApi from '@/api/locations'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/navigation/AppSidebar'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { i18n } from '@/lib/i18n'
import InventoryList from '@/pages/InventoryList'

vi.mock('@/api/inventory')
vi.mock('@/api/locations', () => ({ useLocations: vi.fn() }))

const asMock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>

/**
 * AUT-718: the whole visible UI must follow the UI language switch, not only the tab title.
 * The harness mounts the real sidebar (with the account menu that switches the language) next to a
 * real page whose bundle is loaded lazily, so the assertions cover both render paths.
 */
function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/inventory']}>
        <SavedViewsProvider userKey="test-user">
          <DashboardWidgetsProvider userKey="test-user">
            <SidebarProvider>
              <AppSidebar
                userEmail="admin@example.com"
                platformRole={null}
                activeTenant={{
                  id: 'tenant-1',
                  name: 'Test Tenant',
                  currency: 'EUR',
                  country: 'AT',
                  language: 'de',
                } as never}
                activeRole="ADMIN"
                memberships={[]}
                activeSiteId="site-1"
                sites={[{ id: 'site-1', name: 'Wien' } as never]}
                isLoadingSites={false}
                isSwitchingTenant={false}
                isSwitchingSite={false}
                onOpenSearch={() => {}}
                onSwitchTenant={() => {}}
                onSwitchSite={() => {}}
                onSignOut={() => {}}
              />
              <InventoryList />
            </SidebarProvider>
          </DashboardWidgetsProvider>
        </SavedViewsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function switchTo(language: 'de' | 'en') {
  fireEvent.keyDown(screen.getByRole('button', { name: 'admin@example.com' }), { key: 'Enter' })
  fireEvent.click(await screen.findByTestId(`language-option-${language}`))
  await waitFor(() => expect(i18n.language).toBe(language))
  // The menu stays open during the switch, and an open menu hides the page from the a11y tree.
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
}

beforeEach(() => {
  vi.clearAllMocks()
  asMock(inventoryApi.useInventory).mockReturnValue({
    data: {
      data: [
        {
          id: 'item-1',
          sku: 'BRK-001',
          name: 'Brake Pad',
          brand: 'Bosch',
          price: 49.9,
          status: 'IN_STOCK',
          quantity_available: 4,
          warehouse_location: 'A-1',
        },
      ],
      meta: { total: 1, page: 1, limit: 10, pageCount: 1 },
    },
    isLoading: false,
  })
  asMock(locationsApi.useLocations).mockReturnValue({
    data: [{ id: 'loc-1', name: 'A-1', code: 'A-1', type: 'warehouse' }],
    isLoading: false,
  })
  asMock(inventoryApi.useCreateInventoryItem).mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  })
})

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('de')
})

describe('UI language switch (AUT-718)', () => {
  it('re-renders sidebar, page heading and button in English without a reload', async () => {
    renderShell()

    await screen.findByRole('heading', { name: 'Lager' })
    expect(screen.getByText('Teile und Bestände verwalten.')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Hauptnavigation' })).getByRole('link', { name: 'Kunden' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Artikel/ })).toBeInTheDocument()

    await switchTo('en')

    await screen.findByRole('heading', { name: 'Inventory' })
    expect(screen.getByText('Manage your automotive parts and stock levels.')).toBeInTheDocument()
    const englishNav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(englishNav).getByRole('link', { name: 'Customers' })).toBeInTheDocument()
    expect(within(englishNav).queryByRole('link', { name: 'Kunden' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Item/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open search' })).toBeInTheDocument()

    await switchTo('de')

    await screen.findByRole('heading', { name: 'Lager' })
    expect(screen.getByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Hauptnavigation' })).getByRole('link', { name: 'Kunden' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Artikel/ })).toBeInTheDocument()
  })
})
