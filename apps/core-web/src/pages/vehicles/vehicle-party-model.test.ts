import { describe, expect, it } from 'vitest'
import type { Customer } from '@/api/types'
import type { VehiclePartyResponse } from '@/api/vehicles'
import { registerGermanUiForTests } from '@/test/german-ui'
import {
  canManageVehicleParties,
  formatVehiclePartyRole,
  resolveMainContact,
  splitVehicleParties,
} from './vehicle-party-model'

const owner = { id: 'cust-owner', type: 'PRIVATE', company_name: null, first_name: 'Erika', last_name: 'Muster' }

function party(overrides: Partial<VehiclePartyResponse>): VehiclePartyResponse {
  return {
    id: 'party-1',
    vehicle_id: 'vehicle-1',
    customer_id: owner.id,
    role: 'OWNER',
    valid_from: '2026-01-01',
    valid_to: null,
    source: 'MANUAL',
    notes: null,
    is_active: true,
    customer: owner,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
    ...overrides,
  } as VehiclePartyResponse
}

registerGermanUiForTests()

describe('canManageVehicleParties', () => {
  it.each(['OWNER', 'ADMIN', 'SALES'] as const)('allows %s', (role) => {
    expect(canManageVehicleParties(role)).toBe(true)
  })

  it.each(['TECH', 'DEMO'] as const)('denies %s', (role) => {
    expect(canManageVehicleParties(role)).toBe(false)
  })

  it('denies a missing role', () => {
    expect(canManageVehicleParties(null)).toBe(false)
  })
})

describe('splitVehicleParties', () => {
  it('separates active parties from the history', () => {
    const active = party({ id: 'a' })
    const ended = party({ id: 'b', role: 'PREVIOUS_OWNER', is_active: false, valid_to: '2025-12-31' })

    expect(splitVehicleParties([active, ended])).toEqual({ active: [active], history: [ended] })
  })
})

describe('resolveMainContact', () => {
  it('uses the active OWNER party', () => {
    expect(resolveMainContact([party({})], null)).toEqual({
      id: 'cust-owner',
      name: 'Erika Muster',
      fromOwnerParty: true,
    })
  })

  it('ignores an ended OWNER and falls back to the vehicle customer without backfilling', () => {
    const ended = party({ is_active: false, valid_to: '2025-12-31' })
    const vehicleCustomer = { ...owner, id: 'cust-vehicle', first_name: 'Vera', last_name: 'Fallback' }

    expect(resolveMainContact([ended], vehicleCustomer as unknown as Customer)).toEqual({
      id: 'cust-vehicle',
      name: 'Vera Fallback',
      fromOwnerParty: false,
    })
  })

  it('returns null when there is neither an owner party nor a vehicle customer', () => {
    expect(resolveMainContact([], null)).toBeNull()
  })
})

describe('formatVehiclePartyRole', () => {
  it('returns the German role label', () => {
    expect(formatVehiclePartyRole('BILL_TO')).toBe('Rechnungsempfänger')
  })
})
