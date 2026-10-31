import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
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

function CustomerRowsProbe() {
  const { data } = useQuery({
    queryKey: ['customers', 'list'],
    queryFn: async () => {
      const response = await fetchWithAuth('/api/customers')
      return (await response.json()) as Array<{ id: string }>
    },
  })

  return (
    <ul>
      {(data ?? []).map((customer) => (
        <li key={customer.id}>{customer.id}</li>
      ))}
    </ul>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('useSetActiveSite', () => {
  afterEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
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

  it('keeps the same user\'s saved views, dashboard layout and push registration after a switch', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ activeSiteId: 'site-new' }),
    } as unknown as Response)
    window.localStorage.setItem('acp:saved-views:user-1', '[]')
    window.localStorage.setItem('acp:dashboard-widgets:user-1', '[]')
    window.localStorage.setItem('acp.push.registration', 'device-1')

    render(<SwitchSiteProbe />, { wrapper: createWrapper(createQueryClient()) })
    fireEvent.click(screen.getByRole('button', { name: 'Switch site' }))

    await waitFor(() => expect(screen.getByText('Idle')).toBeInTheDocument())
    expect(window.localStorage.getItem('acp:saved-views:user-1')).toBe('[]')
    expect(window.localStorage.getItem('acp:dashboard-widgets:user-1')).toBe('[]')
    expect(window.localStorage.getItem('acp.push.registration')).toBe('device-1')
  })

  it('drops a list response from the site being left that resolves after the switch', async () => {
    const listResponse = deferred<Array<{ id: string }>>()
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (url === '/api/me/active-site') {
        return { ok: true, json: vi.fn().mockResolvedValue({ activeSiteId: 'site-new' }) } as unknown as Response
      }
      if (url === '/api/customers') {
        return { ok: true, json: () => listResponse.promise } as unknown as Response
      }
      throw new Error(`Unexpected request: ${String(url)}`)
    })
    const queryClient = createQueryClient()

    render(
      <>
        <SwitchSiteProbe />
        <CustomerRowsProbe />
      </>,
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledWith('/api/customers'))

    fireEvent.click(screen.getByRole('button', { name: 'Switch site' }))
    await waitFor(() => expect(queryClient.getQueryCache().getAll()).toHaveLength(0))

    await act(async () => {
      listResponse.resolve([{ id: 'customer-of-the-old-site' }])
      await Promise.resolve()
    })

    expect(queryClient.getQueryData(['customers', 'list'])).toBeUndefined()
    expect(screen.queryByText('customer-of-the-old-site')).not.toBeInTheDocument()
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
