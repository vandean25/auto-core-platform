import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authSessionKeys, useAuthSession, useSwitchTenant } from '@/api/auth-session'

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  getIdToken: vi.fn(),
  firebaseAuth: {
    currentUser: {
      uid: 'user-1',
      email: 'testauto@auto.core.at',
      getIdToken: vi.fn(),
    },
  },
}))

vi.mock('@/api/client', () => ({
  fetchWithAuth: mocks.fetchWithAuth,
}))

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: mocks.firebaseAuth,
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

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function SessionProbe() {
  const sessionQuery = useAuthSession()

  if (sessionQuery.isLoading) {
    return <div>Loading session</div>
  }

  return <div>{sessionQuery.data?.activeTenant.name ?? 'No session'}</div>
}

function MutationProbe() {
  const switchTenant = useSwitchTenant()

  return (
    <button type='button' onClick={() => void switchTenant.mutateAsync('tenant-b')}>
      Switch tenant
    </button>
  )
}

describe('useSwitchTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.firebaseAuth.currentUser = {
      uid: 'user-1',
      email: 'testauto@auto.core.at',
      getIdToken: mocks.getIdToken,
    }

    mocks.fetchWithAuth.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        userId: 'user-1',
        email: 'testauto@auto.core.at',
        activeTenant: {
          id: 'tenant-b',
          name: 'Auto Core Graz',
          slug: 'graz',
        },
        activeRole: 'SALES',
        memberships: [],
      }),
    })
    mocks.getIdToken.mockResolvedValue('refreshed-token')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not reuse a cached auth session from a different user', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 1000 * 60 * 5,
        },
        mutations: {
          retry: false,
        },
      },
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

    mocks.firebaseAuth.currentUser = {
      uid: 'user-2',
      email: 'second@auto.core.at',
      getIdToken: mocks.getIdToken,
    }
    mocks.fetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        userId: 'user-2',
        email: 'second@auto.core.at',
        activeTenant: {
          id: 'tenant-b',
          name: 'Auto Core Graz',
          slug: 'graz',
        },
        activeRole: 'SALES',
        memberships: [],
      }),
    })

    render(<SessionProbe />, { wrapper: createWrapper(queryClient) })

    expect(screen.queryByText('Auto Core Vienna')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Auto Core Graz')).toBeInTheDocument()
    })
  })

  it('refreshes the token and clears tenant-scoped queries after a successful switch', async () => {
    const queryClient = createQueryClient()
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    render(<MutationProbe />, { wrapper: createWrapper(queryClient) })

    fireEvent.click(screen.getByRole('button', { name: 'Switch tenant' }))

    await waitFor(() => {
      expect(mocks.fetchWithAuth).toHaveBeenCalledWith(
        '/api/auth/switch-tenant',
        expect.objectContaining({
          method: 'POST',
        }),
      )
      expect(mocks.getIdToken).toHaveBeenCalledWith(true)
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
      expect(invalidateQueries).toHaveBeenCalledWith({
        refetchType: 'active',
      })
    })
  })
})
