import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authSessionKeys } from '@/api/auth-session'
import {
  RealtimeDashboardSyncProvider,
  resolveRealtimeConnection,
} from './RealtimeDashboardSyncProvider'
import { AUTH_CLAIMS_UPDATED_EVENT } from './types'

const mocks = vi.hoisted(() => {
  const socket = {
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  }

  return {
    io: vi.fn(() => socket),
    socket,
    useAuth: vi.fn(),
    currentUser: {
      getIdToken: vi.fn(),
    },
  }
})

vi.mock('socket.io-client', () => ({
  io: mocks.io,
}))

vi.mock('@/api/client', () => ({
  API_BASE_URL: 'http://127.0.0.1:3000',
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: mocks.useAuth,
}))

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: {
    currentUser: mocks.currentUser,
  },
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

function createWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RealtimeDashboardSyncProvider>{children}</RealtimeDashboardSyncProvider>
    </QueryClientProvider>
  )
}

describe('RealtimeDashboardSyncProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const user = {
      uid: 'user-1',
      email: 'admin@autocore.com',
      displayName: 'Admin',
      getIdToken: vi.fn().mockResolvedValue('initial-token'),
      getIdTokenResult: vi.fn(),
    }

    mocks.currentUser.getIdToken.mockResolvedValue('refreshed-token')
    mocks.useAuth.mockReturnValue({
      user,
      signOutUser: vi.fn().mockResolvedValue(undefined),
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('does not open a socket connection when e2e auth bypass mode is enabled', async () => {
    vi.stubEnv('VITE_E2E_SKIP_AUTH', 'true')

    const queryClient = createQueryClient()

    render(<div />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(mocks.io).not.toHaveBeenCalled()
    })
  })

  it('uses the dedicated dev socket proxy path when only the browser origin is available', () => {
    expect(
      resolveRealtimeConnection({
        apiBaseUrl: '',
        currentOrigin: 'http://localhost:5173',
      }),
    ).toEqual({
      url: 'http://localhost:5173/dashboard-realtime',
      path: '/socket.io',
    })
  })

  it('uses the backend socket path when an API base URL is configured', () => {
    expect(
      resolveRealtimeConnection({
        apiBaseUrl: 'http://127.0.0.1:3000',
        currentOrigin: 'http://localhost:5173',
      }),
    ).toEqual({
      url: 'http://127.0.0.1:3000/dashboard-realtime',
      path: '/api/socket.io',
    })
  })

  it('refreshes claims and invalidates active queries when auth claims change', async () => {
    const queryClient = createQueryClient()
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    render(<div />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(mocks.io).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/dashboard-realtime',
        expect.objectContaining({
          auth: { token: 'initial-token' },
          path: '/api/socket.io',
        }),
      )
    })

    const claimsUpdatedHandler = mocks.socket.on.mock.calls.find(
      ([eventName]) => eventName === AUTH_CLAIMS_UPDATED_EVENT,
    )?.[1] as ((payload: unknown) => void) | undefined

    expect(claimsUpdatedHandler).toBeDefined()

    await act(async () => {
      claimsUpdatedHandler?.({
        reason: 'membership-updated',
        timestamp: '2026-04-23T15:00:00.000Z',
      })
    })

    await waitFor(() => {
      expect(mocks.currentUser.getIdToken).toHaveBeenCalledWith(true)
      expect(removeQueries).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'inactive',
          predicate: expect.any(Function),
        }),
      )
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: authSessionKeys.all,
        refetchType: 'active',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({ refetchType: 'active' })
    })
  })
})