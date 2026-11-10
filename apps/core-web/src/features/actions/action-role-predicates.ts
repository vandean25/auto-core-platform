/**
 * Shared role and status gating predicates used by both registry action definitions
 * and page/row-behaviour components. Backend authorization remains authoritative.
 */

import type { SalesOrder } from '@/api/types'
import { canManageWorkshopEstimates } from '@/features/workshop/workshop-estimate-permissions'
import { canReadCreditNotes } from '@/lib/credit-note-quantity'

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

/**
 * Proposing and applying workshop command booking packages requires supervisor write access (OWNER/ADMIN),
 * matching the backend PROPOSE_ROLES in WorkshopCommandService.
 */
export function canApplyWorkshopCommand(role: string | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

export function canOpenCustomer(role: string | null | undefined): boolean {
  return role !== ''
}

/** Mirrors list delete access: any signed-in role that can open the customer list. */
export function canDeleteCustomerFromList(role: string | null | undefined): boolean {
  return role !== ''
}

/** Mirrors backend `sales.order.delete` (BACK_OFFICE: OWNER, ADMIN, SALES). */
export function canDeleteSalesOrder(role: string | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'SALES'
}

export function isSalesOrderDraftDeletable(
  order: Pick<SalesOrder, 'status' | 'invoice'>,
): boolean {
  return order.status === 'DRAFT' && !order.invoice
}

/** Mirrors the backend `assertCanMutateInventoryStock`: only OWNER/ADMIN edit catalog items (the server still decides per record). */
export function canEditInventoryItems(role: string | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN'
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

/** Mechanics (TECH) stay on the mechanic shell; back-office roles can open invoices, vehicle stock, and inventory details (consistent with canOpenCustomer/Vehicle/WorkshopOrder). */
export function canOpenBackOfficeDetail(role: string | null | undefined): boolean {
  return role !== '' && role !== 'TECH'
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

/**
 * Back-office task writes (add/delete, status, line items, from-catalog, pick-parts, checklist) are
 * restricted to OWNER/ADMIN/SALES plus DEMO, mirroring the backend `assertWorkshopTaskWriteRole`
 * (demo sessions write workshop tasks exactly like workshop orders). TECH keeps its
 * execution path on the mechanic routes.
 */
export function canManageWorkshopTasks(role: string | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'SALES' || role === 'DEMO'
}

export function canRecordTyreMeasurement(role: string | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'SALES' || role === 'TECH'
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

/** Import history and job actions mirror the tenant-admin gate on GET /api/imports (OWNER/ADMIN only). */
export function canManageImportJobs(role: string | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

/**
 * Credit-note read scope mirrors the backend BACK_OFFICE gate on `credit_note.read`
 * (OWNER/ADMIN/SALES). Read roles may fetch an already-generated PDF over GET only;
 * generating one over POST stays OWNER/ADMIN (`canManageCreditNotes`).
 */
export function canPrintCreditNote(role: string | null | undefined): boolean {
  return canReadCreditNotes(role)
}
