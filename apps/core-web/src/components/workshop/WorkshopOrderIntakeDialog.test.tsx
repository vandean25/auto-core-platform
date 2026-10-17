import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as workshopApi from '@/api/workshop'
import * as vehiclesApi from '@/api/vehicles'
import { toast } from 'sonner'
import { WorkshopOrderIntakeDialog } from './WorkshopOrderIntakeDialog'
import { deWorkshop } from '@/test/de-workshop'

const oi = deWorkshop.orderIntake
const openWo20260007 = oi.openOrderNumber.replace('{{orderNumber}}', 'WO-2026-0007')

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
      screen.getByText(oi.description),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /2018 Volkswagen Golf VII/i }))
    fireEvent.click(screen.getByRole('button', { name: oi.createOrder }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(oi.toastCreateFailed)
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

  it('links to the existing order when the vehicle already has an open one', async () => {
    vi.mocked(workshopApi.useCreateWorkshopOrder).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(
        Object.assign(new Error('Vehicle already has active order WO-2026-0007'), {
          status: 409,
          data: {
            message: 'Vehicle already has active order WO-2026-0007',
            code: 'VEHICLE_HAS_ACTIVE_ORDER',
            orderId: 'order-live',
            orderNumber: 'WO-2026-0007',
          },
        }),
      ),
      isPending: false,
    } as never)

    render(<WorkshopOrderIntakeDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /2018 Volkswagen Golf VII/i }))
    fireEvent.click(screen.getByRole('button', { name: oi.createOrder }))

    expect(
      await screen.findByText(
        oi.activeOrderConflict.replace('{{orderNumber}}', 'WO-2026-0007'),
      ),
    ).toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: openWo20260007 }))
    expect(mockNavigate).toHaveBeenCalledWith('/workshop/orders/order-live')
  })

  it('shows the reference id when order creation fails with a server error', async () => {
    vi.mocked(workshopApi.useCreateWorkshopOrder).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(
        Object.assign(new Error('Something went wrong (ref: req-5xx-1)'), {
          status: 500,
          data: {
            message: 'Something went wrong (ref: req-5xx-1)',
            requestId: 'req-5xx-1',
            eventId: 'evt-5xx-1',
          },
        }),
      ),
      isPending: false,
    } as never)

    render(<WorkshopOrderIntakeDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /2018 Volkswagen Golf VII/i }))
    fireEvent.click(screen.getByRole('button', { name: oi.createOrder }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut. (ref: req-5xx-1)',
      )
    })
  })

  it('hides the existing-order alert once a different vehicle is selected', async () => {
    vi.mocked(workshopApi.useWorkshopSearch).mockReturnValue({
      data: {
        data: {
          vehicles: [
            {
              id: 'vehicle-2',
              tenant_id: 'tenant-1',
              make: 'Audi',
              model: 'A4',
              year: 2019,
              vin: 'WAUZZZ8K9KA000001',
              plate: 'W-67890CD',
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
      },
      isLoading: false,
    } as never)
    vi.mocked(workshopApi.useCreateWorkshopOrder).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(
        Object.assign(new Error('Vehicle already has active order WO-2026-0007'), {
          status: 409,
          data: {
            message: 'Vehicle already has active order WO-2026-0007',
            code: 'VEHICLE_HAS_ACTIVE_ORDER',
            orderId: 'order-live',
            orderNumber: 'WO-2026-0007',
          },
        }),
      ),
      isPending: false,
    } as never)

    render(<WorkshopOrderIntakeDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: oi.createOrder }))
    expect(await screen.findByRole('button', { name: openWo20260007 })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /2019 Audi A4/i }))

    expect(screen.queryByRole('button', { name: openWo20260007 })).not.toBeInTheDocument()
  })

  it('links to the existing order when a registered vehicle already has one', async () => {
    vi.mocked(workshopApi.useWorkshopSearch).mockReturnValue({
      data: {
        data: {
          vehicles: [],
          customers: [
            {
              id: 'customer-1',
              first_name: 'Max',
              last_name: 'Mustermann',
              email: null,
              phone: null,
              type: 'PRIVATE',
            },
          ],
        },
      },
      isLoading: false,
    } as never)
    vi.mocked(workshopApi.useRegisterIntake).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: 'vehicle-9', customer: { id: 'customer-1' } }),
      isPending: false,
    } as never)
    vi.mocked(workshopApi.useCreateWorkshopOrder).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(
        Object.assign(new Error('Vehicle already has active order WO-2026-0007'), {
          status: 409,
          data: {
            message: 'Vehicle already has active order WO-2026-0007',
            code: 'VEHICLE_HAS_ACTIVE_ORDER',
            orderId: 'order-live',
            orderNumber: 'WO-2026-0007',
          },
        }),
      ),
      isPending: false,
    } as never)

    render(<WorkshopOrderIntakeDialog open onOpenChange={vi.fn()} />)

    fireEvent.mouseDown(screen.getByRole('tab', { name: oi.tabNewVehicle }), { button: 0 })
    fireEvent.change(screen.getByPlaceholderText(oi.vinPlaceholder), { target: { value: 'WVWZZZ1KZ9W000001' } })
    fireEvent.change(screen.getByPlaceholderText(oi.platePlaceholder), { target: { value: 'W-1' } })
    fireEvent.change(screen.getByPlaceholderText(oi.makePlaceholder), { target: { value: 'Volkswagen' } })
    fireEvent.change(screen.getByPlaceholderText(oi.modelPlaceholder), { target: { value: 'Golf VII' } })
    fireEvent.click(screen.getByRole('button', { name: /Max Mustermann/i }))
    fireEvent.click(screen.getByRole('button', { name: oi.createOrder }))

    fireEvent.click(await screen.findByRole('button', { name: openWo20260007 }))
    expect(mockNavigate).toHaveBeenCalledWith('/workshop/orders/order-live')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('hides the new-vehicle alert once the form changes', async () => {
    vi.mocked(workshopApi.useWorkshopSearch).mockReturnValue({
      data: {
        data: {
          vehicles: [],
          customers: [
            {
              id: 'customer-1',
              first_name: 'Max',
              last_name: 'Mustermann',
              email: null,
              phone: null,
              type: 'PRIVATE',
            },
          ],
        },
      },
      isLoading: false,
    } as never)
    vi.mocked(workshopApi.useRegisterIntake).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: 'vehicle-9', customer: { id: 'customer-1' } }),
      isPending: false,
    } as never)
    vi.mocked(workshopApi.useCreateWorkshopOrder).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(
        Object.assign(new Error('Vehicle already has active order WO-2026-0007'), {
          status: 409,
          data: {
            message: 'Vehicle already has active order WO-2026-0007',
            code: 'VEHICLE_HAS_ACTIVE_ORDER',
            orderId: 'order-live',
            orderNumber: 'WO-2026-0007',
          },
        }),
      ),
      isPending: false,
    } as never)

    render(<WorkshopOrderIntakeDialog open onOpenChange={vi.fn()} />)

    fireEvent.mouseDown(screen.getByRole('tab', { name: oi.tabNewVehicle }), { button: 0 })
    fireEvent.change(screen.getByPlaceholderText(oi.vinPlaceholder), { target: { value: 'WVWZZZ1KZ9W000001' } })
    fireEvent.change(screen.getByPlaceholderText(oi.platePlaceholder), { target: { value: 'W-1' } })
    fireEvent.change(screen.getByPlaceholderText(oi.makePlaceholder), { target: { value: 'Volkswagen' } })
    fireEvent.change(screen.getByPlaceholderText(oi.modelPlaceholder), { target: { value: 'Golf VII' } })
    fireEvent.click(screen.getByRole('button', { name: /Max Mustermann/i }))
    fireEvent.click(screen.getByRole('button', { name: oi.createOrder }))
    expect(await screen.findByRole('button', { name: openWo20260007 })).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(oi.vinPlaceholder), { target: { value: 'WVWZZZ1KZ9W000002' } })

    expect(screen.queryByRole('button', { name: openWo20260007 })).not.toBeInTheDocument()
  })

  it('does not keep a conflict from an attempt the user cancelled', async () => {
    let rejectOrder: (reason: unknown) => void = () => undefined
    const pendingOrder = new Promise((_resolve, reject) => {
      rejectOrder = reject
    })
    vi.mocked(workshopApi.useCreateWorkshopOrder).mockReturnValue({
      mutateAsync: vi.fn().mockReturnValue(pendingOrder),
      isPending: false,
    } as never)

    render(<WorkshopOrderIntakeDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: oi.createOrder }))
    fireEvent.click(screen.getByRole('button', { name: oi.cancel }))
    rejectOrder(
      Object.assign(new Error('Vehicle already has active order WO-2026-0007'), {
        status: 409,
        data: {
          message: 'Vehicle already has active order WO-2026-0007',
          code: 'VEHICLE_HAS_ACTIVE_ORDER',
          orderId: 'order-live',
          orderNumber: 'WO-2026-0007',
        },
      }),
    )
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('button', { name: /2018 Volkswagen Golf VII/i }))

    expect(screen.queryByRole('button', { name: openWo20260007 })).not.toBeInTheDocument()
  })
})
