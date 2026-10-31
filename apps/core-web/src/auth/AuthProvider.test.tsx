import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authSessionKeys } from '@/api/auth-session'
import { AuthProvider, useAuth } from '@/auth/AuthProvider'

type MockAuthUser = {
  uid: string
  email: string | null
  displayName: string | null
  getIdToken: ReturnType<typeof vi.fn>
  getIdTokenResult: ReturnType<typeof vi.fn>
}

const pushMocks = vi.hoisted(() => ({
  releasePushRegistration: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/features/push/push-device', () => ({
  releasePushRegistration: pushMocks.releasePushRegistration,
}))

const mocks = vi.hoisted(() => ({
  authListener: null as ((user: MockAuthUser | null) => void) | null,
  unsubscribe: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(),
  onIdTokenChanged: vi.fn((_auth: unknown, callback: (user: MockAuthUser | null) => void) => {
    mocks.authListener = callback
    return mocks.unsubscribe
  }),
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
  signInWithPopup: mocks.signInWithPopup,
  signInWithRedirect: mocks.signInWithRedirect,
  signOut: mocks.signOut,
}))

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: {},
  firebaseConfigMissing: false,
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createUser(uid: string, email: string): MockAuthUser {
  return {
    uid,
    email,
    displayName: null,
    getIdToken: vi.fn(),
    getIdTokenResult: vi.fn().mockResolvedValue({
      claims: {
        tenantId: 'tenant-a',
        role: 'ADMIN',
      },
    }),
  }
}

function AuthActions({ onReady }: { onReady: (actions: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth()

  React.useEffect(() => {
    onReady(auth)
  }, [auth, onReady])

  return null
}

function AuthStateProbe() {
  const { authInitTimedOut, loading } = useAuth()

  if (authInitTimedOut && loading) {
    return <div>auth-init-timed-out</div>
  }

  if (loading) {
    return <div>auth-loading</div>
  }

  return <div>auth-ready</div>
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authListener = null
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('clears the query cache and user storage when the Firebase user signs out', async () => {
    const queryClient = createQueryClient()
    const clear = vi.spyOn(queryClient, 'clear')
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <div>ready</div>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await act(async () => {
      mocks.authListener?.(createUser('user-1', 'testauto@auto.core.at'))
    })

    await waitFor(() => {
      expect(clear).not.toHaveBeenCalled()
    })

    queryClient.setQueryData(authSessionKeys.all, {
      userId: 'user-1',
      email: 'testauto@auto.core.at',
      activeTenant: {
        id: 'tenant-a',
        name: 'Auto Core Vienna',
        slug: 'vienna',
      },
      activeRole: 'ADMIN',
      memberships: [],
    })
    window.localStorage.setItem('acp:saved-views:user-1', '[]')
    window.localStorage.setItem('acp.push.registration', 'device-1')

    await act(async () => {
      mocks.authListener?.(null)
    })

    await waitFor(() => {
      expect(cancelQueries).toHaveBeenCalled()
      expect(clear).toHaveBeenCalledTimes(1)
    })
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(pushMocks.releasePushRegistration).toHaveBeenCalled()
    expect(window.localStorage.getItem('acp:saved-views:user-1')).toBe('[]')
    expect(window.localStorage.getItem('acp.push.registration')).toBeNull()
  })

  it('keeps the query cache when the uid is unchanged (token refresh)', async () => {
    const queryClient = createQueryClient()
    const clear = vi.spyOn(queryClient, 'clear')

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <div>ready</div>
        </AuthProvider>
      </QueryClientProvider>,
    )

    const user = createUser('user-1', 'testauto@auto.core.at')

    await act(async () => {
      mocks.authListener?.(user)
    })

    await waitFor(() => {
      expect(clear).not.toHaveBeenCalled()
    })

    clear.mockClear()

    await act(async () => {
      mocks.authListener?.(user)
    })

    expect(clear).not.toHaveBeenCalled()
  })

  it('resets the client session before signing out through Firebase', async () => {
    const queryClient = createQueryClient()
    const clear = vi.spyOn(queryClient, 'clear')
    let actions: ReturnType<typeof useAuth> | null = null

    queryClient.setQueryData(['customers', 'list'], [{ id: 'customer-1' }])
    window.localStorage.setItem('acp:saved-views:user-1', '[]')

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthActions onReady={(nextActions) => {
            actions = nextActions
          }} />
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(actions).not.toBeNull()
    })

    await act(async () => {
      await actions!.signOutUser()
    })

    expect(clear).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(pushMocks.releasePushRegistration).toHaveBeenCalled()
    // The product decision for AUT-819 keeps per-user saved views across a sign-out.
    expect(window.localStorage.getItem('acp:saved-views:user-1')).toBe('[]')
    expect(mocks.signOut).toHaveBeenCalledWith({})
  })

  it('shows the auth init timeout screen when Firebase does not respond within 15 seconds', async () => {
    vi.useFakeTimers()
    const queryClient = createQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthStateProbe />
        </AuthProvider>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('auth-init-timed-out')).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(15_000)
    })

    expect(screen.getByText('auth-init-timed-out')).toBeInTheDocument()

    vi.useRealTimers()
  })

  it('falls back to redirect when popup sign-in is blocked', async () => {
    const queryClient = createQueryClient()
    const authError = { code: 'auth/popup-blocked', message: 'Popup blocked' }
    mocks.signInWithPopup.mockRejectedValueOnce(authError)
    mocks.signInWithRedirect.mockResolvedValueOnce(undefined)

    let actions: ReturnType<typeof useAuth> | null = null

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthActions onReady={(nextActions) => {
            actions = nextActions
          }} />
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(actions).not.toBeNull()
    })

    await act(async () => {
      await actions!.signInWithGoogle()
    })

    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1)
    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1)
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('sends a password reset email through Firebase', async () => {
    const queryClient = createQueryClient()
    let actions: ReturnType<typeof useAuth> | null = null

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthActions onReady={(nextActions) => {
            actions = nextActions
          }} />
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(actions).not.toBeNull()
    })

    await act(async () => {
      await actions!.sendPasswordResetEmail('user@example.com')
    })

    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith({}, 'user@example.com')
  })

  it('rejects a blank password reset email before contacting Firebase', async () => {
    const queryClient = createQueryClient()
    let actions: ReturnType<typeof useAuth> | null = null

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthActions onReady={(nextActions) => {
            actions = nextActions
          }} />
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(actions).not.toBeNull()
    })

    await expect(actions!.sendPasswordResetEmail('  ')).rejects.toThrow('Email is required.')
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled()
  })
})
