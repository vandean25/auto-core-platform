import { describe, expect, it } from 'vitest'

import {
  isCustomerUpdateOptimisticEligible,
  isVehicleStockPatchOptimisticEligible,
  isVehicleUpdateOptimisticEligible,
} from './customer-vehicle-update-eligibility'

// Regression: a patch that mixes one descriptive field with a server-side effect must not be optimistic.
describe('customer, vehicle and stock edit eligibility (ADR-0036 R1)', () => {
  it.each([
    { name: 'customer phone', check: isCustomerUpdateOptimisticEligible, data: { phone: '+43 1' }, expected: true },
    { name: 'customer address', check: isCustomerUpdateOptimisticEligible, data: { address_city: 'Wien', address_zip: '1010' }, expected: true },
    { name: 'customer e-mail (resets consent)', check: isCustomerUpdateOptimisticEligible, data: { email: 'a@b.test' }, expected: false },
    { name: 'customer tax id', check: isCustomerUpdateOptimisticEligible, data: { vat_id: 'ATU1' }, expected: false },
    { name: 'customer type change', check: isCustomerUpdateOptimisticEligible, data: { type: 'COMPANY' }, expected: false },
    { name: 'customer name with e-mail', check: isCustomerUpdateOptimisticEligible, data: { first_name: 'A', email: 'a@b.test' }, expected: false },
    { name: 'customer empty patch', check: isCustomerUpdateOptimisticEligible, data: {}, expected: false },
    { name: 'vehicle plate and model', check: isVehicleUpdateOptimisticEligible, data: { plate: 'W-1', model: 'A4' }, expected: true },
    { name: 'vehicle VIN (identity resolution)', check: isVehicleUpdateOptimisticEligible, data: { vin: 'WAU' }, expected: false },
    { name: 'vehicle customer change (party records)', check: isVehicleUpdateOptimisticEligible, data: { customer_id: 'c1' }, expected: false },
    { name: 'vehicle NoVA input', check: isVehicleUpdateOptimisticEligible, data: { nova_class: 'A' }, expected: false },
    { name: 'vehicle full dialog payload', check: isVehicleUpdateOptimisticEligible, data: { make: 'A', model: 'B', year: 2020, vin: 'X', plate: 'Y', customer_id: null }, expected: false },
  ])('$name -> optimistic $expected', ({ check, data, expected }) => {
    expect(check({ data })).toBe(expected)
  })

  it.each([
    { name: 'color', patch: { color: 'red' }, expected: true },
    { name: 'mileage and key number', patch: { mileage: 10, key_number: 'K1' }, expected: true },
    { name: 'reservation', patch: { reserved_for_customer_id: 'c1' }, expected: false },
    { name: 'location', patch: { location_id: 'l1' }, expected: false },
    { name: 'CO2 value (NoVA input)', patch: { co2_wltp_g_km: 120 }, expected: false },
    { name: 'color together with the reservation', patch: { color: 'red', reserved_for_customer_id: null }, expected: false },
  ])('stock $name -> optimistic $expected', ({ patch, expected }) => {
    expect(isVehicleStockPatchOptimisticEligible(patch)).toBe(expected)
  })
})
