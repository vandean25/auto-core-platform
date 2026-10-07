import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as workshopApi from '@/api/workshop'
import * as vehiclesApi from '@/api/vehicles'
import { toast } from 'sonner'
import { WorkshopOrderIntakeDialog } from './WorkshopOrderIntakeDialog'

const mockNavigate = vi.fn()

vi.mock('@/api/workshop')
vi.mock('@/api/vehicles')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

describe('WorkshopOrderIntakeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    ;(workshopApi.useWorkshopSearch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        data: {
          vehicles: [
            {
              id: 'vehicle-1',
              tenant_id: 'tenant-1',
              make: 'Volkswagen',
              model: 'Golf VII',
              year: 2018,
              vin: 'VWZZZ12345678901',
              plate: 'W-12345AB',
              customer: {
                id: 'customer-1',
                first_name: 'Max',
                last_name: 'Mustermann',
                type: 'PRIVATE',
              },
            },
          ],
          customers: [],
        },
        meta: {
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        },
      },
      isLoading: false,
    })

    ;(workshopApi.useRegisterIntake as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })

    ;(workshopApi.useCreateWorkshopOrder as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error('Finance settings update failed')),
      isPending: false,
    })
    vi.mocked(vehiclesApi.useVehicle).mockReturnValue({
      data: {
        id: 'vehicle-1',
        plate: 'W-12345AB',
        year: 2018,
        make: 'Volkswagen',
        model: 'Golf VII',
        customer: {
          id: 'customer-1',
          first_name: 'Max',
          last_name: 'Mustermann',
          type: 'PRIVATE',
        },
      },
    } as never)
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the backend error message when workshop order creation fails', async () => {
    render(<WorkshopOrderIntakeDialog open onOpenChange={vi.fn()} />)

    expect(
      screen.getByText('Search for an existing vehicle or register a new vehicle before creating the workshop order.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /2018 Volkswagen Golf VII/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Order' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Finance settings update failed')
    })
  })

  it('prefills the existing vehicle and requests a §57a task', async () => {
    const createOrder = vi.fn().mockResolvedValue({ id: 'order-1' })
    vi.mocked(workshopApi.useCreateWorkshopOrder).mockReturnValue({
      mutateAsync: createOrder,
      isPending: false,
    } as never)

    render(
      <WorkshopOrderIntakeDialog
        open
        onOpenChange={vi.fn()}
        initialVehicleId='vehicle-1'
        pickerlMode
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '§57a-Auftrag anlegen' }))

    await waitFor(() => {
      expect(createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleId: 'vehicle-1',
          customerId: 'customer-1',
          createPickerlTask: true,
        }),
      )
    })
  })
})
