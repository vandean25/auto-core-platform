import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useIntakeDashboardPrefill } from './use-intake-dashboard-prefill'
import * as vehiclesApi from '@/api/vehicles'
import * as customersApi from '@/api/customers'

const VEHICLE_ID = 'e0000000-0000-4000-8000-000000000002'
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000001'

vi.mock('@/api/vehicles', () => ({ useVehicle: vi.fn() }))
vi.mock('@/api/customers', () => ({ useCustomer: vi.fn() }))

describe('useIntakeDashboardPrefill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(customersApi.useCustomer).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof customersApi.useCustomer>)
  })

  it('preselects the vehicle from a UUID vehicleId search param', async () => {
    window.history.replaceState({}, '', `/workshop/intake?vehicleId=${VEHICLE_ID}`)
    vi.mocked(vehiclesApi.useVehicle).mockReturnValue({
      data: {
        id: VEHICLE_ID,
        year: 2021,
        make: 'VW',
        model: 'Golf',
        customer: { id: CUSTOMER_ID },
      },
      isLoading: false,
    } as ReturnType<typeof vehiclesApi.useVehicle>)

    const setSelectedVehicle = vi.fn()
    renderHook(() =>
      useIntakeDashboardPrefill({
        search: '',
        selectedVehicle: null,
        setSearch: vi.fn(),
        setSelectedVehicle,
      }),
    )

    await waitFor(() =>
      expect(setSelectedVehicle).toHaveBeenCalledWith({
        id: VEHICLE_ID,
        description: '2021 VW Golf',
        customerId: CUSTOMER_ID,
      }),
    )
    expect(vehiclesApi.useVehicle).toHaveBeenCalledWith(VEHICLE_ID)
  })

  it('does not call useVehicle with a non-UUID vehicleId', () => {
    window.history.replaceState({}, '', '/workshop/intake?vehicleId=veh-1')
    vi.mocked(vehiclesApi.useVehicle).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof vehiclesApi.useVehicle>)

    renderHook(() =>
      useIntakeDashboardPrefill({
        search: '',
        selectedVehicle: null,
        setSearch: vi.fn(),
        setSelectedVehicle: vi.fn(),
      }),
    )

    expect(vehiclesApi.useVehicle).toHaveBeenCalledWith('')
  })

  it('does not fetch the customer when vehicleId is present on the URL', () => {
    window.history.replaceState(
      {},
      '',
      `/workshop/intake?vehicleId=${VEHICLE_ID}&customerId=${CUSTOMER_ID}`,
    )
    vi.mocked(vehiclesApi.useVehicle).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof vehiclesApi.useVehicle>)

    renderHook(() =>
      useIntakeDashboardPrefill({
        search: '',
        selectedVehicle: null,
        setSearch: vi.fn(),
        setSelectedVehicle: vi.fn(),
      }),
    )

    expect(customersApi.useCustomer).toHaveBeenCalledWith('')
  })

  it('preselects the only vehicle for a customerId prefill', async () => {
    window.history.replaceState({}, '', `/workshop/intake?customerId=${CUSTOMER_ID}`)
    vi.mocked(vehiclesApi.useVehicle).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof vehiclesApi.useVehicle>)
    vi.mocked(customersApi.useCustomer).mockReturnValue({
      data: {
        id: CUSTOMER_ID,
        first_name: 'Erika',
        last_name: 'Example',
        type: 'PERSON',
        vehicles: [{ id: VEHICLE_ID, make: 'VW', model: 'Golf', plate: 'W-1' }],
      },
      isLoading: false,
    } as ReturnType<typeof customersApi.useCustomer>)

    const setSelectedVehicle = vi.fn()
    renderHook(() =>
      useIntakeDashboardPrefill({
        search: '',
        selectedVehicle: null,
        setSearch: vi.fn(),
        setSelectedVehicle,
      }),
    )

    await waitFor(() =>
      expect(setSelectedVehicle).toHaveBeenCalledWith({
        id: VEHICLE_ID,
        description: 'VW Golf',
        customerId: CUSTOMER_ID,
      }),
    )
    expect(customersApi.useCustomer).toHaveBeenCalledWith(CUSTOMER_ID)
  })

  it('seeds search with the customer name when several vehicles exist', async () => {
    window.history.replaceState({}, '', `/workshop/intake?customerId=${CUSTOMER_ID}`)
    vi.mocked(customersApi.useCustomer).mockReturnValue({
      data: {
        id: CUSTOMER_ID,
        first_name: 'Erika',
        last_name: 'Example',
        type: 'PERSON',
        vehicles: [
          { id: VEHICLE_ID, make: 'VW', model: 'Golf', plate: 'W-1' },
          { id: 'e0000000-0000-4000-8000-000000000099', make: 'Audi', model: 'A3', plate: 'W-2' },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof customersApi.useCustomer>)

    const setSearch = vi.fn()
    renderHook(() =>
      useIntakeDashboardPrefill({
        search: '',
        selectedVehicle: null,
        setSearch,
        setSelectedVehicle: vi.fn(),
      }),
    )

    await waitFor(() => expect(setSearch).toHaveBeenCalledWith('Erika Example'))
  })
})
