import { randomInt } from 'node:crypto';
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../inventory/ledger.service';
import { PurchaseOrderStatus, TransactionType } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util';

export type PurchaseOrderWithRelations = Prisma.PurchaseOrderGetPayload<{
  include: { vendor: true; items: true };
}>;

export interface PaginatedPurchaseOrderResult {
  data: PurchaseOrderWithRelations[];
  total: number;
}

@Injectable()
export class PurchaseService {
  constructor(
    private prisma: PrismaService,
    private ledgerService: LedgerService,
  ) {}

  private generateOrderNumber(): string {
    const date = new Date();
    return `PO-${date.getFullYear()}-${randomInt(0, 10000)
      .toString()
      .padStart(4, '0')}`;
  }

  private recomputePurchaseOrderStatus(
    items: Array<{ quantity: number; quantity_received: number }>,
    previousStatus?: PurchaseOrderStatus,
  ): PurchaseOrderStatus {
    if (items.length === 0) {
      return PurchaseOrderStatus.DRAFT;
    }

    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalReceived = items.reduce(
      (sum, item) => sum + item.quantity_received,
      0,
    );
    const totalRemaining = totalQuantity - totalReceived;

    if (totalRemaining === 0) {
      return PurchaseOrderStatus.COMPLETED;
    } else if (totalReceived > 0) {
      return PurchaseOrderStatus.PARTIAL;
    } else {
      // No items received yet - preserve SENT status if it was previously SENT, otherwise DRAFT
      return previousStatus === PurchaseOrderStatus.SENT
        ? PurchaseOrderStatus.SENT
        : PurchaseOrderStatus.DRAFT;
    }
  }

