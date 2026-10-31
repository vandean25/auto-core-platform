import type { QueryClient } from '@tanstack/react-query'
import { resetClientSession, runWithClientSessionPending } from '@/auth/client-session-reset'
import { extractAuthClaims, type AuthClaims } from '@/auth/auth-claims'
import { releasePushRegistration } from '@/features/push/push-device'

export type FirebaseIdTokenUser = {
  uid: string
  getIdTokenResult: (forceRefresh?: boolean) => Promise<{ claims: Record<string, unknown> }>
}

type MutableUidRef = { current: string | null | undefined }

export function shouldResetClientSessionOnUidChange(
  previousUid: string | null | undefined,
  nextUid: string | null,
): boolean {
  return previousUid !== nextUid && previousUid !== undefined
}

export async function applyFirebaseIdTokenChange(params: {
  nextUser: FirebaseIdTokenUser | null
  previousUidRef: MutableUidRef
  queryClient: QueryClient
  isActive: () => boolean
  onAuthInitTimedOutReset: () => void
  setUser: (user: FirebaseIdTokenUser | null) => void
  setClaims: (claims: AuthClaims | null) => void
  finishAuthInit: () => void
}): Promise<void> {
  if (!params.isActive()) {
    return
  }

  const nextUid = params.nextUser?.uid ?? null
  if (shouldResetClientSessionOnUidChange(params.previousUidRef.current, nextUid)) {
    // A uid change without an explicit sign-out still has to move this browser's push registration.
    await runWithClientSessionPending(async () => {
      await releasePushRegistration()
      // Drop every trace of the previous user before the next session is rendered.
      await resetClientSession(params.queryClient, 'session')
    })
    if (!params.isActive()) {
      return
    }
  }
  params.previousUidRef.current = nextUid

  params.onAuthInitTimedOutReset()
  params.setUser(params.nextUser)

  if (!params.nextUser) {
    params.setClaims(null)
    params.finishAuthInit()
    return
  }

  try {
    const tokenResult = await params.nextUser.getIdTokenResult()
    if (!params.isActive()) {
      return
    }
    params.setClaims(extractAuthClaims(tokenResult.claims))
    params.finishAuthInit()
  } catch {
    if (!params.isActive()) {
      return
    }
    params.setClaims(null)
    params.setUser(null)
    params.finishAuthInit()
  }
}
