import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useIntakeDashboardPrefill } from './use-intake-dashboard-prefill'
import * as vehiclesApi from '@/api/vehicles'

vi.mock('@/api/vehicles', () => ({ useVehicle: vi.fn() }))
vi.mock('@/api/customers', () => ({
  useCustomer: () => ({ data: undefined, isLoading: false }),
}))

describe('useIntakeDashboardPrefill', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/workshop/intake?vehicleId=veh-1')
    vi.mocked(vehiclesApi.useVehicle).mockReturnValue({
      data: {
        id: 'veh-1',
        year: 2021,
        make: 'VW',
        model: 'Golf',
        customer: { id: 'cust-1' },
      },
      isLoading: false,
    } as ReturnType<typeof vehiclesApi.useVehicle>)
  })

  it('preselects the vehicle from the vehicleId search param', async () => {
    const setSelectedVehicle = vi.fn()
    renderHook(() =>
      useIntakeDashboardPrefill({
        search: '',
        setSearch: vi.fn(),
        setSelectedVehicle,
      }),
    )

    await waitFor(() =>
      expect(setSelectedVehicle).toHaveBeenCalledWith({
        id: 'veh-1',
        description: '2021 VW Golf',
        customerId: 'cust-1',
      }),
    )
  })
})
