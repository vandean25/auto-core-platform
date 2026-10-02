import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartsReservationStatus,
  PurchaseOrderStatus,
  type Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition.js';
import {
  assertActiveTargetSiteMembership,
  assertPersistedSiteId,
  lockSitesAndAssertActive,
} from '../site/document-retarget.helpers.js';
import { recomputeRequisitionStatus } from '../parts-requisition/parts-requisition.helpers.js';
import { generatePurchaseOrderNumber } from './purchase-order-number.util.js';
import {
  lockPurchaseOrderHeader,
  lockPurchaseOrderItems,
  lockPartsReservations,
} from './purchase-lock.helpers.js';
import type { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto.js';
import {
  assertPurchaseOrderCanBeDeleted,
  assertPurchaseOrderItemCanBeDeleted,
  assertPurchaseOrderItemCanBeUpdated,
  buildPurchaseOrderItemUpdatePayload,
  extractRequisitionIdsFromReservations,
  fetchAndValidateCatalogItems,
  recomputePurchaseOrderStatus,
  toPurchaseOrderItemCreateData,
  toPurchaseOrderItemNestedCreateData,
} from './purchase-order-guards.helpers.js';
import { executeFindOnePurchaseOrder } from './purchase-order-query.helpers.js';

export async function recomputeLinkedRequisitions(
  tx: Prisma.TransactionClient,
  tenantId: string,
  reservations: Array<
    | { requisition_line?: { requisition_id?: string | null } | null }
    | null
    | undefined
  >,
): Promise<void> {
  const requisitionIds = extractRequisitionIdsFromReservations(reservations);
  for (const requisitionId of requisitionIds) {
    await recomputeRequisitionStatus(tx, tenantId, requisitionId);
  }
}

export async function cancelLinkedOpenReservations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  reservationIds: string[],
): Promise<void> {
  if (reservationIds.length === 0) return;
  await lockPartsReservations(tx, tenantId, reservationIds);
  const cancelled = await tx.partsReservation.updateMany({
    where: {
      tenant_id: tenantId,
      id: { in: reservationIds },
      status: PartsReservationStatus.OPEN,
      purchase_order_item_id: { not: null },
      quantity_staged: 0,
    },
    data: {
      status: PartsReservationStatus.CANCELLED,
      purchase_order_item_id: null,
      detached_at: new Date(),
    },
  });
  if (cancelled.count !== reservationIds.length) {
    throw new ConflictException(
      'A reservation slice changed while deleting the purchase order. Please refresh and try again.',
    );
  }
}

export async function cancelLinkedItemReservation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  linkedReservation: { id: string } | null | undefined,
): Promise<void> {
  if (!linkedReservation) return;
  await lockPartsReservations(tx, tenantId, [linkedReservation.id]);
  const cancelled = await tx.partsReservation.updateMany({
    where: { tenant_id: tenantId, id: linkedReservation.id },
    data: {
      status: PartsReservationStatus.CANCELLED,
      purchase_order_item_id: null,
      detached_at: new Date(),
    },
  });
  if (cancelled.count !== 1) {
    throw new ConflictException(
      'A reservation slice changed while deleting the purchase order item. Please refresh and try again.',
    );
  }
}

export async function transitionReservationsToOrdered(
  tx: Prisma.TransactionClient,
  tenantId: string,
  reservationIds: string[],
): Promise<void> {
  if (reservationIds.length === 0) return;
  await tx.partsReservation.updateMany({
    where: {
      tenant_id: tenantId,
      id: { in: reservationIds },
      status: PartsReservationStatus.OPEN,
    },
    data: { status: PartsReservationStatus.ORDERED },
  });
}

