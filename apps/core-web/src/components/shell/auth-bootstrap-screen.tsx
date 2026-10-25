import type * as React from 'react'
import { AuthInitTimedOutScreen } from '@/components/shell/AuthInitTimedOutScreen'
import { AuthLoadingScreen } from '@/components/shell/AuthLoadingScreen'

type AuthBootstrapScreenInput = {
  authInitTimedOut: boolean
  loading: boolean
  awaitingInitialSession?: boolean
}

export function resolveAuthBootstrapScreen({
  authInitTimedOut,
  loading,
  awaitingInitialSession = false,
}: AuthBootstrapScreenInput): React.ReactNode | null {
  if (authInitTimedOut && loading) {
    return <AuthInitTimedOutScreen />
  }

  if (loading || awaitingInitialSession) {
    return <AuthLoadingScreen />
  }

  return null
}
