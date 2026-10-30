/**
 * AUT-99: Verifies that the MechanicShell satisfies the ADR-0014 §8.2 requirements:
 *   - No back-office app switcher or mechanic-selector controls are rendered.
 *   - The stale `acp:mechanic-id` localStorage key is removed on shell mount
 *     so that no client-chosen mechanic identity can persist across upgrades.
 */

import * as React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MechanicShell, ShellRouter } from './App'
import * as mechanicApi from '@/api/mechanic'
import { MECHANIC_ROUTE_PATHS } from '@/lib/app-route-paths'
import deWorkshop from '../../../locales/de/workshop.json'

vi.mock('@/api/mechanic')
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'user-1', email: 'user@workshop.com', getIdToken: vi.fn().mockResolvedValue('token') },
    loading: false,
    signOutUser: vi.fn(),
  }),
}))
vi.mock('@/features/realtime/RealtimeDashboardSyncProvider', () => ({
  RealtimeDashboardSyncProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('./pages/DashboardPage', () => ({
  default: () => <div>Admin dashboard</div>,
}))
vi.mock('./pages/platform/PlatformTenantsPage', () => ({
  default: () => <div>Platform tenants page</div>,
}))
vi.mock('./pages/mechanic/MechanicTyreReportPage', () => ({
  default: () => <h1>Mechanic tyre report</h1>,
}))
vi.mock('./pages/tyre-storage/TyreSetDetailPage', () => ({
  default: () => <h1>Tyre hotel detail</h1>,
}))
vi.mock('./pages/workshop/WorkshopOrderDetails', () => ({
  default: () => <h1>Office work order</h1>,
}))
vi.mock('@/components/GlobalSearch', async () => {
  const { CommandDialog } = await import('@/components/ui/command')
  return {
    GlobalSearch: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
      <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Find a record or action">
        <input aria-label="Search" />
      </CommandDialog>
    ),
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

const asMock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as ReturnType<typeof vi.fn>

function renderShell(
  initialPath = '/mechanic/queue',
  opts: { tenantName?: string; userEmail?: string } = {},
) {
  asMock(mechanicApi.useMechanicQueue).mockReturnValue({
    data: { data: [] },
    isLoading: false,
    refetch: vi.fn(),
  })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/mechanic/*"
            element={
              <MechanicShell
                activeTenant={
                  opts.tenantName
                    ? { id: 'tenant-1', name: opts.tenantName, slug: 'tenant-1' }
                    : null
                }
                userEmail={opts.userEmail ?? 'mechanic@workshop.com'}
                onSignOut={vi.fn()}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('MechanicShell (ADR-0014 §8.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  // ─── No mechanic selector or app switcher ────────────────────────────────

  describe('no mechanic-selector or back-office app-switcher controls', () => {
    it('does not render a mechanic selector dropdown or picker', () => {
      renderShell()

      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
      expect(screen.queryByText(/select mechanic/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/choose mechanic/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/switch mechanic/i)).not.toBeInTheDocument()
    })

    it('does not render a back-office app switcher link', () => {
      renderShell()

      expect(screen.queryByText(/back to admin/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/back-office/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/switch to admin/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/open admin/i)).not.toBeInTheDocument()
    })

    it('does not render a tenant switcher control', () => {
      renderShell()

      // The tenant name is shown as a read-only badge, not a clickable switcher.
      // The TenantSwitcher component must not be present in the mechanic shell.
      expect(screen.queryByRole('button', { name: /switch tenant/i })).not.toBeInTheDocument()
    })

    it('renders the sign-out button as the only action in the header', () => {
      renderShell()

      expect(screen.getByRole('button', { name: /abmelden/i })).toBeInTheDocument()
    })

    it('shows the tenant name as a read-only badge when a tenant is active', () => {
      renderShell('/mechanic/queue', { tenantName: 'Workshop A' })

      expect(screen.getByText('Workshop A')).toBeInTheDocument()
    })

    it('shows the mechanic user email in the header', () => {
      renderShell('/mechanic/queue', { userEmail: 'ali@workshop.com' })

      expect(screen.getByText('ali@workshop.com')).toBeInTheDocument()
    })
  })

  describe('command palette keyboard shortcut', () => {
    it.each([
      ['Ctrl', { ctrlKey: true }],
      ['Cmd', { metaKey: true }],
    ] as const)('toggles the palette with %s+K and prevents the browser shortcut', async (_, modifier) => {
      renderShell()

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(fireEvent.keyDown(document, { key: 'k', ...modifier })).toBe(false)
      expect(await screen.findByRole('dialog', { name: 'Search' })).toBeVisible()

      expect(fireEvent.keyDown(document, { key: 'k', ...modifier })).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('does not open the palette for unmodified K or another modified key', () => {
      renderShell()

      expect(fireEvent.keyDown(document, { key: 'k' })).toBe(true)
      expect(fireEvent.keyDown(document, { key: 'j', ctrlKey: true })).toBe(true)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  // ─── Session persistence ─────────────────────────────────────────────────

  describe('stale mechanic identity cleanup', () => {
    it('removes the legacy acp:mechanic-id key from localStorage on mount', () => {
      window.localStorage.setItem('acp:mechanic-id', 'some-old-mechanic-uuid')

      renderShell()

      expect(window.localStorage.getItem('acp:mechanic-id')).toBeNull()
    })

    it('does not write any mechanic identity key to localStorage', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

      renderShell()

      const mechanicWrites = setItemSpy.mock.calls.filter(([key]) =>
        (key as string).toLowerCase().includes('mechanic'),
      )
      expect(mechanicWrites).toHaveLength(0)
    })
  })
})

// ─── Role-aware route guards ────────────────────────────────────────────────

function renderShellRouter(
  initialPath: string,
  opts: {
    activeRole?: 'OWNER' | 'ADMIN' | 'TECH' | 'SALES' | null
    platformRole?: string | null
  } = {},
) {
  asMock(mechanicApi.useMechanicQueue).mockReturnValue({
    data: { data: [] },
    isLoading: false,
    refetch: vi.fn(),
  })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ShellRouter
          userId="user-1"
          userEmail="user@workshop.com"
          platformRole={opts.platformRole ?? null}
          activeTenant={{ id: 'tenant-1', name: 'Workshop A', slug: 'workshop-a' }}
          activeRole={opts.activeRole ?? 'ADMIN'}
          memberships={[]}
          activeSiteId={null}
          sites={[]}
          isLoadingSites={false}
          isSwitchingTenant={false}
          isSwitchingSite={false}
          onSwitchTenant={vi.fn()}
          onSwitchSite={vi.fn()}
          onSignOut={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('role-aware shell route guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('redirects a non-TECH user from /mechanic to the admin app', async () => {
    renderShellRouter('/mechanic', { activeRole: 'ADMIN' })

    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument()
    expect(screen.queryByText(/^Mechaniker$/)).not.toBeInTheDocument()
  })

  it('redirects a non-super-admin from platform tenants to the admin app', async () => {
    renderShellRouter('/platform/tenants', { activeRole: 'ADMIN', platformRole: null })

    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Platform tenants page')).not.toBeInTheDocument()
  })

  it('keeps a TECH user in the mechanic shell on back-office routes', async () => {
    renderShellRouter('/inventory', { activeRole: 'TECH' })

    expect(await screen.findByRole('button', { name: /abmelden/i })).toBeInTheDocument()
    expect(screen.getByText('Mechaniker')).toBeInTheDocument()
  })

  it.each(['/hr/employees', '/hr/clock', '/hr/leave'])(
    'redirects a TECH user away from %s without rendering office HR content',
    async (path) => {
      renderShellRouter(path, { activeRole: 'TECH' })

      expect(await screen.findByRole('button', { name: /abmelden/i })).toBeInTheDocument()
      expect(screen.getByText('Mechaniker')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'HR' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Employees' })).not.toBeInTheDocument()
    },
  )

  it.each([
    ['/workshop/orders/order-1', 'Mechanic tyre report'],
    ['/workshop/orders/order-1?action=recordTyreMeasurement', 'Mechanic tyre report'],
    ['/workshop/tyre-storage/set-1', 'Tyre hotel detail'],
    ['/workshop/tyre-storage/set-1?action=recordTyreMeasurement', 'Tyre hotel detail'],
  ])('permits the canonical TECH detail route %s in the mechanic shell', async (path, heading) => {
    renderShellRouter(path, { activeRole: 'TECH' })

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByText('Mechaniker')).toBeInTheDocument()
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Office work order' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: deWorkshop.mechanic.accessDenied.title })).not.toBeInTheDocument()
  })

  it.each([
    '/workshop/orders',
    '/workshop/tyre-storage',
    '/settings',
    '/hr/employees',
    '/hr/clock',
    '/hr/leave',
    '/dashboard',
    '/workshop/orders/order-1/check-in',
    '/workshop/orders/order-1/garantie-kulanz',
    '/workshop/tyre-storage/set-1/edit',
  ])(
    'shows an access-denied page for a TECH user visiting %s',
    async (path) => {
      renderShellRouter(path, { activeRole: 'TECH' })

      expect(
        await screen.findByRole('heading', { name: deWorkshop.mechanic.accessDenied.title }),
      ).toBeInTheDocument()
      expect(screen.getByText(deWorkshop.mechanic.accessDenied.description)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: deWorkshop.mechanic.accessDenied.backToQueue })).toHaveAttribute(
        'href',
        MECHANIC_ROUTE_PATHS.queue,
      )
      expect(screen.getByText('Mechaniker')).toBeInTheDocument()
      expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument()
    },
  )
})