export async function syncPurchaseOrderStatusAndFetch(
  tx: Prisma.TransactionClient,
  scope: { orderId: string; tenantId: string; siteId: string },
  previousStatus: PurchaseOrderStatus,
) {
  const updatedPO = await tx.purchaseOrder.findFirst({
    where: {
      id: scope.orderId,
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
    },
    include: { items: true },
  });
  if (!updatedPO) throw new NotFoundException('Purchase Order not found');

  const newStatus = recomputePurchaseOrderStatus(
    updatedPO.items,
    previousStatus,
  );

  if (newStatus !== previousStatus) {
    await guardedStatusUpdate(bindStatusUpdateMany(tx.purchaseOrder), {
      id: scope.orderId,
      tenantId: scope.tenantId,
      from: previousStatus,
      to: newStatus,
      conflictMessage:
        'Purchase order status changed concurrently. Please refresh and try again.',
    });
  }

  return tx.purchaseOrder.findFirst({
    where: {
      id: scope.orderId,
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
    },
    include: {
      vendor: true,
      items: {
        include: { catalog_item: true },
      },
    },
  });
}

export async function executeCreatePurchaseOrder(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  vendorId: string,
  items: { catalogItemId: string; quantity: number; unitCost: number }[],
) {
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, tenant_id: tenantId },
    include: { supportedBrands: true },
  });
  if (!vendor) throw new NotFoundException('Vendor not found');

  await fetchAndValidateCatalogItems(prisma, tenantId, items, vendor);

  return prisma.$transaction(async (tx) => {
    await lockSitesAndAssertActive(tx, tenantId, [siteId]);

    return tx.purchaseOrder.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        vendor_id: vendorId,
        order_number: generatePurchaseOrderNumber(),
        status: PurchaseOrderStatus.DRAFT,
        items: {
          create: items.map((i) =>
            toPurchaseOrderItemNestedCreateData(tenantId, i),
          ),
        },
      },
      include: { items: true },
    });
  });
}

export async function executeAddItemsToPurchaseOrder(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  orderId: string,
  items: { catalogItemId: string; quantity: number; unitCost: number }[],
) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: orderId, tenant_id: tenantId, site_id: siteId },
    include: { vendor: { include: { supportedBrands: true } }, items: true },
  });
  if (!po) throw new NotFoundException('Purchase Order not found');

  await fetchAndValidateCatalogItems(
    prisma,
    tenantId,
    items,
    po.vendor,
    po.items,
  );

  return prisma.$transaction(async (tx) => {
    await Promise.all(
      items.map((i) =>
        tx.purchaseOrderItem.create({
          data: toPurchaseOrderItemCreateData(tenantId, i, orderId),
        }),
      ),
    );

    return syncPurchaseOrderStatusAndFetch(
      tx,
      { orderId, tenantId, siteId },
      po.status,
    );
  });
}

async function loadAndAssertOrderForMarkAsSent(
  tx: Prisma.TransactionClient,
  id: string,
  tenantId: string,
  siteId: string,
  orderAtRequestStart: boolean,
) {
  const order = await tx.purchaseOrder.findFirst({
    where: { id, tenant_id: tenantId, site_id: siteId },
    include: {
      items: {
        select: {
          id: true,
          parts_reservation: {
            select: {
              id: true,
              requisition_line: { select: { requisition_id: true } },
            },
          },
        },
      },
    },
  });

  if (!order) {
    if (orderAtRequestStart) {
      throw new ConflictException(
        'Purchase order was deleted concurrently. Please refresh and try again.',
      );
    }
    throw new NotFoundException('Purchase Order not found');
  }

  if (order.status !== PurchaseOrderStatus.DRAFT) {
    throw new BadRequestException(
      'Only DRAFT purchase orders can be marked as sent',
    );
  }

  const persistedSiteId = assertPersistedSiteId(
    order.site_id,
    'Purchase order site ownership is required',
  );
  await lockSitesAndAssertActive(tx, tenantId, [persistedSiteId]);

  return { order, persistedSiteId };
}

