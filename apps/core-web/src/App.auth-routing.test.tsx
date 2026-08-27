/**
 * AUT-201: Unknown routes show a 404 page; protected routes redirect to /login.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTE_PATHS, LOGIN_PATH } from '@/lib/app-route-paths'
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

vi.mock('@/pages/NotFoundPage', () => ({
  default: () => <div>Page not found</div>,
}))

function renderAtPath(pathname: string) {
  window.history.pushState({}, '', pathname)
  return render(<App />)
}

describe('App auth and 404 routing (AUT-201)', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      signOutUser: vi.fn(),
    })
    mockUseAuthSession.mockReturnValue({
      isLoading: false,
      data: null,
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

  it('shows a 404 page for unknown routes while logged out', async () => {
    renderAtPath('/this-route-does-not-exist-qa')

    expect(await screen.findByText('Page not found')).toBeInTheDocument()
    expect(screen.queryByText('Sign in card')).not.toBeInTheDocument()
  })

  it('redirects protected routes to /login while logged out', async () => {
    renderAtPath(APP_ROUTE_PATHS.dashboard)

    await waitFor(() => {
      expect(screen.getByText('Sign in card')).toBeInTheDocument()
    })
    expect(window.location.pathname).toBe(LOGIN_PATH)
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument()
  })

  it('renders the sign-in card at /login', async () => {
    renderAtPath(LOGIN_PATH)

    expect(await screen.findByText('Sign in card')).toBeInTheDocument()
    expect(window.location.pathname).toBe(LOGIN_PATH)
  })

  it('does not flash the sign-in card while auth is loading on /login', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      signOutUser: vi.fn(),
    })

    renderAtPath(LOGIN_PATH)

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('Sign in card')).not.toBeInTheDocument()
  })
})
