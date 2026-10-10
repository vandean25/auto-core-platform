/**
 * Mirrors the backend rules for Kostenvoranschlag actions (ESTIMATE_ROLES and
 * WORKSHOP_ESTIMATE_OPEN_ORDER_STATUSES). The backend stays authoritative; this only
 * decides which controls the advisor sees.
 */
export function canManageWorkshopEstimates(activeRole: string | null | undefined): boolean {
  return activeRole === 'OWNER' || activeRole === 'ADMIN' || activeRole === 'SALES'
}

/** Orders that can still take a new estimate or revision. COMPLETED and INVOICED are closed. */
export function isWorkshopEstimateOrderOpen(status: string | null | undefined): boolean {
  return status === 'INTAKE' || status === 'IN_PROGRESS'
}
