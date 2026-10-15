import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY,
  clearStoredLandingDemoEmail,
  describeLandingDemoEmailLinkError,
  isDemoGrantSessionErrorMessage,
  readStoredLandingDemoEmail,
  storeLandingDemoEmailForSignIn,
} from '@/auth/landing-demo-email-link'

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: {},
  firebaseConfigMissing: false,
}))

vi.mock('firebase/auth', () => ({
  isSignInWithEmailLink: vi.fn(() => true),
}))

describe('landing-demo email-link storage', () => {
  afterEach(() => {
    clearStoredLandingDemoEmail()
  })

  it('round-trips the email in localStorage under the Firebase-compatible key', () => {
    storeLandingDemoEmailForSignIn('demo@example.com')
    expect(globalThis.localStorage.getItem(LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY)).toBe(
      'demo@example.com',
    )
    expect(readStoredLandingDemoEmail()).toBe('demo@example.com')
    clearStoredLandingDemoEmail()
    expect(readStoredLandingDemoEmail()).toBeNull()
  })
})

describe('landing-demo email-link errors', () => {
  it('detects server-side demo grant rejection messages', () => {
    expect(
      isDemoGrantSessionErrorMessage(
        'Demo sign-in link is missing, expired, or already used.',
      ),
    ).toBe(true)
    expect(isDemoGrantSessionErrorMessage('Something else')).toBe(false)
  })

  it('maps Firebase action-code failures to German copy', () => {
    expect(
      describeLandingDemoEmailLinkError({ code: 'auth/invalid-action-code' }),
    ).toContain('abgelaufen')
  })
})
