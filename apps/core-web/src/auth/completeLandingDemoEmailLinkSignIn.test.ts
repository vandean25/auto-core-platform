import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completeLandingDemoEmailLinkSignIn } from '@/auth/completeLandingDemoEmailLinkSignIn'
import { LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY } from '@/auth/landing-demo-email-link'

const signInWithEmailLink = vi.fn()

vi.mock('firebase/auth', () => ({
  signInWithEmailLink: (...args: unknown[]) => signInWithEmailLink(...args),
}))

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: { app: 'mock' },
}))

describe('completeLandingDemoEmailLinkSignIn', () => {
  beforeEach(() => {
    signInWithEmailLink.mockReset()
    globalThis.localStorage.clear()
  })

  it('calls Firebase and clears stored email on success', async () => {
    signInWithEmailLink.mockResolvedValue({ user: { uid: 'u1' } })
    globalThis.localStorage.setItem(LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY, 'old@example.com')

    await completeLandingDemoEmailLinkSignIn('demo@example.com', 'https://app.example/login?oobCode=x')

    expect(signInWithEmailLink).toHaveBeenCalledWith(
      { app: 'mock' },
      'demo@example.com',
      'https://app.example/login?oobCode=x',
    )
    expect(globalThis.localStorage.getItem(LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY)).toBeNull()
  })
})
