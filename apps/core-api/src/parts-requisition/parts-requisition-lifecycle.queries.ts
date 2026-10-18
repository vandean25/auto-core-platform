import {
  LocationType,
  Prisma,
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import {
  OPEN_WORKSHOP_ORDER_STATUSES,
  type RequisitionCandidateLine,
  type ReservationRow,
} from './parts-requisition-lifecycle.types.js';

export async function findAuthorizedLine(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  lineId: string,
) {
  return tx.workshopTaskLineItem.findFirst({
    where: {
      id: lineId,
      tenant_id: tenantId,
      type: WorkshopLineItemType.PART,
      part_execution_status: {
        not: WorkshopPartLineExecutionStatus.CANCELLED,
      },
      workshop_task: {
        tenant_id: tenantId,
        workshop_order: {
          tenant_id: tenantId,
          site_id: siteId,
          status: { in: [...OPEN_WORKSHOP_ORDER_STATUSES] },
          site: { is_active: true },
        },
      },
    },
    select: {
      id: true,
      workshop_task_id: true,
      catalog_item_id: true,
      quantity: true,
    },
  });
}

export async function findAuthorizedSourceLocation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  locationId: string,
) {
  return tx.storageLocation.findFirst({
    where: {
      id: locationId,
      tenant_id: tenantId,
      site_id: siteId,
      deletedAt: null,
      type: LocationType.bin,
      site: { is_active: true },
    },
    select: { id: true, site_id: true },
  });
}

export async function findLineReservations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lineId: string,
): Promise<ReservationRow[]> {
  return tx.partsReservation.findMany({
    where: {
      tenant_id: tenantId,
      workshop_task_line_item_id: lineId,
    },
    select: {
      id: true,
      tenant_id: true,
      workshop_task_line_item_id: true,
      quantity: true,
      quantity_received: true,
      quantity_consumed: true,
      quantity_staged: true,
      quantity_returned: true,
      kind: true,
      status: true,
      location_id: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { id: 'asc' },
  });
}

export async function findRequisitionCandidateLines(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  lineIds: readonly string[],
): Promise<RequisitionCandidateLine[]> {
  return tx.workshopTaskLineItem.findMany({
    where: {
      tenant_id: tenantId,
      id: { in: [...lineIds] },
      type: WorkshopLineItemType.PART,
      part_execution_status: {
        not: WorkshopPartLineExecutionStatus.CANCELLED,
      },
      catalog_item_id: { not: null },
      workshop_task: {
        tenant_id: tenantId,
        workshop_order: {
          tenant_id: tenantId,
          site_id: siteId,
          status: { in: [...OPEN_WORKSHOP_ORDER_STATUSES] },
          site: { is_active: true },
        },
      },
    },
    select: {
      id: true,
      workshop_task_id: true,
      quantity: true,
      workshop_task: {
        select: {
          workshop_order: {
            select: {
              id: true,
              order_number: true,
              vehicle: { select: { make_brand_id: true } },
            },
          },
        },
      },
    },
  });
}
