import { isLandingDemoSignInGrantInvalidError } from '@/auth/landing-demo-auth-session-error'
import {
  isLandingDemoEmailLinkExpiredError,
  readFirebaseAuthErrorCode,
} from '@/auth/landing-demo-email-link'

export type LandingDemoFailureReason =
  | 'grantInvalid'
  | 'invalidEmail'
  | 'retry'
  | 'unknown'

export type LandingDemoCompletionFailure = {
  reason: LandingDemoFailureReason
  showRequestNewLink: boolean
  showRetry: boolean
}

export function resolveLandingDemoCompletionFailure(
  error: unknown,
): LandingDemoCompletionFailure {
  if (
    isLandingDemoSignInGrantInvalidError(error) ||
    isLandingDemoEmailLinkExpiredError(error)
  ) {
    return {
      reason: 'grantInvalid',
      showRequestNewLink: true,
      showRetry: false,
    }
  }

  const code = readFirebaseAuthErrorCode(error)
  if (code === 'auth/missing-email' || code === 'auth/invalid-email') {
    return {
      reason: 'invalidEmail',
      showRequestNewLink: false,
      showRetry: false,
    }
  }

  return {
    reason: 'retry',
    showRequestNewLink: false,
    showRetry: true,
  }
}
