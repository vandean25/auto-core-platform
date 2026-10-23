import type { components } from '@/api/generated/openapi'
import type { Customer } from '@/api/types'
import type { VehiclePartyResponse } from '@/api/vehicles'
import { translateEnum } from '@/lib/i18n/enum-labels'
import { getCustomerName } from './vehicle-detail-model'

type TenantMemberRole = components['schemas']['TenantMemberRole']
export type VehiclePartyRole = components['schemas']['VehiclePartyRole']

export const VEHICLE_PARTY_ROLES: VehiclePartyRole[] = [
  'OWNER',
  'DRIVER',
  'USER',
  'BILL_TO',
  'LEASING',
  'INSURANCE',
  'WARRANTY_PROVIDER',
  'SERVICE_CONTRACT',
  'PREVIOUS_OWNER',
]

/** Same roles the party endpoints accept for writes. */
export function canManageVehicleParties(activeRole: TenantMemberRole | null | undefined): boolean {
  return activeRole === 'OWNER' || activeRole === 'ADMIN' || activeRole === 'SALES'
}

export function formatVehiclePartyRole(role: VehiclePartyRole): string {
  return translateEnum('vehiclePartyRole', role)
}

export function splitVehicleParties(parties: VehiclePartyResponse[]) {
  return {
    active: parties.filter((party) => party.is_active),
    history: parties.filter((party) => !party.is_active),
  }
}

export type MainContact = {
  id: string
  name: string
  /** False when the contact is the vehicle's own customer because no active OWNER party exists. */
  fromOwnerParty: boolean
}

/** The active OWNER is the main contact. Without one, the vehicle's customer stays the contact (no backfill). */
export function resolveMainContact(
  parties: VehiclePartyResponse[],
  vehicleCustomer: Customer | null | undefined,
): MainContact | null {
  const owner = parties.find((party) => party.is_active && party.role === 'OWNER')
  if (owner) {
    return { id: owner.customer.id, name: formatPartyCustomerName(owner.customer), fromOwnerParty: true }
  }
  if (!vehicleCustomer) {
    return null
  }
  return { id: vehicleCustomer.id, name: getCustomerName(vehicleCustomer), fromOwnerParty: false }
}

export function formatPartyCustomerName(customer: VehiclePartyResponse['customer']): string {
  if (customer.type === 'COMPANY' && customer.company_name) {
    return customer.company_name
  }
  return `${customer.first_name} ${customer.last_name}`.trim()
}
