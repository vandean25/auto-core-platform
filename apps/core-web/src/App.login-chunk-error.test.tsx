import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('@/pages/LoginPage', () => {
  return {
    default: () => {
      throw new TypeError(
        'Failed to fetch dynamically imported module: https://auto-core-platform-vande.web.app/assets/LoginPage-BDWcsH0-.js',
      )
    },
  }
})

describe('App login lazy chunk handling', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the global error fallback when login lazy import fails', async () => {
    render(<App />)

    expect(await screen.findByText('Update Required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload Application' })).toBeInTheDocument()
  })
})
