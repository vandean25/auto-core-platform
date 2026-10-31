/**
 * AUT-819: no previous user's data stays visible while the client session is reset, and unsynced offline check-ins
 * are never discarded without asking when another user takes over the browser.
 */

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runWithClientSessionPending } from '@/auth/client-session-reset'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import App from './App'

const authState = {
  user: { uid: 'user-a', email: 'user-a@auto.core.test' } as {
    uid: string
    email: string
  } | null,
  loading: false,
  authInitTimedOut: false,
}

const sessionState = {
  data: null as Record<string, unknown> | null,
}

const mocks = vi.hoisted(() => ({
  summarize: vi.fn(),
  purge: vi.fn(),
  signOutUser: vi.fn(),
}))

const mockUseAuth = vi.fn()
const mockUseAuthSession = vi.fn()
const mockUseSwitchTenant = vi.fn()

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/api/auth-session', () => ({
  useAuthSession: (...args: unknown[]) => mockUseAuthSession(...args),
  useSwitchTenant: () => mockUseSwitchTenant(),
}))

vi.mock('@/api/sites', () => ({
  useMySites: () => ({ data: [], isLoading: false }),
  useSetActiveSite: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/auth/landing-demo-email-link', () => ({
  isFirebaseEmailLinkSignInUrl: vi.fn(() => false),
  isDemoGrantSessionErrorMessage: vi.fn(() => false),
}))

vi.mock('@/pages/LoginPage', () => ({
  default: () => <div>Sign in card</div>,
}))

vi.mock('@/features/realtime/RealtimeDashboardSyncProvider', () => ({
  RealtimeDashboardSyncProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('./pages/DashboardPage', () => ({
  default: () => <div>Dashboard content</div>,
}))

vi.mock('@/features/workshop/check-in/check-in-offline-unsynced', () => ({
  summarizeCheckInOfflineUnsynced: mocks.summarize,
  hasUnsyncedCheckInOfflineData: (summary: { dirtyDraftCount: number }) => summary.dirtyDraftCount > 0,
}))

vi.mock('@/features/workshop/check-in/check-in-offline-store', () => ({
  purgeAllCheckInOfflineData: mocks.purge,
}))

vi.mock('@/features/workshop/check-in/CheckInOfflinePurgeDialog', () => ({
  CheckInOfflinePurgeDialog: (props: { onCancel: () => void; onConfirm: () => void }) => (
    <div data-testid="user-change-purge-dialog">
      <button type="button" aria-label="Cancel purge" data-testid="purge-cancel" onClick={props.onCancel} />
      <button type="button" aria-label="Confirm purge" data-testid="purge-confirm" onClick={props.onConfirm} />
    </div>
  ),
}))

function createSession(tenantId: string, tenantName: string, slug: string) {
  return {
    userId: authState.user?.uid ?? 'user-a',
    email: authState.user?.email ?? 'user-a@auto.core.test',
    activeTenant: { id: tenantId, name: tenantName, slug },
    activeRole: 'ADMIN',
    memberships: [],
    activeSiteId: null,
    locale: null,
    effectiveLocale: 'de',
    defaultLocale: 'de',
    formatLocale: 'de-AT',
  }
}

function renderAtPath(pathname: string) {
  window.history.pushState({}, '', pathname)

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const element = (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )

  const view = render(element)

  return {
    ...view,
    rerenderApp: () =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>,
      ),
  }
}

describe('App client session cache reset (AUT-819)', () => {
  beforeEach(() => {
    authState.user = { uid: 'user-a', email: 'user-a@auto.core.test' }
    sessionState.data = createSession('tenant-a', 'Auto Core Vienna', 'vienna')
    mocks.summarize.mockReset().mockResolvedValue({
      dirtyDraftCount: 1,
      queuedPhotoCount: 0,
      pendingCreateCount: 0,
      mechanicNoteDraftCount: 0,
    })
    mocks.purge.mockReset().mockResolvedValue(undefined)

    mockUseAuth.mockImplementation(() => ({
      user: authState.user,
      loading: authState.loading,
      authInitTimedOut: authState.authInitTimedOut,
      signOutUser: mocks.signOutUser,
    }))
    mockUseAuthSession.mockImplementation(() => ({
      isLoading: false,
      isError: false,
      data: sessionState.data,
    }))
    mockUseSwitchTenant.mockReturnValue({ isPending: false, mutateAsync: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    window.history.pushState({}, '', '/')
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('shows the loading screen while a client session reset is pending', async () => {
    renderAtPath(APP_ROUTE_PATHS.dashboard)

    expect(await screen.findByText('ACP')).toBeInTheDocument()

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let pending!: Promise<void>

    await act(async () => {
      pending = runWithClientSessionPending(() => gate)
      await Promise.resolve()
    })

    expect(await screen.findByText('Laden…')).toBeInTheDocument()
    expect(screen.queryByText('ACP')).not.toBeInTheDocument()

    await act(async () => {
      release()
      await pending
    })

    await waitFor(() => {
      expect(screen.getByText('ACP')).toBeInTheDocument()
    })
  })

  it('asks before discarding unsynced check-ins when another user takes over the browser', async () => {
    const view = renderAtPath(APP_ROUTE_PATHS.dashboard)

    expect(await screen.findByText('Auto Core Vienna')).toBeInTheDocument()

    authState.user = { uid: 'user-b', email: 'user-b@auto.core.test' }
    sessionState.data = createSession('tenant-b', 'Auto Core Graz', 'graz')
    view.rerenderApp()

    expect(await screen.findByTestId('user-change-purge-dialog')).toBeInTheDocument()
    expect(screen.queryByText('Auto Core Vienna')).not.toBeInTheDocument()
    expect(screen.getByText('Auto Core Graz')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('purge-cancel'))

    await waitFor(() => {
      expect(screen.queryByTestId('user-change-purge-dialog')).not.toBeInTheDocument()
    })
    expect(mocks.purge).not.toHaveBeenCalled()
  })

  it('discards unsynced check-ins only after the user confirms', async () => {
    const view = renderAtPath(APP_ROUTE_PATHS.dashboard)

    expect(await screen.findByText('Auto Core Vienna')).toBeInTheDocument()

    authState.user = { uid: 'user-b', email: 'user-b@auto.core.test' }
    sessionState.data = createSession('tenant-b', 'Auto Core Graz', 'graz')
    view.rerenderApp()

    expect(await screen.findByTestId('user-change-purge-dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('purge-confirm'))

    await waitFor(() => {
      expect(mocks.purge).toHaveBeenCalledTimes(1)
    })
  })
})
