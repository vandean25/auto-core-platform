import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeDashboardSyncProvider } from './RealtimeDashboardSyncProvider'
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
    vi.clearAllMocks()
  })

  it('refreshes claims and invalidates active queries when auth claims change', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    render(<div />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(mocks.io).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/dashboard-realtime',
        expect.objectContaining({
          auth: { token: 'initial-token' },
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
      expect(invalidateQueries).toHaveBeenCalledWith({ refetchType: 'active' })
    })
  })
})