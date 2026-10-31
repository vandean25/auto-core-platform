import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function RoleProbe() {
  const sessionQuery = useAuthSession()

  if (sessionQuery.isLoading) {
    return <div>Loading session</div>
  }

  return <div>{sessionQuery.data?.activeRole ?? 'No role'}</div>
}

function MutationProbe() {
  const switchTenant = useSwitchTenant()

  return (
    <button type='button' onClick={() => void switchTenant.mutateAsync('tenant-b')}>
      Switch tenant
    </button>
  )
}

function PendingProbe() {
  const switchTenant = useSwitchTenant()

  return (
    <>
      <div>{switchTenant.isPending ? 'Switching tenant' : 'Idle'}</div>
      <button type='button' onClick={() => void switchTenant.mutateAsync('tenant-b')}>
        Switch tenant
      </button>
    </>
  )
}

const switchedSessionResponse = {
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
}

describe('useSwitchTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    mocks.firebaseAuth.currentUser = {
      uid: 'user-1',
      email: 'testauto@auto.core.at',
      getIdToken: mocks.getIdToken,
    }

    mocks.fetchWithAuth.mockResolvedValue(switchedSessionResponse)
    mocks.getIdToken.mockResolvedValue('refreshed-token')
  })

  afterEach(() => {
    window.history.pushState({}, '', '/')
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('returns a local auth session in E2E mode without calling the API', async () => {
    vi.stubEnv('MODE', 'test')
    vi.stubEnv('VITE_E2E_SKIP_AUTH', 'true')

    const queryClient = createQueryClient()

    render(<SessionProbe />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(screen.getByText('Auto Core E2E Tenant')).toBeInTheDocument()
    })

    expect(mocks.fetchWithAuth).not.toHaveBeenCalled()
  })

  it('uses TECH for the E2E session on mechanic routes', async () => {
    vi.stubEnv('MODE', 'test')
    vi.stubEnv('VITE_E2E_SKIP_AUTH', 'true')
    window.history.pushState({}, '', '/mechanic/queue')

    const queryClient = createQueryClient()

    render(<RoleProbe />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(screen.getByText('TECH')).toBeInTheDocument()
    })
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

  it('refreshes the token and resets the context but keeps the same user\'s views after a successful switch', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(authSessionKeys.user('user-1'), {
      userId: 'user-1',
      email: 'testauto@auto.core.at',
      activeTenant: { id: 'tenant-a', name: 'Auto Core Vienna', slug: 'vienna' },
      activeRole: 'ADMIN',
      memberships: [],
    })
    queryClient.setQueryData(['customers', 'list'], [{ id: 'customer-1' }])
    window.localStorage.setItem('acp:saved-views:user-1', '[]')
    window.localStorage.setItem('acp:dashboard-widgets:user-1', '[]')
    window.localStorage.setItem('acp.push.registration', 'device-1')
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')
    const clear = vi.spyOn(queryClient, 'clear')

    render(<MutationProbe />, { wrapper: createWrapper(queryClient) })

    fireEvent.click(screen.getByRole('button', { name: 'Switch tenant' }))

    await waitFor(() => {
      expect(mocks.fetchWithAuth).toHaveBeenCalledWith(
        '/api/auth/switch-tenant',
        expect.objectContaining({
          method: 'POST',
        }),
      )
      expect(clear).toHaveBeenCalledTimes(1)
    })

    expect(mocks.getIdToken).toHaveBeenCalledWith(true)
    expect(mocks.getIdToken.mock.invocationCallOrder[0]).toBeLessThan(clear.mock.invocationCallOrder[0])
    expect(cancelQueries).toHaveBeenCalled()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(window.localStorage.getItem('acp:saved-views:user-1')).toBe('[]')
    expect(window.localStorage.getItem('acp:dashboard-widgets:user-1')).toBe('[]')
    expect(window.localStorage.getItem('acp.push.registration')).toBe('device-1')
  })

  it('stays pending while the tenant switch is in flight', async () => {
    let resolveFetch!: (value: unknown) => void
    mocks.fetchWithAuth.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const queryClient = createQueryClient()

    render(<PendingProbe />, { wrapper: createWrapper(queryClient) })

    fireEvent.click(screen.getByRole('button', { name: 'Switch tenant' }))

    await waitFor(() => {
      expect(screen.getByText('Switching tenant')).toBeInTheDocument()
    })

    await act(async () => {
      resolveFetch(switchedSessionResponse)
    })

    await waitFor(() => {
      expect(screen.getByText('Idle')).toBeInTheDocument()
    })
  })
})
