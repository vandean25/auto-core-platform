import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import LoginPage from './LoginPage'
import { loginPageDeCopy as copy } from './login-page.test-copy'

const signIn = vi.fn()
const signInWithGoogle = vi.fn()
const sendPasswordResetEmail = vi.fn()
const authState = vi.hoisted(() => ({ isConfigured: true }))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    signIn,
    signInWithGoogle,
    sendPasswordResetEmail,
    isConfigured: authState.isConfigured,
  }),
}))

afterEach(() => {
  cleanup()
  signIn.mockReset()
  signInWithGoogle.mockReset()
  sendPasswordResetEmail.mockReset()
  authState.isConfigured = true
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.unstubAllGlobals()
})

describe('LoginPage (de)', () => {
  it('shows a neutral message when sign-in is not configured', () => {
    authState.isConfigured = false
    render(<LoginPage />)
    expect(screen.getByText(copy.notConfigured)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: copy.signIn })).not.toBeInTheDocument()
  })

  it('shows the first-run product explanation and invite-only sign-in copy', () => {
    render(<LoginPage />)
    expect(screen.getByRole('heading', { name: 'Auto Core' })).toBeInTheDocument()
    expect(screen.getByText(copy.tagline)).toBeInTheDocument()
    expect(screen.getByText(copy.inviteCopy)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: copy.docsLink })).toHaveAttribute(
      'href',
      'https://autocore-platform.mintlify.site/',
    )
  })

  it('shows demo account guidance only on the public demo host', () => {
    vi.stubGlobal('location', { hostname: 'auto-core-platform-vande.web.app' })
    const { unmount } = render(<LoginPage />)
    expect(screen.getByText(copy.demoTitle)).toBeInTheDocument()
    expect(screen.getByText(copy.demoOffice)).toBeInTheDocument()
    unmount()
    vi.stubGlobal('location', { hostname: 'localhost' })
    render(<LoginPage />)
    expect(screen.queryByText(copy.demoTitle)).not.toBeInTheDocument()
  })

  it('validates empty sign-in and password reset', async () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: copy.signIn }))
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.validationBoth)
    fireEvent.click(screen.getByRole('button', { name: copy.forgotPassword }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(copy.resetNeedsEmail))
  })

  it('submits credentials when both fields are filled', async () => {
    signIn.mockResolvedValue(undefined)
    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText(copy.emailLabel), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText(copy.passwordLabel), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: copy.signIn }))
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('user@example.com', 'secret'))
  })
})
