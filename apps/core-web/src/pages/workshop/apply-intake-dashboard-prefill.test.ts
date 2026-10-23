// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { applyIntakeDashboardPrefill } from './apply-intake-dashboard-prefill'

const VEHICLE_ID = 'e0000000-0000-4000-8000-000000000002'
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000001'

describe('applyIntakeDashboardPrefill', () => {
  it('skips when the user already typed in the search box', () => {
    const setSelectedVehicle = vi.fn()
    const setSearch = vi.fn()

    expect(
      applyIntakeDashboardPrefill({
        prefill: { vehicleId: VEHICLE_ID },
        vehicle: {
          id: VEHICLE_ID,
          year: 2021,
          make: 'VW',
          model: 'Golf',
          customer: { id: CUSTOMER_ID },
        } as import('@/api/types').Vehicle,
        customer: undefined,
        search: 'W-123',
        selectedVehicle: null,
        setSearch,
        setSelectedVehicle,
      }),
    ).toBe('skipped')

    expect(setSelectedVehicle).not.toHaveBeenCalled()
    expect(setSearch).not.toHaveBeenCalled()
  })

  it('skips when a vehicle is already selected', () => {
    const setSelectedVehicle = vi.fn()

    expect(
      applyIntakeDashboardPrefill({
        prefill: { vehicleId: VEHICLE_ID },
        vehicle: {
          id: VEHICLE_ID,
          year: 2021,
          make: 'VW',
          model: 'Golf',
          customer: { id: CUSTOMER_ID },
        } as import('@/api/types').Vehicle,
        customer: undefined,
        search: '',
        selectedVehicle: {
          id: 'other-veh',
          description: 'Other',
          customerId: CUSTOMER_ID,
        },
        setSearch: vi.fn(),
        setSelectedVehicle,
      }),
    ).toBe('skipped')

    expect(setSelectedVehicle).not.toHaveBeenCalled()
  })
})