  async createPurchaseOrder(
    vendorId: string,
    items: { catalogItemId: string; quantity: number; unitCost: number }[],
  ) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      include: { supportedBrands: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const itemIds = items.map((i) => i.catalogItemId);
    const catalogItems = await this.prisma.catalogItem.findMany({
      where: { id: { in: itemIds } },
      include: { brand: true },
    });

    for (const item of items) {
      const catalogItem = catalogItems.find((c) => c.id === item.catalogItemId);
      if (!catalogItem)
        throw new BadRequestException(
          `Catalog Item ${item.catalogItemId} not found`,
        );

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
    }

    const purchaseOrder = await this.prisma.purchaseOrder.create({
      data: {
        vendor_id: vendorId,
        order_number: this.generateOrderNumber(),
        status: PurchaseOrderStatus.DRAFT,
        items: {
          create: items.map((i) => ({
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
    try {
      const updatedPO = await this.prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: orderId },
          include: { items: true },
        });
        if (!po) throw new NotFoundException('Purchase Order not found');

        let warehouse = await tx.storageLocation.findFirst({
          where: { type: 'warehouse' },
        });
        if (!warehouse) {
          warehouse = await tx.storageLocation.create({
            data: {
              name: 'Default Warehouse',
              code: 'WH-001',
              type: 'warehouse',
            },
          });
        }

        // Ensure General Bin exists for this warehouse
        let generalBin = await tx.storageLocation.findFirst({
          where: {
            parent_id: warehouse.id,
            type: 'bin',
            name: 'General Bin',
          },
        });

        if (!generalBin) {
          generalBin = await tx.storageLocation.create({
            data: {
              name: 'General Bin',
              code: `${warehouse.code}-GEN`,
              type: 'bin',
              parent_id: warehouse.id,
            },
          });
        }

        // PRE-FETCH & MAP PATTERN
        const poItemIds = po.items.map((item) => item.id);
        const currentItems = await tx.purchaseOrderItem.findMany({
          where: { id: { in: poItemIds } },
        });
        const currentItemsMap = new Map(
          currentItems.map((item) => [item.id, item]),
        );

        // Aggregate received items by poItem.id to prevent duplicate itemIds from exceeding the limit
        const aggregatedReceived = new Map<
          string,
          { quantity: number; received: any; poItem: any }
        >();

        for (const received of receivedItems) {
          if (!received.itemId) {
            throw new BadRequestException(
              'itemId is required for each received item',
            );
          }

          const poItem = po.items.find(
            (i) => i.catalog_item_id === received.itemId,
          );
          if (!poItem) {
            const availableIds = po.items
              .map((i) => i.catalog_item_id)
              .join(', ');
            throw new BadRequestException(
              `Item ${received.itemId} not in this PO. Available: ${availableIds}`,
            );
          }

          const existing = aggregatedReceived.get(poItem.id);
          if (existing) {
            existing.quantity += received.quantity;
          } else {
            aggregatedReceived.set(poItem.id, {
              quantity: received.quantity,
              received,
              poItem,
            });
          }
        }

        const validatedAggregatedItems = Array.from(
          aggregatedReceived.values(),
        );

        for (const { poItem, quantity, received } of validatedAggregatedItems) {
          const currentItem = currentItemsMap.get(poItem.id);
          if (!currentItem)
            throw new BadRequestException(
              `Item ${received.itemId} not found in DB`,
            );

          if (currentItem.quantity_received + quantity > currentItem.quantity) {
            throw new BadRequestException(
              `Cannot receive more than ordered for item ${received.itemId}`,
            );
          }
        }

        // BATCH WRITES (using aggregated quantities)
        await chunkedPromiseAll(
          validatedAggregatedItems,
          async ({ poItem, quantity, received }) => {
            await tx.purchaseOrderItem.update({
              where: { id: poItem.id },
              data: { quantity_received: { increment: quantity } },
            });

            // Record the inventory transaction using the ledger service
            await this.ledgerService.recordTransactions(
              [
                {
                  itemId: received.itemId,
                  locationId: generalBin.id,
                  quantity: quantity,
                  type: TransactionType.PURCHASE_RECEIPT,
                  referenceId: po.order_number,
                  costBasis: poItem.unit_cost,
                },
              ],
              tx,
            );
          },
        );

        const updatedPO = await tx.purchaseOrder.findUnique({
          where: { id: orderId },
          include: { items: true },
        });

        if (!updatedPO) throw new Error('Failed to retrieve updated PO');

        const allReceived = updatedPO.items.every(
          (i) => i.quantity_received >= i.quantity,
        );
        const anyReceived = updatedPO.items.some(
          (i) => i.quantity_received > 0,
        );
        let newStatus = po.status;

        if (allReceived) newStatus = PurchaseOrderStatus.COMPLETED;
        else if (anyReceived) newStatus = PurchaseOrderStatus.PARTIAL;

        if (newStatus !== updatedPO.status) {
          await tx.purchaseOrder.update({
            where: { id: orderId },
            data: { status: newStatus },
          });
        }

        return updatedPO;
      });

      return updatedPO;
    } catch (error) {
      console.error('===== receiveItems ERROR =====');
      console.error('Error type:', error?.constructor?.name);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error('Error message:', errorMessage);
      console.error('Full error:', error);
      throw error;
    }
  }

  async addItemsToPurchaseOrder(
    orderId: string,
    items: { catalogItemId: string; quantity: number; unitCost: number }[],
  ) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
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
      where: { id: { in: itemIds } },
      include: { brand: true },
    });

    for (const item of items) {
      const catalogItem = catalogItems.find((c) => c.id === item.catalogItemId);
      if (!catalogItem)
        throw new BadRequestException(
          `Catalog Item ${item.catalogItemId} not found`,
        );

      if (
        catalogItem.brand &&
        !po.vendor.supportedBrands.some((b) => b.id === catalogItem.brand_id)
      ) {
        const supportedNames = po.vendor.supportedBrands
          .map((b) => b.name)
          .join(', ');
        throw new BadRequestException(
          `Vendor ${po.vendor.name} does not support brand ${catalogItem.brand.name}. Supported: ${supportedNames}`,
        );
      }

      // Check if item already exists in PO
      const existingItem = po.items.find(
        (i) => i.catalog_item_id === item.catalogItemId,
      );
      if (existingItem) {
        throw new BadRequestException(
          `Item ${catalogItem.name} is already in this purchase order`,
        );
      }
    }

    // Add items to PO in a transaction
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      // Create all items
      await Promise.all(
        items.map((i) =>
          tx.purchaseOrderItem.create({
            data: {
              purchase_order_id: orderId,
              catalog_item_id: i.catalogItemId,
              quantity: i.quantity,
              unit_cost: i.unitCost,
              quantity_received: 0,
            },
          }),
        ),
      );

