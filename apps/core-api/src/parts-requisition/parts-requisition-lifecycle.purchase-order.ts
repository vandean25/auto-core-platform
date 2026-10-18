import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartsRequisitionStatus,
  Prisma,
  PurchaseOrderStatus,
} from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import { generatePurchaseOrderNumber } from '../purchase/purchase-order-number.util.js';
import type { PurchaseOrderWithRelations } from '../purchase/purchase.service.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import type { CreateRequisitionPurchaseOrderDto } from './dto/create-requisition-purchase-order.dto.js';
import { recomputeRequisitionStatus } from './parts-requisition.helpers.js';
import { lockRequisitionReservations } from './parts-requisition-lifecycle.locking.js';
import { REQUISITION_SLICE_STATUSES } from './parts-requisition-lifecycle.types.js';
import { validateRequisitionPoItems } from './parts-requisition-lifecycle.validation.js';

export async function executeCreateRequisitionPurchaseOrder(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  requisitionId: string,
  dto: CreateRequisitionPurchaseOrderDto,
  reservations: Array<{
    id: string;
    quantity: Prisma.Decimal;
    workshop_task_line_item: {
      catalog_item_id: string | null;
    };
  }>,
): Promise<PurchaseOrderWithRelations> {
  const reservationById = new Map(
    reservations.map((reservation) => [reservation.id, reservation]),
  );

  const purchaseOrder = await tx.purchaseOrder.create({
    data: {
      tenant_id: tenantId,
      site_id: siteId,
      vendor_id: dto.vendorId,
      order_number: generatePurchaseOrderNumber(),
      status: PurchaseOrderStatus.DRAFT,
    },
    select: { id: true },
  });

  await chunkedPromiseAll(dto.items, async (item) => {
    const reservation = reservationById.get(item.reservationId);
    if (!reservation?.workshop_task_line_item.catalog_item_id) {
      throw new UnprocessableEntityException(
        'Reservation slice has no catalog item.',
      );
    }

    const purchaseOrderItem = await tx.purchaseOrderItem.create({
      data: {
        tenant_id: tenantId,
        purchase_order_id: purchaseOrder.id,
        catalog_item_id: reservation.workshop_task_line_item.catalog_item_id,
        quantity: reservation.quantity,
        unit_cost: item.unitCost,
        quantity_received: 0,
      },
      select: { id: true },
    });

    const linked = await tx.partsReservation.updateMany({
      where: {
        tenant_id: tenantId,
        id: reservation.id,
        purchase_order_item_id: null,
        status: { in: [...REQUISITION_SLICE_STATUSES] },
      },
      data: { purchase_order_item_id: purchaseOrderItem.id },
    });
    if (linked.count !== 1) {
      throw new ConflictException(
        `Reservation slice ${reservation.id} changed while creating the purchase order.`,
      );
    }
  });

  await recomputeRequisitionStatus(tx, tenantId, requisitionId);

  const created = await tx.purchaseOrder.findFirst({
    where: { id: purchaseOrder.id, tenant_id: tenantId, site_id: siteId },
    include: {
      vendor: true,
      items: { include: { catalog_item: true } },
    },
  });
  if (!created) {
    throw new NotFoundException('Purchase order not found');
  }
  return created;
}

export async function executeCreatePurchaseOrderForRequisition(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  requisitionId: string,
  dto: CreateRequisitionPurchaseOrderDto,
): Promise<PurchaseOrderWithRelations> {
  await lockSitesAndAssertActive(tx, tenantId, [siteId]);

  const requisition = await tx.partsRequisition.findFirst({
    where: { id: requisitionId, tenant_id: tenantId },
    select: { id: true, status: true },
  });
  if (!requisition) {
    throw new NotFoundException('Parts requisition not found');
  }
  if (
    requisition.status === PartsRequisitionStatus.CANCELLED ||
    requisition.status === PartsRequisitionStatus.COMPLETED
  ) {
    throw new UnprocessableEntityException(
      'A terminal parts requisition cannot create a purchase order.',
    );
  }

  const reservationIds = dto.items.map((item) => item.reservationId);
  const reservations = await tx.partsReservation.findMany({
    where: { tenant_id: tenantId, id: { in: reservationIds } },
    select: {
      id: true,
      quantity: true,
      status: true,
      kind: true,
      purchase_order_item_id: true,
      requisition_line: { select: { requisition_id: true } },
      workshop_task_line_item: {
        select: {
          catalog_item_id: true,
          workshop_task: {
            select: {
              workshop_order: { select: { site_id: true } },
            },
          },
        },
      },
    },
    orderBy: { id: 'asc' },
  });
  if (reservations.length !== reservationIds.length) {
    throw new UnprocessableEntityException(
      'One or more reservation slices were not found.',
    );
  }

  await lockRequisitionReservations(tx, tenantId, reservationIds);

  const vendor = await tx.vendor.findFirst({
    where: { id: dto.vendorId, tenant_id: tenantId },
    include: { supportedBrands: true },
  });
  if (!vendor) {
    throw new NotFoundException('Vendor not found');
  }

  await validateRequisitionPoItems(
    tx,
    tenantId,
    siteId,
    requisitionId,
    dto.items,
    vendor,
    reservations,
  );

  return executeCreateRequisitionPurchaseOrder(
    tx,
    tenantId,
    siteId,
    requisitionId,
    dto,
    reservations,
  );
}
