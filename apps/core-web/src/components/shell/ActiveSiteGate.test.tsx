import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import type { MeSite } from '@/api/sites'
import App from '@/App'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { ActiveSiteGateProvider, ActiveSiteOutlet } from './ActiveSiteGate'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useAuthSession: vi.fn(),
  useMySites: vi.fn(),
}))

vi.mock('@/lib/firebase', () => ({ firebaseAuth: { currentUser: null } }))
vi.mock('@/lib/runtime-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/runtime-flags')>()),
  getE2ETestToken: () => null,
  isE2ETestTokenAuthEnabled: () => false,
}))
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => mocks.useAuth() }))
vi.mock('@/api/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth-session')>()),
  useAuthSession: () => mocks.useAuthSession(),
  useSwitchTenant: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))
vi.mock('@/api/sites', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/sites')>()),
  useMySites: () => mocks.useMySites(),
  useSetActiveSite: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))
vi.mock('@/features/realtime/RealtimeDashboardSyncProvider', () => ({
  RealtimeDashboardSyncProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/pages/workshop/WorkshopPickList', () => ({
  default: () => <div data-testid="wo-list-skeleton" />,
}))

const SITES: MeSite[] = [
  { id: 'site-main', code: 'MAIN', name: 'Wien', legalEntityId: 'le-1' },
  { id: 'site-grz', code: 'GRZ', name: 'Graz', legalEntityId: 'le-1' },
]

/** Stands in for a site list page: it asks for its rows when it mounts and shows a skeleton until then. */
function WorkOrderList({ onRequest }: { onRequest: () => void }) {
  React.useEffect(onRequest, [onRequest])
  return <div data-testid="wo-list-skeleton" />
}

function renderGate(activeSiteId: string | null, onRequest = vi.fn(), onPickSite = vi.fn()) {
  return render(
    <ActiveSiteGateProvider
      activeSiteId={activeSiteId}
      sites={SITES}
      sitesLoading={false}
      sitesFailed={false}
      onPickSite={onPickSite}
      onRetrySites={vi.fn()}
    >
      <ActiveSiteOutlet>
        <WorkOrderList onRequest={onRequest} />
      </ActiveSiteOutlet>
    </ActiveSiteGateProvider>,
  )
}

/** Answers every request with this 422 body, then sends one request through the shared client. */
async function answerActiveSiteRequired(body: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 422, message: 'An active site is required.', ...body }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  await act(async () => {
    await fetchWithAuth('/api/workshop/orders')
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('ActiveSiteGate (AUT-979)', () => {
  // Regression: after a switch to a tenant with several sites the WO list mounted without a site and hung in skeleton.
  it('opens the site picker without sending a list request when no site is active', () => {
    const onRequest = vi.fn()
    const onPickSite = vi.fn()
    renderGate(null, onRequest, onPickSite)

    expect(screen.getByRole('heading', { name: 'Standort wählen' })).toBeInTheDocument()
    expect(onRequest).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Graz aktivieren' }))
    expect(onPickSite).toHaveBeenCalledWith('site-grz')
  })

  // Regression: a 422 ACTIVE_SITE_REQUIRED left the page in its skeleton with no message.
  it.each([
    ['operational SiteContextService (code)', { code: 'ACTIVE_SITE_REQUIRED', error: 'Unprocessable Entity' }],
    ['common SiteContextService (error)', { code: 'HTTP_422', error: 'ACTIVE_SITE_REQUIRED' }],
  ])('replaces the page with the site picker when an API call answers 422 ACTIVE_SITE_REQUIRED from %s', async (_source, body) => {
    renderGate('site-main')
    expect(screen.getByTestId('wo-list-skeleton')).toBeInTheDocument()

    await answerActiveSiteRequired(body)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Standort wählen' })).toBeInTheDocument())
    expect(screen.queryByTestId('wo-list-skeleton')).not.toBeInTheDocument()
  })

  describe('in the app shell', () => {
    beforeEach(() => {
      mocks.useAuth.mockReturnValue({
        user: { uid: 'u1', email: 'admin@test.com' },
        loading: false,
        signOutUser: vi.fn(),
      })
      mocks.useAuthSession.mockReturnValue({
        isLoading: false,
        data: {
          platformRole: null,
          activeTenant: { id: 't1', name: 'Werkstatt Test', slug: 'test' },
          activeRole: 'ADMIN' as const,
          memberships: [],
          activeSiteId: 'site-gone',
        },
      })
      mocks.useMySites.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
    })

    // Review finding: the picker replaced the whole shell, so a user without sites lost sign-out and tenant switch.
    it('keeps tenant switch and sign-out reachable when a 422 arrives and the user has no site', async () => {
      window.history.pushState({}, '', APP_ROUTE_PATHS.workshopPickList)
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <App />
        </QueryClientProvider>,
      )
      expect(await screen.findByTestId('wo-list-skeleton', {}, { timeout: 5000 })).toBeInTheDocument()

      await answerActiveSiteRequired({ code: 'ACTIVE_SITE_REQUIRED', error: 'Unprocessable Entity' })

      expect(await screen.findByText('Kein Standort freigegeben.')).toBeInTheDocument()
      expect(screen.queryByTestId('wo-list-skeleton')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Werkstatt Test/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /admin@test\.com/ })).toBeInTheDocument()
    })
  })
})
