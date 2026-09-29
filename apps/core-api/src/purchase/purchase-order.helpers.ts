import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartsReservationStatus,
  PurchaseOrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
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
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto.js';
import type { PaginatedPurchaseOrderResult } from './purchase.service.js';

import Decimal = Prisma.Decimal;

export function recomputePurchaseOrderStatus(
  items: Array<{
    quantity: number | Decimal;
    quantity_received: number | Decimal;
  }>,
  previousStatus?: PurchaseOrderStatus,
): PurchaseOrderStatus {
  if (items.length === 0) {
    return PurchaseOrderStatus.DRAFT;
  }

  const totalQuantity = items.reduce(
    (sum, item) => sum.add(new Decimal(item.quantity)),
    new Decimal(0),
  );
  const totalReceived = items.reduce(
    (sum, item) => sum.add(new Decimal(item.quantity_received)),
    new Decimal(0),
  );
  const totalRemaining = totalQuantity.sub(totalReceived);

  if (totalRemaining.lte(0)) {
    return PurchaseOrderStatus.COMPLETED;
  } else if (totalReceived.gt(0)) {
    return PurchaseOrderStatus.PARTIAL;
  } else {
    return previousStatus === PurchaseOrderStatus.SENT
      ? PurchaseOrderStatus.SENT
      : PurchaseOrderStatus.DRAFT;
  }
}

export function validateCatalogItemsForVendor(
  items: { catalogItemId: string }[],
  catalogItemsMap: Map<
    string,
    Prisma.CatalogItemGetPayload<{ include: { brand: true } }>
  >,
  vendor: {
    name: string;
    supportedBrands: Array<{ id: number | string; name: string }>;
  },
  existingPoItems?: Array<{ catalog_item_id: string }>,
): void {
  for (const item of items) {
    const catalogItem = catalogItemsMap.get(item.catalogItemId);
    if (!catalogItem) {
      throw new BadRequestException(
        `Catalog Item ${item.catalogItemId} not found`,
      );
    }

    if (
      catalogItem.brand &&
      !vendor.supportedBrands.some((b) => b.id === catalogItem.brand_id)
    ) {
      const supportedNames = vendor.supportedBrands
        .map((b) => b.name)
        .join(', ');
      throw new BadRequestException(
        `Vendor ${vendor.name} does not support brand ${catalogItem.brand.name}. Supported: ${supportedNames}`,
      );
    }

    if (existingPoItems) {
      const existingItem = existingPoItems.find(
        (i) => i.catalog_item_id === item.catalogItemId,
      );
      if (existingItem) {
        throw new BadRequestException(
          `Item ${catalogItem.name} is already in this purchase order`,
        );
      }
    }
  }
}

export async function fetchAndValidateCatalogItems(
  prisma: PrismaService,
  tenantId: string,
  items: { catalogItemId: string }[],
  vendor: {
    name: string;
    supportedBrands: Array<{ id: number | string; name: string }>;
  },
  existingPoItems?: Array<{ catalog_item_id: string }>,
): Promise<void> {
  const seenIds = new Set<string>();
  for (const item of items) {
    if (seenIds.has(item.catalogItemId)) {
      throw new BadRequestException(
        `Duplicate item in request: ${item.catalogItemId}`,
      );
    }
    seenIds.add(item.catalogItemId);
  }

  const itemIds = items.map((i) => i.catalogItemId);
  const catalogItems = await prisma.catalogItem.findMany({
    where: { tenant_id: tenantId, id: { in: itemIds } },
    include: { brand: true },
  });

  const catalogItemsMap = new Map(catalogItems.map((c) => [c.id, c]));
  validateCatalogItemsForVendor(
    items,
    catalogItemsMap,
    vendor,
    existingPoItems,
  );
}

