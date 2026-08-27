import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
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

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authListener = null
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('clears cached auth-session queries whenever the Firebase auth user changes', async () => {
    const queryClient = createQueryClient()
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')

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
      expect(removeQueries).toHaveBeenCalledWith({
        queryKey: authSessionKeys.all,
      })
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

    await act(async () => {
      mocks.authListener?.(null)
    })

    await waitFor(() => {
      expect(removeQueries).toHaveBeenCalledTimes(2)
    })
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
