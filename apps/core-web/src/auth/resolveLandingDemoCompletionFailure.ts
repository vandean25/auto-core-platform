import { isLandingDemoSignInGrantInvalidError } from '@/auth/landing-demo-auth-session-error'
import {
  demoGrantSessionRejectedMessageDe,
  describeLandingDemoEmailLinkError,
  isLandingDemoEmailLinkExpiredError,
  landingDemoEmailLinkRetryMessageDe,
} from '@/auth/landing-demo-email-link'

export type LandingDemoCompletionFailure = {
  message: string
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
      message: demoGrantSessionRejectedMessageDe(),
      showRequestNewLink: true,
      showRetry: false,
    }
  }

  const message = describeLandingDemoEmailLinkError(error)
  const isRetry = message === landingDemoEmailLinkRetryMessageDe()

  return {
    message,
    showRequestNewLink: false,
    showRetry: isRetry,
  }
}
