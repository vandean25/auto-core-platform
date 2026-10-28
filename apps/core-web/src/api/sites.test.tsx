import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inventoryKeys } from '@/api/inventory'
import { stockTransferKeys } from '@/api/stock-transfers'
import { vehicleStockKeys } from '@/api/vehicle-stock'
import { workshopKeys } from '@/api/workshop'
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
    <button type="button" onClick={() => void mutation.mutateAsync('site-new')}>
      Switch site
    </button>
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

  it('invalidates operational caches after a successful HTTP switch', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ activeSiteId: 'site-new' }),
    } as unknown as Response)

    const queryClient = createQueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    render(<SwitchSiteProbe />, { wrapper: createWrapper(queryClient) })
    fireEvent.click(screen.getByRole('button', { name: 'Switch site' }))

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: workshopKeys.all,
        refetchType: 'active',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: inventoryKeys.all,
        refetchType: 'active',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: stockTransferKeys.all,
        refetchType: 'active',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: vehicleStockKeys.all,
        refetchType: 'active',
      })
    })
  })
})
