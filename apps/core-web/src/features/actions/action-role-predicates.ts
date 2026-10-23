/**
 * Shared role and status gating predicates used by both registry action definitions
 * and page/row-behaviour components. Backend authorization remains authoritative.
 */

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

export function canOpenWorkshopOrder(role: string | null | undefined): boolean {
  return role !== ''
}

export function canCheckInWorkshopOrder(role: string | null | undefined): boolean {
  return role !== ''
}

export function canGenerateWorkshopJobCardPdf(role: string | null | undefined): boolean {
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
