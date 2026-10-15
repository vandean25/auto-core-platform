import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LandingDemoEmailLinkCompletionPage from './LandingDemoEmailLinkCompletionPage'
import { LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY } from '@/auth/landing-demo-email-link'

const completeSignIn = vi.fn()

vi.mock('@/auth/completeLandingDemoEmailLinkSignIn', () => ({
  completeLandingDemoEmailLinkSignIn: (...args: unknown[]) => completeSignIn(...args),
}))

vi.mock('@/auth/landing-demo-email-link', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/auth/landing-demo-email-link')>()
  return {
    ...actual,
    isFirebaseEmailLinkSignInUrl: vi.fn(() => true),
    resolveLandingDemoAccessUrl: vi.fn(() => 'https://landing.example/demo'),
  }
})

vi.mock('@/lib/firebase', () => ({
  firebaseConfigMissing: false,
  firebaseAuth: {},
}))

describe('LandingDemoEmailLinkCompletionPage', () => {
  beforeEach(() => {
    completeSignIn.mockReset()
    globalThis.localStorage.clear()
    vi.stubEnv('VITE_LANDING_PAGE_URL', 'https://landing.example/demo')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    globalThis.localStorage.clear()
  })

  it('auto-completes when the email is stored locally', async () => {
    globalThis.localStorage.setItem(LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY, 'demo@example.com')
    completeSignIn.mockResolvedValue(undefined)

    render(<LandingDemoEmailLinkCompletionPage />)

    await waitFor(() => {
      expect(completeSignIn).toHaveBeenCalledWith(
        'demo@example.com',
        expect.stringContaining('http'),
      )
    })
  })

  it('asks for the email when localStorage is empty', async () => {
    render(<LandingDemoEmailLinkCompletionPage />)

    expect(
      await screen.findByLabelText('E-Mail'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Demo starten' })).toBeInTheDocument()
  })

  it('shows German recovery copy when completion fails', async () => {
    globalThis.localStorage.setItem(LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY, 'demo@example.com')
    completeSignIn.mockRejectedValue({ code: 'auth/invalid-action-code' })

    render(<LandingDemoEmailLinkCompletionPage />)

    expect(
      await screen.findByText(/abgelaufen oder wurde bereits verwendet/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Neuen Demo-Link anfordern' })).toHaveAttribute(
      'href',
      'https://landing.example/demo',
    )
  })

  it('submits the entered email when the user confirms', async () => {
    completeSignIn.mockResolvedValue(undefined)

    render(<LandingDemoEmailLinkCompletionPage />)

    fireEvent.change(await screen.findByLabelText('E-Mail'), {
      target: { value: 'typed@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Demo starten' }))

    await waitFor(() => {
      expect(completeSignIn).toHaveBeenCalledWith('typed@example.com', expect.any(String))
    })
  })
})
