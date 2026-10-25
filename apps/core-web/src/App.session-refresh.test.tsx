/**
 * AUT-734: Keep the shell mounted during background auth-session refetch.
 */

import * as React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTE_PATHS, LOGIN_PATH } from '@/lib/app-route-paths'
import { createHttpError } from '@/lib/error-utils'
import App from './App'

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

function renderAtPath(pathname: string) {
  window.history.pushState({}, '', pathname)

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

const sessionFixture = {
  userId: 'user-1',
  email: 'testauto@auto.core.at',
  activeTenant: {
    id: 'tenant-a',
    name: 'Auto Core Vienna',
    slug: 'vienna',
  },
  activeRole: 'ADMIN' as const,
  memberships: [],
  activeSiteId: null,
  locale: null,
  effectiveLocale: 'de',
  defaultLocale: 'de',
  formatLocale: 'de-AT',
}

describe('App session refresh (AUT-734)', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { uid: 'user-1', email: 'testauto@auto.core.at' },
      loading: false,
      authInitTimedOut: false,
      signOutUser: vi.fn(),
    })
    mockUseAuthSession.mockReturnValue({
      isLoading: true,
      isError: false,
      data: sessionFixture,
    })
    mockUseSwitchTenant.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('keeps the authenticated shell visible while the session refetches in the background', async () => {
    renderAtPath(APP_ROUTE_PATHS.dashboard)

    expect(await screen.findByText('ACP')).toBeInTheDocument()
    expect(screen.queryByText('Laden…')).not.toBeInTheDocument()
  })

  it('signs out and redirects to login when a background refetch returns 401 with cached session data', async () => {
    const signOutUser = vi.fn().mockResolvedValue(undefined)
    mockUseAuth.mockReturnValue({
      user: { uid: 'user-1', email: 'testauto@auto.core.at' },
      loading: false,
      authInitTimedOut: false,
      signOutUser,
    })
    mockUseAuthSession.mockReturnValue({
      isLoading: false,
      isError: true,
      data: sessionFixture,
      error: createHttpError('Unauthorized', 401),
    })

    renderAtPath(APP_ROUTE_PATHS.dashboard)

    await waitFor(() => {
      expect(signOutUser).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(window.location.pathname).toBe(LOGIN_PATH)
    })
    expect(screen.queryByText('ACP')).not.toBeInTheDocument()
  })
})