export function toPurchaseOrderItemCreateData(
  tenantId: string,
  item: { catalogItemId: string; quantity: number; unitCost: number },
  orderId?: string,
) {
  return {
    tenant_id: tenantId,
    ...(orderId ? { purchase_order_id: orderId } : {}),
    catalog_item_id: item.catalogItemId,
    quantity: item.quantity,
    unit_cost: item.unitCost,
    quantity_received: 0,
  };
}

export function assertPurchaseOrderCanBeDeleted(order: {
  status: PurchaseOrderStatus;
  items: Array<{
    quantity_received: Decimal | number;
    quantity_invoiced?: Decimal | number | null;
    purchase_invoice_lines: unknown[];
    parts_reservation?: { quantity_staged: Decimal | number } | null;
  }>;
}): void {
  if (order.status !== PurchaseOrderStatus.DRAFT) {
    throw new ConflictException('Only DRAFT purchase orders can be deleted');
  }

  const hasReceivedItems = order.items.some((item) =>
    new Decimal(item.quantity_received).gt(0),
  );
  if (hasReceivedItems) {
    throw new ConflictException(
      'Purchase order cannot be deleted because items were already received.',
    );
  }

  const hasStagedReservations = order.items.some(
    (item) =>
      item.parts_reservation &&
      new Decimal(item.parts_reservation.quantity_staged).gt(0),
  );
  if (hasStagedReservations) {
    throw new ConflictException(
      'Purchase order cannot be deleted because linked reservation slices are staged.',
    );
  }

  const hasInvoicedItems = order.items.some((item) => {
    const numericQty =
      typeof (item.quantity_invoiced as { toNumber?: () => number })
        ?.toNumber === 'function'
        ? (item.quantity_invoiced as { toNumber: () => number }).toNumber()
        : Number(item.quantity_invoiced || 0);

    return (
      numericQty > 0 ||
      (item.purchase_invoice_lines && item.purchase_invoice_lines.length > 0)
    );
  });
  if (hasInvoicedItems) {
    throw new BadRequestException(
      'Purchase order cannot be deleted because it is linked to purchase invoices.',
    );
  }
}

export function assertPurchaseOrderItemCanBeDeleted(
  poStatus: PurchaseOrderStatus,
  item: {
    quantity_received: Decimal | number;
    parts_reservation?: { quantity_staged: Decimal | number } | null;
  },
): void {
  if (new Decimal(item.quantity_received).gt(0)) {
    throw new BadRequestException(
      'Cannot delete an item that has already been received',
    );
  }

  const linkedReservation = item.parts_reservation;
  if (linkedReservation) {
    if (
      poStatus !== PurchaseOrderStatus.DRAFT ||
      new Decimal(linkedReservation.quantity_staged).gt(0)
    ) {
      throw new ConflictException(
        'A linked reservation slice must be released before deleting a sent purchase order item.',
      );
    }
  }
}

export function assertPurchaseOrderItemCanBeUpdated(
  poItem: {
    quantity_received: Decimal | number;
    parts_reservation?: unknown;
  },
  updates: { quantity?: number; unitCost?: number },
): void {
  if (poItem.parts_reservation && updates.quantity !== undefined) {
    throw new ConflictException(
      'Cannot update quantity of a purchase order item linked to a parts reservation. Adjust via reservation slice.',
    );
  }

  if (
    updates.quantity !== undefined &&
    new Decimal(updates.quantity).lt(poItem.quantity_received)
  ) {
    throw new BadRequestException(
      `Cannot reduce quantity below ${poItem.quantity_received.toString()} already received`,
    );
  }
}

export function buildPurchaseOrderItemUpdatePayload(
  itemId: string,
  tenantId: string,
  updates: { quantity?: number; unitCost?: number },
): {
  where: Prisma.PurchaseOrderItemWhereInput;
  data: Prisma.PurchaseOrderItemUpdateInput;
} {
  const data: Prisma.PurchaseOrderItemUpdateInput = {};
  if (updates.quantity !== undefined) data.quantity = updates.quantity;
  if (updates.unitCost !== undefined) data.unit_cost = updates.unitCost;

  const where: Prisma.PurchaseOrderItemWhereInput = {
    id: itemId,
    tenant_id: tenantId,
    ...(updates.unitCost !== undefined
      ? { quantity_received: new Decimal(0) }
      : {}),
  };

  return { where, data };
}

