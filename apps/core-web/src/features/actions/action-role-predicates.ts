/**
 * Shared role and status gating predicates used by both registry action definitions
 * and page/row-behaviour components. Backend authorization remains authoritative.
 */

import { canManageWorkshopEstimates } from '@/features/workshop/workshop-estimate-permissions'

/** Work order and appointment creation (Cmd+K, phone Create button). Mechanics (TECH) stay in the mechanic shell. */
export function canCreateWorkshopEntry(role: string | null | undefined): boolean {
  return role !== 'TECH'
}

/**
 * Command mode in Cmd+K mirrors the roles the command API accepts for interpret
 * (OWNER/ADMIN/SALES). Techs and demo members keep the plain palette.
 */
export function canUseWorkshopCommand(role: string | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'SALES'
}

export function canOpenCustomer(role: string | null | undefined): boolean {
  return role !== ''
}

/** Mirrors list delete access: any signed-in role that can open the customer list. */
export function canDeleteCustomerFromList(role: string | null | undefined): boolean {
  return role !== ''
}

export function canOpenVehicle(role: string | null | undefined): boolean {
  return role !== ''
}

/** Same roles as the estimate card on the work order (canManageWorkshopEstimates). */
export function canOpenEstimate(role: string | null | undefined): boolean {
  return canManageWorkshopEstimates(role)
}

export function canOpenWorkshopOrder(role: string | null | undefined): boolean {
  return role !== ''
}

export function canCheckInWorkshopOrder(role: string | null | undefined): boolean {
  return role !== ''
}

export function canGenerateWorkshopJobCardPdf(role: string | null | undefined): boolean {
  return role !== ''
}

export function canAssignWorkshopOrderMechanic(role: string | null | undefined): boolean {
  return role !== ''
}

export function canUpdateWorkshopOrderTaskState(role: string | null | undefined): boolean {
  return role !== ''
}

export function isWorkshopCheckInOpenStatus(status: string | null | undefined): boolean {
  return status === 'INTAKE' || status === 'IN_PROGRESS'
}

export function isWorkshopTechAssignableStatus(status: string | null | undefined): boolean {
  return status === 'SCHEDULED' || status === 'INTAKE' || status === 'IN_PROGRESS'
}

export function isWorkshopOrderLockedStatus(status: string | null | undefined): boolean {
  return status === 'INVOICED'
}
