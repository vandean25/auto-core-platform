import * as React from 'react'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import type { User } from 'firebase/auth'
import { firebaseAuth, firebaseConfigMissing } from '@/lib/firebase'

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

type AuthContextValue = {
  user: User | null
  loading: boolean
  isConfigured: boolean
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOutUser: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!firebaseAuth) {
      setLoading(false)
      return
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser)
      setLoading(false)
    })

    return unsubscribe
  }, [])

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
    const credential = await signInWithPopup(firebaseAuth, provider)

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
    loading,
    isConfigured: !firebaseConfigMissing,
    signIn,
    signInWithGoogle,
    signOutUser,
  }), [user, loading, signIn, signInWithGoogle, signOutUser])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = React.useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.')
  }

  return context
}