export function extractRequisitionIdsFromReservations(
  reservations: Array<
    | { requisition_line?: { requisition_id?: string | null } | null }
    | null
    | undefined
  >,
): string[] {
  return [
    ...new Set(
      reservations
        .map((reservation) => reservation?.requisition_line?.requisition_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

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
      quantity_staged: new Decimal(0),
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
          create: items.map((i) => toPurchaseOrderItemCreateData(tenantId, i)),
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

export async function executeMarkAsSent(
  tx: Prisma.TransactionClient,
  id: string,
  tenantId: string,
  siteId: string,
  orderAtRequestStart: boolean,
) {
  await lockPurchaseOrderHeader(tx, tenantId, id);

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

export async function executeGetPurchaseOrderItems(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  orderId: string,
) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: orderId, tenant_id: tenantId, site_id: siteId },
    include: {
      items: {
        include: { catalog_item: true },
      },
    },
  });

  if (!po) {
    throw new NotFoundException('Purchase Order not found');
  }

  return po.items;
}

export async function executeGetPurchaseOrderItem(
  prisma: PrismaService,
  tenantId: string,
  orderId: string,
  itemId: string,
) {
  const item = await prisma.purchaseOrderItem.findFirst({
    where: {
      id: itemId,
      purchase_order_id: orderId,
      tenant_id: tenantId,
    },
    include: { catalog_item: true },
  });

  if (!item) {
    throw new NotFoundException('Purchase order item not found');
  }

  return item;
}

export async function executeFindAllPurchaseOrders(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  params?: Prisma.PurchaseOrderFindManyArgs | string,
): Promise<PaginatedPurchaseOrderResult> {
  if (isPurchaseOrderFindManyArgs(params)) {
    const scopedWhere = {
      ...(params.where ?? {}),
      tenant_id: tenantId,
      site_id: siteId,
    };
    const [data, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        ...params,
        where: scopedWhere,
        include: { vendor: true, items: true },
      }),
      prisma.purchaseOrder.count({
        where: scopedWhere,
      }),
    ]);
    return { data, total };
  }

  const where = buildLegacyPurchaseOrderWhere(tenantId, siteId, params);
  const data = await prisma.purchaseOrder.findMany({
    where,
    include: { vendor: true, items: true },
    orderBy: { createdAt: 'desc' },
  });
  return { data, total: data.length };
}

export async function executeFindOnePurchaseOrder(
  prisma: PrismaService,
  tenantId: string,
  authorizedSiteIds: string[],
  id: string,
) {
  return prisma.purchaseOrder.findFirst({
    where: { id, tenant_id: tenantId, site_id: { in: authorizedSiteIds } },
    include: {
      vendor: { include: { supportedBrands: true } },
      items: {
        include: { catalog_item: true },
      },
    },
  });
}

export function buildLegacyPurchaseOrderWhere(
  tenantId: string,
  siteId: string,
  params?: string,
): Prisma.PurchaseOrderWhereInput {
  const status = typeof params === 'string' ? params : 'all';
  if (status === 'open') {
    return {
      tenant_id: tenantId,
      site_id: siteId,
      status: {
        in: [
          PurchaseOrderStatus.DRAFT,
          PurchaseOrderStatus.SENT,
          PurchaseOrderStatus.PARTIAL,
        ],
      },
    };
  }
  return {
    tenant_id: tenantId,
    site_id: siteId,
  };
}

export function isPurchaseOrderFindManyArgs(
  params?: Prisma.PurchaseOrderFindManyArgs | string,
): params is Prisma.PurchaseOrderFindManyArgs {
  return (
    typeof params === 'object' &&
    params !== null &&
    ('where' in params || 'orderBy' in params || 'skip' in params)
  );
}
