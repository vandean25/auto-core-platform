import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from './client'
import { consumeLocalSiteSwitch } from './local-site-switch'
import { useSetActiveSite } from './sites'

vi.mock('./client', () => ({
  fetchWithAuth: vi.fn(),
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

function SwitchSiteProbe() {
  const mutation = useSetActiveSite()

  return (
    <>
      <div>{mutation.isPending ? 'Switching site' : 'Idle'}</div>
      <button type="button" onClick={() => void mutation.mutateAsync('site-new')}>
        Switch site
      </button>
    </>
  )
}

describe('useSetActiveSite', () => {
  afterEach(() => {
    vi.clearAllMocks()
    consumeLocalSiteSwitch('site-new')
  })

  it('marks the switch as this tab\'s own before the request is sent, so the realtime event that answers it can be skipped', async () => {
    let markedWhenRequested: boolean | undefined
    vi.mocked(fetchWithAuth).mockImplementation(async () => {
      markedWhenRequested = consumeLocalSiteSwitch('site-new')
      return { ok: true, json: vi.fn().mockResolvedValue({ activeSiteId: 'site-new' }) } as unknown as Response
    })
    const queryClient = createQueryClient()
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)

    render(<SwitchSiteProbe />, { wrapper: createWrapper(queryClient) })
    fireEvent.click(screen.getByRole('button', { name: 'Switch site' }))

    await waitFor(() => expect(markedWhenRequested).toBe(true))
  })

  it('forgets the mark when the switch fails, so a later event from another window is not skipped', async () => {
    vi.mocked(fetchWithAuth).mockRejectedValue(new Error('offline'))
    const queryClient = createQueryClient()

    const { result } = renderHook(() => useSetActiveSite(), { wrapper: createWrapper(queryClient) })
    act(() => result.current.mutate('site-new'))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(consumeLocalSiteSwitch('site-new')).toBe(false)
  })

  it('drops every cached query, including families outside the old hard-coded set, after a successful switch', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ activeSiteId: 'site-new' }),
    } as unknown as Response)

    const queryClient = createQueryClient()
    queryClient.setQueryData(['workshop', 'orders'], [{ id: 'order-1' }])
    queryClient.setQueryData(['customers', 'list'], [{ id: 'customer-1' }])
    queryClient.setQueryData(['auth-session', 'user-1'], { userId: 'user-1', activeSiteId: 'site-old' })
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries')
    const clear = vi.spyOn(queryClient, 'clear')

    render(<SwitchSiteProbe />, { wrapper: createWrapper(queryClient) })
    fireEvent.click(screen.getByRole('button', { name: 'Switch site' }))

    await waitFor(() => {
      expect(clear).toHaveBeenCalledTimes(1)
    })

    expect(cancelQueries).toHaveBeenCalled()
    expect(cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(clear.mock.invocationCallOrder[0])
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('stays pending while the site switch is in flight', async () => {
    let resolveFetch!: (value: Response) => void
    vi.mocked(fetchWithAuth).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    render(<SwitchSiteProbe />, { wrapper: createWrapper(createQueryClient()) })
    fireEvent.click(screen.getByRole('button', { name: 'Switch site' }))

    await waitFor(() => {
      expect(screen.getByText('Switching site')).toBeInTheDocument()
    })

    await act(async () => {
      resolveFetch({ ok: true, json: vi.fn().mockResolvedValue({ activeSiteId: 'site-new' }) } as unknown as Response)
    })

    await waitFor(() => {
      expect(screen.getByText('Idle')).toBeInTheDocument()
    })
  })
})
