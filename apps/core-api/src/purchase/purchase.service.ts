import { randomInt } from 'node:crypto';
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseOrderStatus, Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition';
import { PurchaseReceiptService } from './purchase-receipt.service';

import Decimal = Prisma.Decimal;

export type PurchaseOrderWithRelations = Prisma.PurchaseOrderGetPayload<{
  include: { vendor: true; items: true };
}>;

export interface PaginatedPurchaseOrderResult {
  data: PurchaseOrderWithRelations[];
  total: number;
}

function isPurchaseOrderFindManyArgs(
  params?: Prisma.PurchaseOrderFindManyArgs | string,
): params is Prisma.PurchaseOrderFindManyArgs {
  return (
    typeof params === 'object' &&
    params !== null &&
    ('where' in params || 'orderBy' in params || 'skip' in params)
  );
}

@Injectable()
export class PurchaseService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly receiptService: PurchaseReceiptService,
  ) {}

  private generateOrderNumber(): string {
    const date = new Date();
    return `PO-${date.getFullYear()}-${randomInt(0, 10000)
      .toString()
      .padStart(4, '0')}`;
  }

  private recomputePurchaseOrderStatus(
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
      // No items received yet - preserve SENT status if it was previously SENT, otherwise DRAFT
      return previousStatus === PurchaseOrderStatus.SENT
        ? PurchaseOrderStatus.SENT
        : PurchaseOrderStatus.DRAFT;
    }
  }

  private validateCatalogItemsForVendor(
    items: { catalogItemId: string }[],
    catalogItemsMap: Map<
      string,
      Prisma.CatalogItemGetPayload<{ include: { brand: true } }>
    >,
    vendor: {
      name: string;
      supportedBrands: Array<{ id: number; name: string }>;
    },
    existingPoItems?: Array<{ catalog_item_id: string }>,
  ) {
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

  private async syncPurchaseOrderStatusAndFetch(
    tx: Prisma.TransactionClient,
    orderId: string,
    tenantId: string,
    previousStatus: PurchaseOrderStatus,
  ) {
    const updatedPO = await tx.purchaseOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      include: { items: true },
    });
    if (!updatedPO) throw new NotFoundException('Purchase Order not found');

    const newStatus = this.recomputePurchaseOrderStatus(
      updatedPO.items,
      previousStatus,
    );

    if (newStatus !== previousStatus) {
      await guardedStatusUpdate(bindStatusUpdateMany(tx.purchaseOrder), {
        id: orderId,
        tenantId,
        from: previousStatus,
        to: newStatus,
        conflictMessage:
          'Purchase order status changed concurrently. Please refresh and try again.',
      });
    }

    return tx.purchaseOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      include: {
        vendor: true,
        items: {
          include: { catalog_item: true },
        },
      },
    });
  }

  async createPurchaseOrder(
    vendorId: string,
    items: { catalogItemId: string; quantity: number; unitCost: number }[],
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, tenant_id: tenantId },
      include: { supportedBrands: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const itemIds = items.map((i) => i.catalogItemId);
    const catalogItems = await this.prisma.catalogItem.findMany({
      where: { tenant_id: tenantId, id: { in: itemIds } },
      include: { brand: true },
    });

    const catalogItemsMap = new Map(catalogItems.map((c) => [c.id, c]));
    this.validateCatalogItemsForVendor(items, catalogItemsMap, vendor);

    const purchaseOrder = await this.prisma.purchaseOrder.create({
      data: {
        tenant_id: tenantId,
        vendor_id: vendorId,
        order_number: this.generateOrderNumber(),
        status: PurchaseOrderStatus.DRAFT,
        items: {
          create: items.map((i) => ({
            tenant_id: tenantId,
            catalog_item_id: i.catalogItemId,
            quantity: i.quantity,
            unit_cost: i.unitCost,
            quantity_received: 0,
          })),
        },
      },
      include: { items: true },
    });

    return purchaseOrder;
  }

  async receiveItems(
    orderId: string,
    receivedItems: { itemId: string; quantity: number }[],
  ) {
    return this.receiptService.receiveItems(orderId, receivedItems);
  }

  async addItemsToPurchaseOrder(
    orderId: string,
    items: { catalogItemId: string; quantity: number; unitCost: number }[],
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      include: { vendor: { include: { supportedBrands: true } }, items: true },
    });
    if (!po) throw new NotFoundException('Purchase Order not found');

    // Check for duplicate catalogItemIds within the incoming payload
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
    const catalogItems = await this.prisma.catalogItem.findMany({
      where: { tenant_id: tenantId, id: { in: itemIds } },
      include: { brand: true },
    });

    const catalogItemsMap = new Map(catalogItems.map((c) => [c.id, c]));
    this.validateCatalogItemsForVendor(
      items,
      catalogItemsMap,
      po.vendor,
      po.items,
    );

    // Add items to PO in a transaction
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // Create all items
      await Promise.all(
        items.map((i) =>
          tx.purchaseOrderItem.create({
            data: {
              tenant_id: tenantId,
              purchase_order_id: orderId,
              catalog_item_id: i.catalogItemId,
              quantity: i.quantity,
              unit_cost: i.unitCost,
              quantity_received: 0,
            },
          }),
        ),
      );

      return this.syncPurchaseOrderStatusAndFetch(
        tx,
        orderId,
        tenantId,
        po.status,
      );
    });

    return updatedOrder;
  }

  async updatePurchaseOrderItem(
    orderId: string,
    itemId: string,
    updates: { quantity?: number; unitCost?: number },
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('Purchase Order not found');

    const poItem = po.items.find((i) => i.id === itemId);
    if (!poItem)
      throw new BadRequestException('Item not found in this purchase order');

    // Validate that new quantity is not less than already received
    if (
      updates.quantity !== undefined &&
      new Decimal(updates.quantity).lt(poItem.quantity_received)
    ) {
      throw new BadRequestException(
        `Cannot reduce quantity below ${poItem.quantity_received.toString()} already received`,
      );
    }

    // Map camelCase to snake_case for Prisma
    const prismaUpdates: Prisma.PurchaseOrderItemUpdateInput = {};
    if (updates.quantity !== undefined)
      prismaUpdates.quantity = updates.quantity;
    if (updates.unitCost !== undefined)
      prismaUpdates.unit_cost = updates.unitCost;

    // Update in a transaction
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.purchaseOrderItem.updateMany({
        where: { id: itemId, tenant_id: tenantId },
        data: prismaUpdates,
      });

      if (updateResult.count === 0) {
        throw new NotFoundException('Purchase order item not found');
      }

      return this.syncPurchaseOrderStatusAndFetch(
        tx,
        orderId,
        tenantId,
        po.status,
      );
    });

    return updatedOrder;
  }

  async deleteItemFromPurchaseOrder(orderId: string, itemId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('Purchase Order not found');

    const poItem = po.items.find((i) => i.id === itemId);
    if (!poItem)
      throw new BadRequestException('Item not found in this purchase order');

    if (new Decimal(poItem.quantity_received).gt(0)) {
      throw new BadRequestException(
        'Cannot delete an item that has already been received',
      );
    }

    // Delete in a transaction
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const deleteResult = await tx.purchaseOrderItem.deleteMany({
        where: { id: itemId, tenant_id: tenantId },
      });

      if (deleteResult.count === 0) {
        throw new NotFoundException('Purchase order item not found');
      }

      return this.syncPurchaseOrderStatusAndFetch(
        tx,
        orderId,
        tenantId,
        po.status,
      );
    });

    return updatedOrder;
  }

  async getPurchaseOrderItems(orderId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
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

  async getPurchaseOrderItem(orderId: string, itemId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const item = await this.prisma.purchaseOrderItem.findFirst({
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

  async findAll(
    params?: Prisma.PurchaseOrderFindManyArgs | string,
  ): Promise<PaginatedPurchaseOrderResult> {
    const tenantId = await this.tenantContext.getTenantId();
    if (isPurchaseOrderFindManyArgs(params)) {
      const scopedWhere = { ...(params.where ?? {}), tenant_id: tenantId };
      const [data, total] = await Promise.all([
        this.prisma.purchaseOrder.findMany({
          ...params,
          where: scopedWhere,
          include: { vendor: true, items: true },
        }),
        this.prisma.purchaseOrder.count({
          where: scopedWhere,
        }),
      ]);
      return { data, total };
    }

    let where: Prisma.PurchaseOrderWhereInput = { tenant_id: tenantId };
    const status = typeof params === 'string' ? params : 'all';

    if (status === 'open') {
      where = {
        tenant_id: tenantId,
        status: {
          in: [
            PurchaseOrderStatus.DRAFT,
            PurchaseOrderStatus.SENT,
            PurchaseOrderStatus.PARTIAL,
          ],
        },
      };
    }

    const data = await this.prisma.purchaseOrder.findMany({
      where,
      include: { vendor: true, items: true },
      orderBy: { createdAt: 'desc' },
    });
    return { data, total: data.length };
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.purchaseOrder.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        vendor: { include: { supportedBrands: true } },
        items: {
          include: { catalog_item: true },
        },
      },
    });
  }

  async markAsSent(id: string) {
    const tenantId = await this.tenantContext.getTenantId();

    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!order) {
      throw new NotFoundException('Purchase Order not found');
    }

    if (order.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException(
        'Only DRAFT purchase orders can be marked as sent',
      );
    }

    await guardedStatusUpdate(bindStatusUpdateMany(this.prisma.purchaseOrder), {
      id,
      tenantId,
      from: PurchaseOrderStatus.DRAFT,
      to: PurchaseOrderStatus.SENT,
      conflictMessage:
        'Purchase order status changed concurrently. Please refresh and try again.',
    });

    const updated = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenant_id: tenantId },
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

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const deletedOrder = await this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findFirst({
        where: { id, tenant_id: tenantId },
        include: {
          items: {
            include: {
              purchase_invoice_lines: true,
            },
          },
        },
      });

      if (!order) {
        throw new NotFoundException('Purchase Order not found');
      }

      if (order.status !== PurchaseOrderStatus.DRAFT) {
        throw new BadRequestException(
          'Only DRAFT purchase orders can be deleted',
        );
      }

      const hasReceivedItems = order.items.some((item) =>
        new Decimal(item.quantity_received).gt(0),
      );
      if (hasReceivedItems) {
        throw new BadRequestException(
          'Purchase order cannot be deleted because items were already received.',
        );
      }

      const hasInvoicedItems = order.items.some((item) => {
        const numericQty =
          typeof item.quantity_invoiced?.toNumber === 'function'
            ? item.quantity_invoiced.toNumber()
            : Number(item.quantity_invoiced || 0);

        return numericQty > 0 || item.purchase_invoice_lines.length > 0;
      });
      if (hasInvoicedItems) {
        throw new BadRequestException(
          'Purchase order cannot be deleted because it is linked to purchase invoices.',
        );
      }

      await tx.purchaseOrderItem.deleteMany({
        where: { purchase_order_id: id },
      });

      const deleteResult = await tx.purchaseOrder.deleteMany({
        where: { id, tenant_id: tenantId },
      });

      if (deleteResult.count === 0) {
        throw new NotFoundException('Purchase Order not found');
      }

      return { id };
    });

    return deletedOrder;
  }
}