export async function executeMarkAsSent(
  tx: Prisma.TransactionClient,
  id: string,
  tenantId: string,
  siteId: string,
  orderAtRequestStart: boolean,
) {
  await lockPurchaseOrderHeader(tx, tenantId, id);

  const { order, persistedSiteId } = await loadAndAssertOrderForMarkAsSent(
    tx,
    id,
    tenantId,
    siteId,
    orderAtRequestStart,
  );

  const itemIds = order.items.map((i) => i.id);
  await lockPurchaseOrderItems(tx, tenantId, itemIds);

  const linkedReservations = order.items
    .map((item) => item.parts_reservation)
    .filter((reservation): reservation is NonNullable<typeof reservation> =>
      Boolean(reservation),
    );
  const reservationIds = linkedReservations.map((r) => r.id);
  await lockPartsReservations(tx, tenantId, reservationIds);

  await guardedStatusUpdate(bindStatusUpdateMany(tx.purchaseOrder), {
    id,
    tenantId,
    from: PurchaseOrderStatus.DRAFT,
    to: PurchaseOrderStatus.SENT,
    extraWhere: { site_id: persistedSiteId },
    conflictMessage:
      'Purchase order status changed concurrently. Please refresh and try again.',
  });

  await transitionReservationsToOrdered(tx, tenantId, reservationIds);
  await recomputeLinkedRequisitions(tx, tenantId, linkedReservations);

  const updated = await tx.purchaseOrder.findFirst({
    where: { id, tenant_id: tenantId, site_id: siteId },
    include: {
      vendor: true,
      items: {
        include: { catalog_item: true },
      },
    },
  });

  if (!updated) {
    throw new NotFoundException('Purchase Order not found');
  }

  return updated;
}

export async function executeRemovePurchaseOrder(
  tx: Prisma.TransactionClient,
  id: string,
  tenantId: string,
  siteId: string,
): Promise<{ id: string }> {
  await lockPurchaseOrderHeader(tx, tenantId, id);

  const order = await tx.purchaseOrder.findFirst({
    where: { id, tenant_id: tenantId, site_id: siteId },
    include: {
      items: {
        include: {
          purchase_invoice_lines: true,
          parts_reservation: {
            select: {
              id: true,
              quantity_staged: true,
              requisition_line: { select: { requisition_id: true } },
            },
          },
        },
      },
    },
  });

  if (!order) {
    throw new NotFoundException('Purchase Order not found');
  }

  assertPurchaseOrderCanBeDeleted(order);

  const itemIds = order.items.map((i) => i.id);
  await lockPurchaseOrderItems(tx, tenantId, itemIds);

  const linkedReservations = order.items
    .map((item) => item.parts_reservation)
    .filter((reservation): reservation is NonNullable<typeof reservation> =>
      Boolean(reservation),
    );
  const reservationIds = linkedReservations.map((r) => r.id);

  await cancelLinkedOpenReservations(tx, tenantId, reservationIds);

  await tx.purchaseOrderItem.deleteMany({
    where: { purchase_order_id: id, tenant_id: tenantId },
  });

  const deleteResult = await tx.purchaseOrder.deleteMany({
    where: { id, tenant_id: tenantId, status: PurchaseOrderStatus.DRAFT },
  });

  if (deleteResult.count === 0) {
    throw new ConflictException(
      'Purchase order status changed concurrently or was already deleted.',
    );
  }

  await recomputeLinkedRequisitions(tx, tenantId, linkedReservations);

  return { id };
}

export async function executeDeleteItemFromPurchaseOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  itemId: string,
  tenantId: string,
  siteId: string,
) {
  await lockPurchaseOrderHeader(tx, tenantId, orderId);
  await lockPurchaseOrderItems(tx, tenantId, [itemId]);

  const po = await tx.purchaseOrder.findFirst({
    where: { id: orderId, tenant_id: tenantId, site_id: siteId },
    include: {
      items: {
        where: { id: itemId },
        include: {
          parts_reservation: {
            select: {
              id: true,
              quantity_staged: true,
              requisition_line: { select: { requisition_id: true } },
            },
          },
        },
      },
    },
  });
  if (!po) throw new NotFoundException('Purchase Order not found');

  const poItem = po.items[0];
  if (!poItem)
    throw new BadRequestException('Item not found in this purchase order');

  assertPurchaseOrderItemCanBeDeleted(po.status, poItem);

  await cancelLinkedItemReservation(tx, tenantId, poItem.parts_reservation);

  const deleteResult = await tx.purchaseOrderItem.deleteMany({
    where: { id: itemId, tenant_id: tenantId },
  });

  if (deleteResult.count === 0) {
    throw new NotFoundException('Purchase order item not found');
  }

  const updated = await syncPurchaseOrderStatusAndFetch(
    tx,
    { orderId, tenantId, siteId },
    po.status,
  );

  const requisitionId =
    poItem.parts_reservation?.requisition_line?.requisition_id;
  if (requisitionId) {
    await recomputeRequisitionStatus(tx, tenantId, requisitionId);
  }

  return updated;
}

