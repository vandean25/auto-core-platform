import type { QueryClient } from '@tanstack/react-query'
import { authSessionKeys } from '@/api/auth-session'
import { extractAuthClaims, type AuthClaims } from '@/auth/auth-claims'

export type FirebaseIdTokenUser = {
  uid: string
  getIdTokenResult: (forceRefresh?: boolean) => Promise<{ claims: Record<string, unknown> }>
}

type MutableUidRef = { current: string | null | undefined }

export function shouldInvalidateAuthSessionOnUidChange(
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
  if (shouldInvalidateAuthSessionOnUidChange(params.previousUidRef.current, nextUid)) {
    params.queryClient.removeQueries({ queryKey: authSessionKeys.all })
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
