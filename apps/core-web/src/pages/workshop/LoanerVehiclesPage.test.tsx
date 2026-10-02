import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoanerVehiclesPage from './LoanerVehiclesPage'
import * as loanerApi from '@/api/loaner-vehicles'

vi.mock('@/api/loaner-vehicles')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

const mockFleetVehicle = {
  id: 'loaner-1',
  siteId: 'site-1',
  vehicleId: 'veh-1',
  displayName: 'Golf Ersatz',
  status: 'AVAILABLE' as const,
  dailyRateCents: null,
  insuranceNote: null,
  active: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  vehicle: {
    id: 'veh-1',
    make: 'VW',
    model: 'Golf',
    year: 2021,
    plate: 'W-LOAN 1',
    vin: null,
  },
}

describe('LoanerVehiclesPage', () => {
  beforeEach(() => {
    vi.mocked(loanerApi.useLoanerFleet).mockReturnValue({
      data: { data: [mockFleetVehicle] },
      isLoading: false,
    } as ReturnType<typeof loanerApi.useLoanerFleet>)

    vi.mocked(loanerApi.useOverdueLoanerBookings).mockReturnValue({
      data: {
        data: [
          {
            id: 'booking-overdue',
            loanerVehicleId: 'loaner-1',
            workshopOrderId: null,
            customerId: 'cust-1',
            plannedFrom: '2026-10-01T08:00:00.000Z',
            plannedTo: '2026-10-01T18:00:00.000Z',
            status: 'HANDED_OVER',
            handedOverAt: '2026-10-01T09:00:00.000Z',
            returnedAt: null,
            odometerOut: 1000,
            odometerIn: null,
            fuelOut: 80,
            fuelIn: null,
            driverLicenceChecked: true,
            licenceCheckedById: null,
            notes: null,
            createdAt: '2026-10-01T07:00:00.000Z',
            updatedAt: '2026-10-01T09:00:00.000Z',
            customer: {
              id: 'cust-1',
              firstName: 'Pilot',
              lastName: 'Customer',
              companyName: null,
            },
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof loanerApi.useOverdueLoanerBookings>)

    vi.mocked(loanerApi.useLoanerBookings).mockReturnValue({
      data: { data: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof loanerApi.useLoanerBookings>)

    vi.mocked(loanerApi.useCreateLoanerVehicle).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof loanerApi.useCreateLoanerVehicle>)

    vi.mocked(loanerApi.useCreateLoanerBooking).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof loanerApi.useCreateLoanerBooking>)

    vi.mocked(loanerApi.useCancelLoanerBooking).mockReturnValue({
      mutate: vi.fn(),
    } as unknown as ReturnType<typeof loanerApi.useCancelLoanerBooking>)

    vi.mocked(loanerApi.useHandOverLoanerBooking).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof loanerApi.useHandOverLoanerBooking>)

    vi.mocked(loanerApi.useReturnLoanerBooking).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof loanerApi.useReturnLoanerBooking>)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders fleet header with overdue badge', () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <LoanerVehiclesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Ersatzfahrzeuge' })).toBeInTheDocument()
    expect(screen.getByText('1 überfällig')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ersatzfahrzeug$/ })).toBeInTheDocument()
    expect(screen.getByText('Golf Ersatz')).toBeInTheDocument()
  })
})
