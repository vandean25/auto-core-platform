import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inventoryKeys } from '@/api/inventory'
import { vehicleStockKeys } from '@/api/vehicle-stock'
import { workshopKeys } from '@/api/workshop'
import { fetchWithAuth } from './client'
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
        queryKey: vehicleStockKeys.all,
        refetchType: 'active',
      })
    })
  })
})
