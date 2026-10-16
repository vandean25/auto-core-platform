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

    expect(
      screen.getByText('Anmeldung ist für diese Umgebung nicht konfiguriert.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/VITE_FIREBASE|Firebase Authentication/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anmelden' })).not.toBeInTheDocument()
  })

  it('shows the first-run product explanation and invite-only sign-in copy', () => {
    render(<LoginPage />)

    expect(screen.getByRole('heading', { name: 'Auto Core' })).toBeInTheDocument()
    expect(
      screen.getByText('ACP führt Lager, Aufträge und Rechnungen in einem Werkstattbuch.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Teile im Regal')).toBeInTheDocument()
    expect(screen.getByText('Aufträge am Board')).toBeInTheDocument()
    expect(screen.getByText('Rechnungen mit Nachweis')).toBeInTheDocument()
    expect(
      screen.getByText('Mit der E-Mail anmelden, mit der Ihre Werkstatt Sie eingeladen hat.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dokumentation' })).toHaveAttribute(
      'href',
      'https://autocore-platform.mintlify.site/',
    )
    expect(screen.queryByText(/Firebase|VITE_FIREBASE/)).not.toBeInTheDocument()
  })

  it('shows demo account guidance only on the public demo host', () => {
    vi.stubGlobal('location', { hostname: 'auto-core-platform-vande.web.app' })
    const { unmount } = render(<LoginPage />)

    expect(screen.getByText('Demo-Werkstatt')).toBeInTheDocument()
    expect(screen.getByText('Büro: demo-office@example.com')).toBeInTheDocument()
    expect(screen.getByText('Mechaniker: demo-mechanic@example.com')).toBeInTheDocument()
    expect(screen.getByText('Passwort beim Pilotkunden erfragen.')).toBeInTheDocument()
    expect(screen.queryByText(/password:/i)).not.toBeInTheDocument()

    unmount()
    vi.stubGlobal('location', { hostname: 'localhost' })
    render(<LoginPage />)

    expect(screen.queryByText('Demo-Werkstatt')).not.toBeInTheDocument()
  })

  it('shows an accessible error when both fields are empty on submit', async () => {
    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('E-Mail und Passwort sind erforderlich')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('shows an accessible error when only email is empty', async () => {
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('E-Mail ist erforderlich')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('shows an accessible error when only password is empty', async () => {
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Passwort ist erforderlich')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('submits credentials when both fields are filled', async () => {
    signIn.mockResolvedValue(undefined)

    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('user@example.com', 'secret')
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears validation errors when the user edits a field', async () => {
    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'user@example.com' } })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('sends a reset email for the entered address', async () => {
    sendPasswordResetEmail.mockResolvedValue(undefined)
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: ' user@example.com ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Passwort vergessen?' }))

    await waitFor(() => {
      expect(sendPasswordResetEmail).toHaveBeenCalledWith('user@example.com')
    })
    expect(toast.success).toHaveBeenCalledWith('E-Mail mit Reset-Link wurde gesendet.')
  })

  it('shows the approved reset error when sending fails', async () => {
    sendPasswordResetEmail.mockRejectedValue(new Error('reset failed'))
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Passwort vergessen?' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Reset-E-Mail konnte nicht gesendet werden. Adresse prüfen und erneut versuchen.',
      )
    })
  })

  it('requires an email before starting a password reset', async () => {
    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Passwort vergessen?' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('E-Mail für Passwort-Reset eingeben.')
    })
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })
})
