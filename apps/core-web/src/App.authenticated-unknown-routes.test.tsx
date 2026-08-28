/**
 * AUT-222: Authenticated unknown routes show a 404 page inside the app shell.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
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

vi.mock('@/pages/LoginPage', () => ({
  default: () => <div>Sign in card</div>,
}))

vi.mock('@/features/realtime/RealtimeDashboardSyncProvider', () => ({
  RealtimeDashboardSyncProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('./pages/workshop/WorkshopPickList', () => ({
  default: () => <div>Workshop Pick Queue</div>,
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

const sessionData = {
  platformRole: null,
  activeTenant: { id: 't1', name: 'Test', slug: 'test' },
  activeRole: 'ADMIN' as const,
  memberships: [],
}

describe('App authenticated unknown routes (AUT-222)', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { uid: 'u1', email: 'admin@test.com' },
      loading: false,
      signOutUser: vi.fn(),
    })
    mockUseAuthSession.mockReturnValue({
      isLoading: false,
      data: sessionData,
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

  it.each(['/invoices', '/this-route-does-not-exist-qa'])(
    'shows a 404 page inside the app shell for unknown route %s',
    async (path) => {
      renderAtPath(path)

      expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
      expect(screen.getByText('ACP')).toBeInTheDocument()
    },
  )

  it('redirects /workshop/pick to the pick list', async () => {
    renderAtPath('/workshop/pick')

    expect(await screen.findByText('Workshop Pick Queue')).toBeInTheDocument()
    expect(window.location.pathname).toBe(APP_ROUTE_PATHS.workshopPickList)
  })

  it('loads the HR module at /hr', async () => {
    renderAtPath('/hr')

    expect(
      await screen.findByRole('heading', { name: 'Employees' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('ACP')).toBeInTheDocument()
  })
})
