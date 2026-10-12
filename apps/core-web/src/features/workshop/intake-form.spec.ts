import { describe, expect, it } from 'vitest'
import {
  buildRegisterPayload,
  canSubmitOrder,
  conflictFromError,
  emptyCustomerForm,
  emptyVehicleForm,
  visibleConflict,
} from './intake-form'
import type { ExistingOrderConflict } from './intake-form'

const liveOrderError = {
  status: 409,
  data: {
    message: 'Vehicle already has active order WO-2026-0007',
    code: 'VEHICLE_HAS_ACTIVE_ORDER',
    orderId: 'wo-live',
    orderNumber: 'WO-2026-0007',
  },
}

describe('intake form helpers', () => {
  it('reads a live-order conflict only when the attempt has a vehicle', () => {
    expect(
      conflictFromError(liveOrderError, { vehicleId: 'v-1', tab: 'existing', formSignature: 'f' }),
    ).toMatchObject({ orderId: 'wo-live', orderNumber: 'WO-2026-0007', vehicleId: 'v-1', tab: 'existing' })
    expect(conflictFromError(liveOrderError, { tab: 'existing', formSignature: 'f' })).toBeNull()
    expect(
      conflictFromError({ status: 500 }, { vehicleId: 'v-1', tab: 'existing', formSignature: 'f' }),
    ).toBeNull()
  })

  it('keeps the form signature only for new-vehicle conflicts', () => {
    expect(
      conflictFromError(liveOrderError, { vehicleId: 'v-1', tab: 'new-vehicle', formSignature: 'form-a' })?.formSignature,
    ).toBe('form-a')
    expect(
      conflictFromError(liveOrderError, { vehicleId: 'v-1', tab: 'existing', formSignature: 'form-a' })?.formSignature,
    ).toBeUndefined()
  })

  it('shows a conflict only on its own tab, for its vehicle or its form', () => {
    const existing: ExistingOrderConflict = { message: 'm', orderId: 'o', vehicleId: 'v-1', tab: 'existing' }
    expect(visibleConflict(existing, { tab: 'existing', selectedVehicleId: 'v-1', formSignature: 'x' })).toBe(existing)
    expect(visibleConflict(existing, { tab: 'existing', selectedVehicleId: 'v-2', formSignature: 'x' })).toBeNull()
    expect(visibleConflict(existing, { tab: 'new-vehicle', selectedVehicleId: 'v-1', formSignature: 'x' })).toBeNull()

    const registered: ExistingOrderConflict = {
      message: 'm',
      orderId: 'o',
      vehicleId: 'v-9',
      tab: 'new-vehicle',
      formSignature: 'form-a',
    }
    expect(visibleConflict(registered, { tab: 'new-vehicle', formSignature: 'form-a' })).toBe(registered)
    expect(visibleConflict(registered, { tab: 'new-vehicle', formSignature: 'form-b' })).toBeNull()
  })

  it('needs a customer and a valid vehicle before a new-vehicle order can be submitted', () => {
    const base = {
      tab: 'new-vehicle' as const,
      newVehicle: { ...emptyVehicleForm(), vin: 'VIN', plate: 'P', make: 'VW', model: 'Golf' },
      newCustomer: emptyCustomerForm(),
      customerMode: 'existing' as const,
      odometer: '',
      fuelLevel: '50',
    }
    expect(canSubmitOrder({ ...base, selectedCustomerId: 'c-1' })).toBe(true)
    expect(canSubmitOrder(base)).toBe(false)
    expect(
      canSubmitOrder({ ...base, newVehicle: { ...base.newVehicle, year: '1800' }, selectedCustomerId: 'c-1' }),
    ).toBe(false)
  })

  it('builds the registration payload from the form', () => {
    const payload = buildRegisterPayload(
      { vin: ' VIN ', plate: ' P ', make: 'VW', model: 'Golf', year: '2019' },
      { firstName: 'Max', lastName: 'M', email: ' ', phone: '' },
      'new',
    )
    expect(payload).toMatchObject({ vin: 'VIN', plate: 'P', year: 2019, firstName: 'Max', lastName: 'M' })
    expect(payload.email).toBeUndefined()
    expect(payload.phone).toBeUndefined()
  })
})
