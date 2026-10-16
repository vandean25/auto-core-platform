import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import LoginPage from './LoginPage'

const signIn = vi.fn()
const signInWithGoogle = vi.fn()
const sendPasswordResetEmail = vi.fn()
const authState = vi.hoisted(() => ({ isConfigured: true }))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
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

describe('LoginPage', () => {
  it('shows a neutral message when sign-in is not configured', () => {
    authState.isConfigured = false

    render(<LoginPage />)

    expect(screen.getByText('Sign-in is not configured for this deployment.')).toBeInTheDocument()
    expect(screen.queryByText(/VITE_FIREBASE|Firebase Authentication/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('shows the first-run product explanation and invite-only sign-in copy', () => {
    render(<LoginPage />)

    expect(screen.getByRole('heading', { name: 'Auto Core' })).toBeInTheDocument()
    expect(screen.getByText('ACP keeps stock, jobs, and invoices in one workshop ledger.')).toBeInTheDocument()
    expect(screen.getByText('Parts on the shelf')).toBeInTheDocument()
    expect(screen.getByText('Jobs on the board')).toBeInTheDocument()
    expect(screen.getByText('Invoices with a paper trail')).toBeInTheDocument()
    expect(screen.getByText('Sign in with the email your workshop invited.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
      'href',
      'https://autocore-platform.mintlify.site/',
    )
    expect(screen.queryByText(/Firebase|VITE_FIREBASE/)).not.toBeInTheDocument()
  })

  it('shows demo account guidance only on the public demo host', () => {
    vi.stubGlobal('location', { hostname: 'auto-core-platform-vande.web.app' })
    const { unmount } = render(<LoginPage />)

    expect(screen.getByText('Demo workshop')).toBeInTheDocument()
    expect(screen.getByText('Office: grok-bot@auto.core.at')).toBeInTheDocument()
    expect(screen.getByText('Mechanic: grok-bot-tech@auto.core.at')).toBeInTheDocument()
    expect(screen.getByText('Ask the demo owner for the password.')).toBeInTheDocument()
    expect(screen.queryByText(/password:/i)).not.toBeInTheDocument()

    unmount()
    vi.stubGlobal('location', { hostname: 'localhost' })
    render(<LoginPage />)

    expect(screen.queryByText('Demo workshop')).not.toBeInTheDocument()
  })

  it('shows an accessible error when both fields are empty on submit', async () => {
    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Email and password are required')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('shows an accessible error when only email is empty', async () => {
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Email is required')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('shows an accessible error when only password is empty', async () => {
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Password is required')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('submits credentials when both fields are filled', async () => {
    signIn.mockResolvedValue(undefined)

    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('user@example.com', 'secret')
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears validation errors when the user edits a field', async () => {
    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('sends a reset email for the entered address', async () => {
    sendPasswordResetEmail.mockResolvedValue(undefined)
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' user@example.com ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))

    await waitFor(() => {
      expect(sendPasswordResetEmail).toHaveBeenCalledWith('user@example.com')
    })
    expect(toast.success).toHaveBeenCalledWith('Check your email for a reset link.')
  })

  it('shows the approved reset error when sending fails', async () => {
    sendPasswordResetEmail.mockRejectedValue(new Error('reset failed'))
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('We could not send a reset email. Check the address and try again.')
    })
  })

  it('requires an email before starting a password reset', async () => {
    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Enter your email to reset your password.')
    })
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })
})
