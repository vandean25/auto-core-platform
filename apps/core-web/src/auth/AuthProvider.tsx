import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  GoogleAuthProvider,
  onIdTokenChanged,
  sendPasswordResetEmail as sendFirebasePasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth'
import { firebaseAuth, firebaseConfigMissing } from '@/lib/firebase'
import type { AuthClaims } from '@/auth/auth-claims'
import { applyFirebaseIdTokenChange } from '@/auth/firebase-id-token-change'
import {
  getE2ETestToken,
  isE2EAuthBypassEnabled,
  isE2ETestTokenAuthEnabled,
} from '@/lib/runtime-flags'

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

const AUTH_INIT_WATCHDOG_MS = 15_000

type AuthContextValue = {
  user: AuthenticatedUser | null
  claims: AuthClaims | null
  loading: boolean
  authInitTimedOut: boolean
  isConfigured: boolean
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  sendPasswordResetEmail: (email: string) => Promise<void>
  signOutUser: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = React.useState<AuthenticatedUser | null>(null)
  const [claims, setClaims] = React.useState<AuthClaims | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [authInitTimedOut, setAuthInitTimedOut] = React.useState(false)
  const previousUidRef = React.useRef<string | null | undefined>(undefined)

  React.useEffect(() => {
    if (isE2ETestTokenAuthEnabled()) {
      const testToken = getE2ETestToken()
      if (!testToken) {
        setLoading(false)
        return
      }

      setUser({
        uid: 'e2e-fullstack-user',
        email: 'e2e-fullstack@auto.core.test',
        displayName: 'E2E Fullstack',
        getIdToken: async () => testToken,
        getIdTokenResult: async () => ({ claims: {} }),
      })
      setClaims(null)
      setLoading(false)
      return
    }

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
    let authInitPending = true
    setAuthInitTimedOut(false)

    const finishAuthInit = () => {
      authInitPending = false
      setLoading(false)
    }

    const watchdog = window.setTimeout(() => {
      if (!active || !authInitPending) return
      setAuthInitTimedOut(true)
    }, AUTH_INIT_WATCHDOG_MS)

    const unsubscribe = onIdTokenChanged(firebaseAuth, (nextUser) => {
      void applyFirebaseIdTokenChange({
        nextUser,
        previousUidRef,
        queryClient,
        isActive: () => active,
        onAuthInitTimedOutReset: () => setAuthInitTimedOut(false),
        setUser: (next) => setUser(next as AuthenticatedUser | null),
        setClaims,
        finishAuthInit,
      })
    })

    return () => {
      active = false
      window.clearTimeout(watchdog)
      unsubscribe()
    }
  }, [queryClient])

  const signIn = React.useCallback(async (email: string, password: string) => {
    if (!firebaseAuth) {
      throw new Error('Firebase Authentication is not configured.')
    }

    await signInWithEmailAndPassword(firebaseAuth, email, password)
  }, [])

  const signInWithGoogle = React.useCallback(async () => {
    if (!firebaseAuth) {
      throw new Error('Firebase Authentication is not configured.')
    }

    const provider = new GoogleAuthProvider()

    try {
      await signInWithPopup(firebaseAuth, provider)
    } catch (error) {
      if (shouldFallbackToRedirect(error)) {
        await signInWithRedirect(firebaseAuth, provider)
        return
      }

      throw error
    }
  }, [])

  const sendPasswordResetEmail = React.useCallback(async (email: string) => {
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      throw new Error('Email is required.')
    }

    if (!firebaseAuth) {
      throw new Error('Firebase Authentication is not configured.')
    }

    await sendFirebasePasswordResetEmail(firebaseAuth, normalizedEmail)
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
    authInitTimedOut,
    isConfigured: !firebaseConfigMissing,
    signIn,
    signInWithGoogle,
    sendPasswordResetEmail,
    signOutUser,
  }), [user, claims, loading, authInitTimedOut, signIn, signInWithGoogle, sendPasswordResetEmail, signOutUser])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = React.useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.')
  }

  return context
}

