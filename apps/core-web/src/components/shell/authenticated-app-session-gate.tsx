import type * as React from 'react'
import { AuthSessionRevokedRedirect } from '@/components/shell/AuthSessionRevokedRedirect'
import { ShellSessionLoadFailed } from '@/components/shell/ShellSessionLoadFailed'
import type { AuthSession } from '@/api/auth-session'
import { isDemoGrantSessionErrorMessage } from '@/auth/landing-demo-email-link'
import LandingDemoSessionRejectedPage from '@/pages/LandingDemoSessionRejectedPage'
import { getHttpErrorStatus } from '@/lib/error-utils'

type SessionQuerySnapshot = {
  isError: boolean
  error: unknown
  data: AuthSession | undefined
}

export function resolveAuthenticatedSessionGate(
  sessionQuery: SessionQuerySnapshot,
  signOutUser: () => Promise<void>,
): React.ReactNode | null {
  if (!sessionQuery.isError) {
    return sessionQuery.data ? null : <ShellSessionLoadFailed />
  }

  if (getHttpErrorStatus(sessionQuery.error) === 401) {
    return <AuthSessionRevokedRedirect signOutUser={signOutUser} />
  }

  const message =
    sessionQuery.error instanceof Error ? sessionQuery.error.message : ''
  if (isDemoGrantSessionErrorMessage(message)) {
    return (
      <LandingDemoSessionRejectedPage onSignOut={() => void signOutUser()} />
    )
  }

  return sessionQuery.data ? null : <ShellSessionLoadFailed />
}
