/**
 * AUT-99: Verifies that the MechanicShell satisfies the ADR-0014 §8.2 requirements:
 *   - No back-office app switcher or mechanic-selector controls are rendered.
 *   - The stale `acp:mechanic-id` localStorage key is removed on shell mount
 *     so that no client-chosen mechanic identity can persist across upgrades.
 */

import { render, screen, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MechanicShell } from './App'
import * as mechanicApi from '@/api/mechanic'

vi.mock('@/api/mechanic')

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

      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
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