      // Re-read the PO with updated items
      const updatedPO = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!updatedPO) throw new NotFoundException('Purchase Order not found');

      // Recompute status, preserving previous status if needed
      const newStatus = this.recomputePurchaseOrderStatus(
        updatedPO.items,
        po.status,
      );

      // Update status and return full PO
      return tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: newStatus },
        include: {
          vendor: true,
          items: {
            include: { catalog_item: true },
          },
        },
      });
    });

    return updatedOrder;
  }

  async updatePurchaseOrderItem(
    orderId: string,
    itemId: string,
    updates: { quantity?: number; unitCost?: number },
  ) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('Purchase Order not found');

    const poItem = po.items.find((i) => i.id === itemId);
    if (!poItem)
      throw new BadRequestException('Item not found in this purchase order');

    // Validate that new quantity is not less than already received
    if (
      updates.quantity !== undefined &&
      updates.quantity < poItem.quantity_received
    ) {
      throw new BadRequestException(
        `Cannot reduce quantity below ${poItem.quantity_received} already received`,
      );
    }

    // Map camelCase to snake_case for Prisma
    const prismaUpdates: Record<string, any> = {};
    if (updates.quantity !== undefined)
      prismaUpdates.quantity = updates.quantity;
    if (updates.unitCost !== undefined)
      prismaUpdates.unit_cost = updates.unitCost;

    // Update in a transaction
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.update({
        where: { id: itemId },
        data: prismaUpdates,
      });

      // Re-read the PO with updated items
      const updatedPO = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!updatedPO) throw new NotFoundException('Purchase Order not found');

      // Recompute status, preserving previous status if needed
      const newStatus = this.recomputePurchaseOrderStatus(
        updatedPO.items,
        po.status,
      );

      return tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: newStatus },
        include: {
          vendor: true,
          items: {
            include: { catalog_item: true },
          },
        },
      });
    });

    return updatedOrder;
  }

  async deleteItemFromPurchaseOrder(orderId: string, itemId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!po) throw new NotFoundException('Purchase Order not found');

    const poItem = po.items.find((i) => i.id === itemId);
    if (!poItem)
      throw new BadRequestException('Item not found in this purchase order');

    if (poItem.quantity_received > 0) {
      throw new BadRequestException(
        'Cannot delete an item that has already been received',
      );
    }

    // Delete in a transaction
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.delete({
        where: { id: itemId },
      });

      // Re-read the PO with updated items
      const updatedPO = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!updatedPO) throw new NotFoundException('Purchase Order not found');

      // Recompute status, preserving previous status if needed
      const newStatus = this.recomputePurchaseOrderStatus(
        updatedPO.items,
        po.status,
      );

      return tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: newStatus },
        include: {
          vendor: true,
          items: {
            include: { catalog_item: true },
          },
        },
      });
    });

    return updatedOrder;
  }

  async findAll(
    params: Prisma.PurchaseOrderFindManyArgs,
  ): Promise<PaginatedPurchaseOrderResult>;
  async findAll(status?: string): Promise<PurchaseOrderWithRelations[]>;
  async findAll(
    params?: Prisma.PurchaseOrderFindManyArgs | string,
  ): Promise<PaginatedPurchaseOrderResult | PurchaseOrderWithRelations[]> {
    if (
      params &&
      typeof params === 'object' &&
      ('where' in params || 'orderBy' in params || 'skip' in params)
    ) {
      const [data, total] = await Promise.all([
        this.prisma.purchaseOrder.findMany({
          ...params,
          include: { vendor: true, items: true },
        }),
        this.prisma.purchaseOrder.count({
          where: params.where,
        }),
      ]);
      return { data, total };
    }

    let where = {};
    const status = params as string;
    const filter = status || 'all';

    if (filter === 'open') {
      where = {
        status: {
          in: [
            PurchaseOrderStatus.DRAFT,
            PurchaseOrderStatus.SENT,
            PurchaseOrderStatus.PARTIAL,
          ],
        },
      };
    }

    return this.prisma.purchaseOrder.findMany({
      where,
      include: { vendor: true, items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        vendor: { include: { supportedBrands: true } },
        items: {
          include: { catalog_item: true },
        },
      },
    });
  }

  async remove(id: string) {
    const deletedOrder = await this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id },
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

      const hasReceivedItems = order.items.some(
        (item) => item.quantity_received > 0,
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

      return tx.purchaseOrder.delete({
        where: { id },
      });
    });

    return deletedOrder;
  }
}
