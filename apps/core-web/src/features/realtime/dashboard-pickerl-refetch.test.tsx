import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authSessionKeys, type AuthSession } from '@/api/auth-session'
import { vehicleKeys } from '@/api/vehicles'
import { PickerlDueDashboardWidget } from '@/components/vehicles/PickerlDueDashboardWidget'
import { registerGermanUiForTests } from '@/test/german-ui'
import { RealtimeDashboardSyncProvider } from './RealtimeDashboardSyncProvider'
import { ENTITY_UPDATED_EVENT, SITE_CONTEXT_UPDATED_EVENT } from './types'

registerGermanUiForTests()

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  socket: { on: vi.fn(), off: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), active: false },
  useAuth: vi.fn(),
}))

vi.mock('socket.io-client', () => ({ io: vi.fn(() => mocks.socket) }))
vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: mocks.fetchWithAuth }))
vi.mock('@/auth/AuthProvider', () => ({ useAuth: mocks.useAuth }))
vi.mock('@/lib/firebase', () => ({
  firebaseAuth: { currentUser: { getIdToken: vi.fn().mockResolvedValue('token') } },
  firebaseConfigMissing: false,
}))

const WINDOWS = [30, 60, 90] as const

function session(activeSiteId: string | null): AuthSession {
  return { activeSiteId } as AuthSession
}

function Tiles() {
  return (
    <>
      {WINDOWS.map((window) => (
        <PickerlDueDashboardWidget key={window} window={window} />
      ))}
    </>
  )
}

function renderTiles(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <RealtimeDashboardSyncProvider>
        <MemoryRouter>
          <Tiles />
        </MemoryRouter>
      </RealtimeDashboardSyncProvider>
    </QueryClientProvider>,
  )
}

function handler(eventName: string) {
  return mocks.socket.on.mock.calls.find(([name]) => name === eventName)?.[1] as ((payload: unknown) => void) | undefined
}

function requestedUrls() {
  return mocks.fetchWithAuth.mock.calls.map(([url]) => url as string)
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    user: { uid: 'user-1', getIdToken: vi.fn().mockResolvedValue('token') },
    signOutUser: vi.fn(),
  })
  mocks.fetchWithAuth.mockImplementation(async () => new Response(JSON.stringify({ data: [], meta: { total: 4 } })))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('dashboard Pickerl tiles refetching (AUT-776)', () => {
  // Default staleTime 0, as in the realtime tests: the hook's own staleTime must carry the dedupe.
  function createClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } })
  }

  it('makes exactly one request per tile on load', async () => {
    renderTiles(createClient())

    await waitFor(() => expect(screen.getAllByText('4')).toHaveLength(3))
    for (const window of WINDOWS) {
      expect(requestedUrls().filter((url) => url.includes(`window=${window}`))).toHaveLength(1)
    }
    expect(requestedUrls()).toHaveLength(3)
    expect(new Set(requestedUrls()).size).toBe(3)
  })

  it('does not refetch when the tiles mount again within a minute', async () => {
    const queryClient = createClient()
    const first = renderTiles(queryClient)
    await waitFor(() => expect(screen.getAllByText('4')).toHaveLength(3))
    first.unmount()

    renderTiles(queryClient)
    await waitFor(() => expect(screen.getAllByText('4')).toHaveLength(3))

    expect(requestedUrls()).toHaveLength(3)
  })

  it('does not refetch on a site:context_updated that repeats the current site', async () => {
    const queryClient = createClient()
    queryClient.setQueryData(authSessionKeys.user('user-1'), session('site-1'))
    renderTiles(queryClient)
    await waitFor(() => expect(screen.getAllByText('4')).toHaveLength(3))
    await waitFor(() => expect(handler(SITE_CONTEXT_UPDATED_EVENT)).toBeDefined())

    await act(async () => {
      handler(SITE_CONTEXT_UPDATED_EVENT)?.({ siteId: 'site-1', timestamp: '2026-10-28T10:00:00.000Z' })
    })

    expect(requestedUrls()).toHaveLength(3)
  })

  it('does not refetch the tiles on a site switch either, because Pickerl counts are tenant-wide', async () => {
    const queryClient = createClient()
    queryClient.setQueryData(authSessionKeys.user('user-1'), session('site-1'))
    renderTiles(queryClient)
    await waitFor(() => expect(screen.getAllByText('4')).toHaveLength(3))
    await waitFor(() => expect(handler(SITE_CONTEXT_UPDATED_EVENT)).toBeDefined())

    await act(async () => {
      handler(SITE_CONTEXT_UPDATED_EVENT)?.({ siteId: 'site-2', timestamp: '2026-10-28T10:00:00.000Z' })
    })

    expect(requestedUrls()).toHaveLength(3)
  })

  it('still refetches the tiles when a vehicle changes', async () => {
    const queryClient = createClient()
    renderTiles(queryClient)
    await waitFor(() => expect(screen.getAllByText('4')).toHaveLength(3))
    await waitFor(() => expect(handler(ENTITY_UPDATED_EVENT)).toBeDefined())
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      handler(ENTITY_UPDATED_EVENT)?.({ type: 'VEHICLE', action: 'UPDATED', timestamp: '2026-10-28T10:00:00.000Z' })
    })

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: vehicleKeys.all })))
    await waitFor(() => expect(requestedUrls().length).toBeGreaterThan(3))
  })
})