export async function executeUpdatePurchaseOrderItem(
  tx: Prisma.TransactionClient,
  orderId: string,
  itemId: string,
  tenantId: string,
  siteId: string,
  updates: { quantity?: number; unitCost?: number },
) {
  await lockPurchaseOrderHeader(tx, tenantId, orderId);
  await lockPurchaseOrderItems(tx, tenantId, [itemId]);

  const po = await tx.purchaseOrder.findFirst({
    where: { id: orderId, tenant_id: tenantId, site_id: siteId },
    include: {
      items: {
        include: { parts_reservation: true },
      },
    },
  });
  if (!po) throw new NotFoundException('Purchase Order not found');

  const poItem = po.items.find((i) => i.id === itemId);
  if (!poItem)
    throw new BadRequestException('Item not found in this purchase order');

  assertPurchaseOrderItemCanBeUpdated(poItem, updates);

  const { where, data } = buildPurchaseOrderItemUpdatePayload(
    itemId,
    tenantId,
    updates,
  );

  const updateResult = await tx.purchaseOrderItem.updateMany({
    where,
    data,
  });

  if (updateResult.count === 0) {
    if (updates.unitCost !== undefined) {
      throw new ConflictException(
        'Cannot update unit cost on a purchase order item that has already received goods.',
      );
    }
    throw new NotFoundException('Purchase order item not found');
  }

  return syncPurchaseOrderStatusAndFetch(
    tx,
    { orderId, tenantId, siteId },
    po.status,
  );
}

export async function executeRetargetPurchaseOrderSite(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  id: string,
  tenantId: string,
  existing: { site_id: string | null; status: PurchaseOrderStatus },
  dto: UpdatePurchaseOrderDto,
): Promise<void> {
  if (existing.status !== PurchaseOrderStatus.DRAFT) {
    throw new UnprocessableEntityException(
      'Purchase order site can only be changed while in DRAFT status',
    );
  }

  await assertActiveTargetSiteMembership(
    prisma,
    tenantContext,
    tenantId,
    dto.siteId!,
  );

  await prisma.$transaction(async (tx) => {
    await lockSitesAndAssertActive(
      tx,
      tenantId,
      [existing.site_id, dto.siteId].filter((s): s is string => Boolean(s)),
    );

    const updateResult = await tx.purchaseOrder.updateMany({
      where: {
        id,
        tenant_id: tenantId,
        site_id: existing.site_id,
        status: PurchaseOrderStatus.DRAFT,
        ...(dto.expectedSiteId ? { site_id: dto.expectedSiteId } : {}),
      },
      data: {
        site_id: dto.siteId,
      },
    });

    if (updateResult.count === 0) {
      throw new ConflictException(
        'Purchase order state or site changed concurrently. Please refresh.',
      );
    }
  });
}

export async function executeUpdatePurchaseOrder(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  tenantId: string,
  authorizedSiteIds: string[],
  id: string,
  dto: UpdatePurchaseOrderDto,
) {
  const existing = await prisma.purchaseOrder.findFirst({
    where: {
      id,
      tenant_id: tenantId,
      site_id: { in: authorizedSiteIds },
    },
    include: { items: true },
  });

  if (!existing) {
    throw new NotFoundException(`Purchase order ${id} not found`);
  }

  if (
    dto.expectedSiteId !== undefined &&
    existing.site_id &&
    dto.expectedSiteId !== existing.site_id
  ) {
    throw new ConflictException(
      'Purchase order site changed concurrently. Please refresh.',
    );
  }

  const isRetargeting =
    dto.siteId !== undefined && dto.siteId !== existing.site_id;

  if (isRetargeting) {
    await executeRetargetPurchaseOrderSite(
      prisma,
      tenantContext,
      id,
      tenantId,
      existing,
      dto,
    );
  }

  return executeFindOnePurchaseOrder(prisma, tenantId, authorizedSiteIds, id);
}
