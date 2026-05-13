import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth'
import type { User, UserCredential } from 'firebase/auth'
import { authSessionKeys } from '@/api/auth-session'
import { firebaseAuth, firebaseConfigMissing } from '@/lib/firebase'
import { isE2EAuthBypassEnabled } from '@/lib/runtime-flags'

const allowedEmails = (import.meta.env.VITE_ALLOWED_LOGIN_EMAILS ?? '')
  .split(',')
  .map((email: string) => email.trim().toLowerCase())
  .filter(Boolean)

function assertAllowedUser(user: User) {
  if (allowedEmails.length === 0) {
    return
  }

  const email = user.email?.toLowerCase()
  if (!email || !allowedEmails.includes(email)) {
    throw new Error('This account is not allowed to access this app.')
  }
}

function shouldFallbackToRedirect(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const code = 'code' in error ? String((error as { code?: string }).code ?? '') : ''

  return [
    'auth/popup-blocked',
    'auth/popup-closed-by-user',
    'auth/cancelled-popup-request',
    'auth/operation-not-supported-in-this-environment',
  ].includes(code)
}

type AuthTokenResult = {
  claims: Record<string, unknown>
}

type AuthenticatedUser = {
  uid: string
  email: string | null
  displayName: string | null
  getIdToken: (forceRefresh?: boolean) => Promise<string>
  getIdTokenResult: (forceRefresh?: boolean) => Promise<AuthTokenResult>
}

type AuthContextValue = {
  user: AuthenticatedUser | null
  claims: AuthClaims | null
  loading: boolean
  isConfigured: boolean
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOutUser: () => Promise<void>
}

type AuthClaims = {
  tenantId?: string
  role?: string
  platformRole?: string
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = React.useState<AuthenticatedUser | null>(null)
  const [claims, setClaims] = React.useState<AuthClaims | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (isE2EAuthBypassEnabled()) {
      setUser({
        uid: 'e2e-test-user',
        email: 'testauto@auto.core.at',
        displayName: 'E2E Tester',
        getIdToken: async () => 'e2e-test-token',
        getIdTokenResult: async () => ({
          claims: {
            tenantId: 'e2e-tenant-id',
            role: 'ADMIN',
          },
        }),
      })
      setClaims({ tenantId: 'e2e-tenant-id', role: 'ADMIN' })
      setLoading(false)
      return
    }

    if (!firebaseAuth) {
      setClaims(null)
      setLoading(false)
      return
    }

    let active = true

    const unsubscribe = onIdTokenChanged(firebaseAuth, (nextUser) => {
      void (async () => {
        if (!active) return

        queryClient.removeQueries({ queryKey: authSessionKeys.all })

        setUser(nextUser)

        if (!nextUser) {
          setClaims(null)
          setLoading(false)
          return
        }

        try {
          const tokenResult = await nextUser.getIdTokenResult()
          if (!active) return
          setClaims(extractAuthClaims(tokenResult.claims))
          setLoading(false)
        } catch {
          if (!active) return
          setClaims(null)
          setUser(null)
          setLoading(false)
        }
      })()
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [queryClient])

  const signIn = React.useCallback(async (email: string, password: string) => {
    if (!firebaseAuth) {
      throw new Error('Firebase Authentication is not configured.')
    }

    const credential = await signInWithEmailAndPassword(firebaseAuth, email, password)

    try {
      assertAllowedUser(credential.user)
    } catch (error) {
      await signOut(firebaseAuth)
      throw error
    }
  }, [])

  const signInWithGoogle = React.useCallback(async () => {
    if (!firebaseAuth) {
      throw new Error('Firebase Authentication is not configured.')
    }

    const provider = new GoogleAuthProvider()
    let credential: UserCredential | null = null

    try {
      credential = await signInWithPopup(firebaseAuth, provider)
    } catch (error) {
      if (shouldFallbackToRedirect(error)) {
        await signInWithRedirect(firebaseAuth, provider)
        return
      }

      throw error
    }

    try {
      assertAllowedUser(credential.user)
    } catch (error) {
      await signOut(firebaseAuth)
      throw error
    }
  }, [])

  const signOutUser = React.useCallback(async () => {
    if (!firebaseAuth) {
      return
    }

    await signOut(firebaseAuth)
  }, [])

  const value = React.useMemo<AuthContextValue>(() => ({
    user,
    claims,
    loading,
    isConfigured: !firebaseConfigMissing,
    signIn,
    signInWithGoogle,
    signOutUser,
  }), [user, claims, loading, signIn, signInWithGoogle, signOutUser])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = React.useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.')
  }

  return context
}

function extractAuthClaims(rawClaims: Record<string, unknown>): AuthClaims {
  return {
    tenantId: typeof rawClaims.tenantId === 'string' ? rawClaims.tenantId : undefined,
    role: typeof rawClaims.role === 'string' ? rawClaims.role : undefined,
    platformRole:
      typeof rawClaims.platformRole === 'string' ? rawClaims.platformRole : undefined,
  }
}
