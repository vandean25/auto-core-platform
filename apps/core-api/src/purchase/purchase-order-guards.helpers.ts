import { BadRequestException, ConflictException } from '@nestjs/common';
import { PurchaseOrderStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

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
  }
  if (totalReceived.gt(0)) {
    return PurchaseOrderStatus.PARTIAL;
  }
  return previousStatus === PurchaseOrderStatus.SENT
    ? PurchaseOrderStatus.SENT
    : PurchaseOrderStatus.DRAFT;
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
  orderId: string,
): Prisma.PurchaseOrderItemUncheckedCreateInput {
  return {
    tenant_id: tenantId,
    purchase_order_id: orderId,
    catalog_item_id: item.catalogItemId,
    quantity: item.quantity,
    unit_cost: item.unitCost,
    quantity_received: 0,
  };
}

export function toPurchaseOrderItemNestedCreateData(
  tenantId: string,
  item: { catalogItemId: string; quantity: number; unitCost: number },
): Prisma.PurchaseOrderItemUncheckedCreateWithoutPurchase_orderInput {
  return {
    tenant_id: tenantId,
    catalog_item_id: item.catalogItemId,
    quantity: item.quantity,
    unit_cost: item.unitCost,
    quantity_received: 0,
  };
}

function hasAnyReceivedItems(
  items: Array<{ quantity_received: Decimal | number }>,
): boolean {
  return items.some((item) => new Decimal(item.quantity_received).gt(0));
}

function hasAnyStagedReservations(
  items: Array<{
    parts_reservation?: { quantity_staged: Decimal | number } | null;
  }>,
): boolean {
  return items.some(
    (item) =>
      item.parts_reservation &&
      new Decimal(item.parts_reservation.quantity_staged).gt(0),
  );
}

function toQuantityInvoicedNumber(value?: Decimal | number | null): number {
  if (!value) return 0;
  if (typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

function hasAnyInvoicedItems(
  items: Array<{
    quantity_invoiced?: Decimal | number | null;
    purchase_invoice_lines?: unknown[];
  }>,
): boolean {
  return items.some((item) => {
    const numericQty = toQuantityInvoicedNumber(item.quantity_invoiced);
    return (
      numericQty > 0 ||
      (item.purchase_invoice_lines && item.purchase_invoice_lines.length > 0)
    );
  });
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

  if (hasAnyReceivedItems(order.items)) {
    throw new ConflictException(
      'Purchase order cannot be deleted because items were already received.',
    );
  }

  if (hasAnyStagedReservations(order.items)) {
    throw new ConflictException(
      'Purchase order cannot be deleted because linked reservation slices are staged.',
    );
  }

  if (hasAnyInvoicedItems(order.items)) {
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
