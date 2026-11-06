import { describe, expect, it, vi } from 'vitest'

import { emptyCustomerForm, emptyVehicleForm } from '@/features/workshop/intake-form'
import { submitWorkshopIntakeOrder } from './workshop-order-intake-create'

const messages = {
  selectVehicle: 'select-vehicle',
  selectCustomer: 'select-customer',
  noCustomerLinked: 'no-customer',
  pickerlOpened: 'pickerl',
  orderCreated: 'created',
  createFailed: 'failed',
}

function deps(overrides: Partial<Parameters<typeof submitWorkshopIntakeOrder>[0]> = {}) {
  return {
    activeTab: 'existing' as const,
    selectedVehicle: null,
    selectedCustomer: null,
    customerMode: 'existing' as const,
    newVehicle: emptyVehicleForm(),
    newCustomer: emptyCustomerForm(),
    orderPayload: { odometer: 10, fuelLevel: 50 },
    pickerlMode: false,
    isCurrentAttempt: () => true,
    formSignature: 'sig',
    messages,
    registerVehicle: vi.fn(),
    createOrder: vi.fn().mockResolvedValue({ id: 'order-1' }),
    pendingCallbacks: { listPendingMode: false, closeDialog: vi.fn() },
    notify: {
      toastSuccess: vi.fn(),
      onNavigateCreated: vi.fn(),
      toastError: vi.fn(),
      onConflict: vi.fn(),
      onPendingFailed: vi.fn(),
    },
    ...overrides,
  }
}

describe('submitWorkshopIntakeOrder', () => {
  it('asks for a vehicle when the existing tab has no customer link', async () => {
    const input = deps()
    await submitWorkshopIntakeOrder(input)
    expect(input.notify.toastError).toHaveBeenCalledWith('select-vehicle')
    expect(input.createOrder).not.toHaveBeenCalled()
  })

  it('creates a pickerl order from the selected vehicle', async () => {
    const input = deps({
      pickerlMode: true,
      selectedVehicle: {
        id: 'vehicle-1',
        year: 2018,
        make: 'VW',
        model: 'Golf',
        customer: { id: 'customer-1', first_name: 'Pilot', last_name: 'Customer' },
      } as never,
    })
    await submitWorkshopIntakeOrder(input)
    expect(input.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'customer-1',
      vehicleId: 'vehicle-1',
      createPickerlTask: true,
    }))
    expect(input.notify.onNavigateCreated).toHaveBeenCalledWith('order-1', 'pickerl')
  })

  it('marks the pending row when create rejects in list-pending mode', async () => {
    const onPendingFailed = vi.fn()
    const onPendingOrder = vi.fn()
    const createOrder = vi.fn().mockRejectedValue(new Error('down'))
    const input = deps({
      selectedVehicle: {
        id: 'vehicle-1',
        year: 2018,
        make: 'VW',
        model: 'Golf',
        customer: { id: 'customer-1', first_name: 'Pilot', last_name: 'Customer' },
      } as never,
      createOrder,
      pendingCallbacks: {
        listPendingMode: true,
        closeDialog: vi.fn(),
        onPendingOrder,
      },
      notify: {
        toastSuccess: vi.fn(),
        onNavigateCreated: vi.fn(),
        toastError: vi.fn(),
        onConflict: vi.fn(),
        onPendingFailed,
      },
    })

    await expect(submitWorkshopIntakeOrder(input)).resolves.toBeUndefined()
    expect(onPendingOrder).toHaveBeenCalledTimes(1)
    // Retry re-sends this payload, so the row must carry exactly what the create was called with.
    expect(onPendingOrder.mock.calls[0][0].createPayload).toEqual(createOrder.mock.calls[0][0])
    const localId = onPendingOrder.mock.calls[0][1].localId as string
    expect(onPendingFailed).toHaveBeenCalledWith(localId, { message: 'failed' })
    expect(input.pendingCallbacks.closeDialog).toHaveBeenCalled()
    expect(input.notify.toastError).not.toHaveBeenCalled()
  })

  // Regression: the extraction dropped the old try/catch, so a failing vehicle registration became an unhandled rejection with no feedback.
  it.each([
    ['new-vehicle', false],
    ['new-vehicle', true],
    ['registration-document', false],
    ['registration-document', true],
  ] as const)('toasts the error and creates nothing when registering a vehicle fails on %s (list pending: %s)', async (activeTab, listPendingMode) => {
    const onPendingOrder = vi.fn()
    const createOrder = vi.fn()
    const input = deps({
      activeTab,
      customerMode: 'new',
      registerVehicle: vi.fn().mockRejectedValue(new Error('register down')),
      createOrder,
      pendingCallbacks: { listPendingMode, closeDialog: vi.fn(), onPendingOrder },
    })

    await expect(submitWorkshopIntakeOrder(input)).resolves.toBeUndefined()
    expect(input.notify.toastError).toHaveBeenCalledTimes(1)
    expect(input.notify.toastError).toHaveBeenCalledWith('failed')
    expect(createOrder).not.toHaveBeenCalled()
    expect(onPendingOrder).not.toHaveBeenCalled()
    expect(input.pendingCallbacks.closeDialog).not.toHaveBeenCalled()
  })

  // Regression guard for Retry: a create that succeeded must never be reported as failed because the success handler threw.
  it('does not mark a created order as failed when the success handler throws', async () => {
    const onPendingFailed = vi.fn()
    const input = deps({
      selectedVehicle: {
        id: 'vehicle-1', year: 2018, make: 'VW', model: 'Golf',
        customer: { id: 'customer-1', first_name: 'Pilot', last_name: 'Customer' },
      } as never,
      pendingCallbacks: {
        listPendingMode: true,
        closeDialog: vi.fn(),
        onPendingOrder: vi.fn(),
        onPendingOrderSettled: () => { throw new Error('settle handler broke') },
      },
      notify: { toastSuccess: vi.fn(), onNavigateCreated: vi.fn(), toastError: vi.fn(), onConflict: vi.fn(), onPendingFailed },
    })

    await submitWorkshopIntakeOrder(input).catch(() => undefined)
    expect(onPendingFailed).not.toHaveBeenCalled()
  })
})
