import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import App from './App'

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signOutUser: vi.fn(),
  }),
}))

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({
    isLoading: false,
    data: null,
  }),
  useSwitchTenant: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}))

vi.mock('@/api/sites', () => ({
  useMySites: () => ({ data: [], isLoading: false }),
  useSetActiveSite: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/pages/LoginPage', () => ({
  default: () => <div>Sign-in surface</div>,
}))

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => <div data-testid="toast-host" />,
}))

describe('App logged-out surface', () => {
  it('renders the public sign-in surface without waiting for a lazy chunk', () => {
    render(<App />)

    expect(screen.getByText('Sign-in surface')).toBeInTheDocument()
    expect(screen.getByTestId('toast-host')).toBeInTheDocument()
  })
})
