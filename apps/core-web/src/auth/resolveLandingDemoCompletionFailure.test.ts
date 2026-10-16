import { describe, expect, it } from 'vitest'
import {
  LandingDemoAuthSessionError,
  LANDING_DEMO_SIGN_IN_GRANT_INVALID_CODE,
} from '@/auth/landing-demo-auth-session-error'
import { resolveLandingDemoCompletionFailure } from '@/auth/resolveLandingDemoCompletionFailure'

describe('resolveLandingDemoCompletionFailure', () => {
  it('maps demo grant rejection to grantInvalid with a new-link action', () => {
    const failure = resolveLandingDemoCompletionFailure(
      new LandingDemoAuthSessionError(
        'Demo sign-in link is missing, expired, or already used.',
        LANDING_DEMO_SIGN_IN_GRANT_INVALID_CODE,
      ),
    )

    expect(failure.reason).toBe('grantInvalid')
    expect(failure.showRequestNewLink).toBe(true)
    expect(failure.showRetry).toBe(false)
  })

  it('maps network errors to retry without a new-link action', () => {
    const failure = resolveLandingDemoCompletionFailure({
      code: 'auth/network-request-failed',
    })

    expect(failure.reason).toBe('retry')
    expect(failure.showRequestNewLink).toBe(false)
    expect(failure.showRetry).toBe(true)
  })
})
