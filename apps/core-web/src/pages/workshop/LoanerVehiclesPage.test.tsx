import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoanerVehiclesPage from './LoanerVehiclesPage'
import * as loanerApi from '@/api/loaner-vehicles'
import * as workshopApi from '@/api/workshop'

vi.mock('@/api/loaner-vehicles')
vi.mock('@/api/workshop')
vi.mock('@/components/sales/CustomerSearch', () => ({
  CustomerSearch: ({
    onChange,
  }: {
    onChange: (customer: { id: string; last_name: string }) => void
  }) => (
    <button
      type='button'
      data-testid='customer-search'
      onClick={() => onChange({ id: 'cust-1', last_name: 'Customer' })}
    >
      Kunde wählen
    </button>
  ),
}))
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

const reservedBooking = {
  id: 'booking-reserved',
  loanerVehicleId: 'loaner-1',
  workshopOrderId: null,
  customerId: 'cust-1',
  plannedFrom: '2026-10-10T08:00:00.000Z',
  plannedTo: '2026-10-12T18:00:00.000Z',
  status: 'RESERVED' as const,
  handedOverAt: null,
  returnedAt: null,
  odometerOut: null,
  odometerIn: null,
  fuelOut: null,
  fuelIn: null,
  driverLicenceChecked: false,
  licenceCheckedById: null,
  notes: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  updatedAt: '2026-10-09T10:00:00.000Z',
  customer: {
    id: 'cust-1',
    firstName: 'Pilot',
    lastName: 'Customer',
    companyName: null,
  },
}

const handedOverBooking = {
  ...reservedBooking,
  id: 'booking-handed',
  status: 'HANDED_OVER' as const,
  handedOverAt: '2026-10-10T09:00:00.000Z',
  odometerOut: 1000,
  fuelOut: 80,
  driverLicenceChecked: true,
}

describe('LoanerVehiclesPage', () => {
  const createBookingMutate = vi.fn()
  const handOverMutate = vi.fn()
  const returnMutate = vi.fn()

  beforeEach(() => {
    createBookingMutate.mockResolvedValue({})
    handOverMutate.mockResolvedValue({})
    returnMutate.mockResolvedValue({})

    vi.mocked(workshopApi.useWorkshopSearch).mockReturnValue({
      data: { data: { vehicles: [], customers: [] }, meta: { total: 0, page: 1, limit: 0, totalPages: 0 } },
      isLoading: false,
    } as unknown as ReturnType<typeof workshopApi.useWorkshopSearch>)

    vi.mocked(workshopApi.useWorkshopOrders).mockReturnValue({
      data: { data: [], meta: { total: 0, page: 1, pageSize: 50, pageCount: 0 } },
      isLoading: false,
    } as unknown as ReturnType<typeof workshopApi.useWorkshopOrders>)

    vi.mocked(loanerApi.useLoanerFleet).mockReturnValue({
      data: { data: [mockFleetVehicle] },
      isLoading: false,
    } as ReturnType<typeof loanerApi.useLoanerFleet>)

    vi.mocked(loanerApi.useOverdueLoanerBookings).mockReturnValue({
      data: { data: [] },
      isLoading: false,
    } as ReturnType<typeof loanerApi.useOverdueLoanerBookings>)

    vi.mocked(loanerApi.useLoanerBookings).mockReturnValue({
      data: { data: [reservedBooking] },
      isLoading: false,
    } as unknown as ReturnType<typeof loanerApi.useLoanerBookings>)

    vi.mocked(loanerApi.useCreateLoanerVehicle).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof loanerApi.useCreateLoanerVehicle>)

    vi.mocked(loanerApi.useCreateLoanerBooking).mockReturnValue({
      mutateAsync: createBookingMutate,
      isPending: false,
    } as unknown as ReturnType<typeof loanerApi.useCreateLoanerBooking>)

    vi.mocked(loanerApi.useCancelLoanerBooking).mockReturnValue({
      mutate: vi.fn(),
    } as unknown as ReturnType<typeof loanerApi.useCancelLoanerBooking>)

    vi.mocked(loanerApi.useHandOverLoanerBooking).mockReturnValue({
      mutateAsync: handOverMutate,
      isPending: false,
    } as unknown as ReturnType<typeof loanerApi.useHandOverLoanerBooking>)

    vi.mocked(loanerApi.useReturnLoanerBooking).mockReturnValue({
      mutateAsync: returnMutate,
      isPending: false,
    } as unknown as ReturnType<typeof loanerApi.useReturnLoanerBooking>)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  function renderPage(initialPath = '/workshop/loaner-vehicles?vehicle=loaner-1') {
    return render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[initialPath]}>
          <LoanerVehiclesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders fleet header with overdue badge', () => {
    vi.mocked(loanerApi.useOverdueLoanerBookings).mockReturnValue({
      data: {
        data: [
          {
            ...handedOverBooking,
            id: 'booking-overdue',
            plannedTo: '2026-10-01T18:00:00.000Z',
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof loanerApi.useOverdueLoanerBookings>)

    renderPage()

    expect(screen.getByRole('heading', { name: 'Ersatzfahrzeuge' })).toBeInTheDocument()
    expect(screen.getByText('1 überfällig')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ersatzfahrzeug$/ })).toBeInTheDocument()
    expect(screen.getByText('Golf Ersatz')).toBeInTheDocument()
  })

  it('creates a booking with the expected payload', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Buchung' }))
    fireEvent.click(screen.getByTestId('customer-search'))
    fireEvent.click(screen.getByRole('button', { name: 'Buchung anlegen' }))

    await waitFor(() => {
      expect(createBookingMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          loanerVehicleId: 'loaner-1',
          customerId: 'cust-1',
        }),
      )
    })
  })

  it('blocks hand-over until the licence checkbox is checked', async () => {
    const { toast } = await import('sonner')
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Übergabe' }))
    fireEvent.change(screen.getByLabelText('Kilometerstand'), { target: { value: '12000' } })
    fireEvent.change(screen.getByLabelText('Tankfüllung (%)'), { target: { value: '75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Übergabe speichern' }))

    expect(toast.error).toHaveBeenCalled()
    expect(handOverMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Führerschein geprüft'))
    fireEvent.click(screen.getByRole('button', { name: 'Übergabe speichern' }))

    await waitFor(() => {
      expect(handOverMutate).toHaveBeenCalledWith({
        id: 'booking-reserved',
        data: expect.objectContaining({
          odometerOut: 12000,
          fuelOut: 75,
          driverLicenceChecked: true,
        }),
      })
    })
  })

  it('submits return with odometer and fuel payload', async () => {
    vi.mocked(loanerApi.useLoanerBookings).mockReturnValue({
      data: { data: [handedOverBooking] },
      isLoading: false,
    } as unknown as ReturnType<typeof loanerApi.useLoanerBookings>)

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Rückgabe' }))
    fireEvent.change(screen.getByLabelText('Kilometerstand'), { target: { value: '12100' } })
    fireEvent.change(screen.getByLabelText('Tankfüllung (%)'), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rückgabe speichern' }))

    await waitFor(() => {
      expect(returnMutate).toHaveBeenCalledWith({
        id: 'booking-handed',
        data: expect.objectContaining({
          odometerIn: 12100,
          fuelIn: 60,
        }),
      })
    })
  })
})
