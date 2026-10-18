import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOGIN_PATH } from '@/lib/app-route-paths'
import * as i18nModule from '@/lib/i18n'
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

vi.mock('@/pages/LandingDemoEmailLinkCompletionPage', () => ({
  default: () => <div>Demo email link completion</div>,
}))

vi.mock('@/pages/NotFoundPage', () => ({
  default: () => <div>Page not found</div>,
}))

describe('App customer search i18n bootstrap', () => {
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
    window.history.pushState({}, '', LOGIN_PATH)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('loads the customers namespace on mount via ensureCustomerSearchI18n', async () => {
    const ensureSpy = vi.spyOn(i18nModule, 'ensureNamespaceLoaded').mockResolvedValue(undefined)
    render(<App />)
    await waitFor(() => {
      expect(ensureSpy).toHaveBeenCalledWith('customers')
    })
  })
})
