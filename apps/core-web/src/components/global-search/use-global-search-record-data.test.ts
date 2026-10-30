import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { useGlobalSearchRecordData } from './use-global-search-record-data'

vi.mock('@/api/client', () => ({ fetchWithAuth: vi.fn() }))
vi.mock('@/api/customers', () => ({ useCustomer: () => ({ isLoading: false }) }))
vi.mock('@/api/vehicles', () => ({ useVehicle: () => ({ isLoading: false }) }))
vi.mock('@/api/workshop', () => ({ useWorkshopOrder: () => ({ isLoading: false }) }))
vi.mock('@/api/workshop-estimates', () => ({ useWorkshopEstimateVersion: () => ({ isLoading: false }) }))

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return createElement(QueryClientProvider, { client }, children)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('tyre set palette record data', () => {
  it('fetches the active tyre set and includes its loading state and response', async () => {
    const record = {
      id: 'set-1', customerId: 'customer-1', vehicleId: 'vehicle-1', siteId: 'site-1',
      label: 'Winter set', season: 'WINTER', tyreCount: 4, rimType: 'ALLOY',
      dotCodes: [], status: 'IN_STORAGE',
    }
    vi.mocked(fetchWithAuth).mockResolvedValue(new Response(JSON.stringify(record)))
    const { result } = renderHook(
      () => useGlobalSearchRecordData({ entity: 'tyre_set', id: 'set-1' }, true),
      { wrapper },
    )
    expect(result.current.isLoadingContext).toBe(true)
    await waitFor(() => expect(result.current.tyreSet).toEqual(record))
    expect(fetchWithAuth).toHaveBeenCalledExactlyOnceWith('/api/tyre-sets/set-1')
    expect(result.current.isLoadingContext).toBe(false)
  })

  it.each([false, true])('does not fetch tyre sets without an enabled tyre set context (%s)', (enabled) => {
    renderHook(
      () => useGlobalSearchRecordData(enabled ? { entity: 'customer', id: 'customer-1' } : { entity: 'tyre_set', id: 'set-1' }, enabled),
      { wrapper },
    )
    expect(fetchWithAuth).not.toHaveBeenCalled()
  })
})
