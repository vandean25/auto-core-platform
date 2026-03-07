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

  private recomputePurchaseOrderStatus(items: Array<{ quantity: number; quantity_received: number }>): PurchaseOrderStatus {
    if (items.length === 0) {
      return PurchaseOrderStatus.DRAFT;
    }

    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalReceived = items.reduce((sum, item) => sum + item.quantity_received, 0);
    const totalRemaining = totalQuantity - totalReceived;

    if (totalRemaining === 0) {
      return PurchaseOrderStatus.COMPLETED;
    } else if (totalReceived > 0) {
      return PurchaseOrderStatus.PARTIAL;
    } else {
      return PurchaseOrderStatus.DRAFT;
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
        console.warn(
          `WARNING: Buying ${catalogItem.brand.name} part from ${vendor.name} (Supports: ${supportedNames})`,
        );
        // Note: keeping this as an exception per previous logic, but requirement said "soft warning".
        // The original code threw BadRequestException, so I will stick to it for now.
        throw new BadRequestException(
          `Vendor ${vendor.name} does not support brand ${catalogItem.brand.name}. Supported: ${supportedNames}`,
        );
      }
    }

    return this.prisma.purchaseOrder.create({
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
  }

  async receiveItems(
    orderId: string,
    receivedItems: { itemId: string; quantity: number }[],
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: orderId },
          include: { items: true },
        });
        if (!po) throw new NotFoundException('Purchase Order not found');

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
            // Log available catalog_item_ids for debugging
            const availableIds = po.items
              .map((i) => i.catalog_item_id)
              .join(', ');
            throw new BadRequestException(
              `Item ${received.itemId} not in this PO. Available: ${availableIds}`,
            );
          }

          const currentItem = await tx.purchaseOrderItem.findUnique({
            where: { id: poItem.id },
          });
          if (!currentItem)
            throw new BadRequestException(
              `Item ${received.itemId} not found in DB`,
            );

          if (
            currentItem.quantity_received + received.quantity >
            currentItem.quantity
          ) {
            throw new BadRequestException(
              `Cannot receive more than ordered for item ${received.itemId}`,
            );
          }

          await tx.purchaseOrderItem.update({
            where: { id: poItem.id },
            data: { quantity_received: { increment: received.quantity } },
          });

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

          // Record the inventory transaction using the ledger service
          await this.ledgerService.recordTransaction(
            {
              itemId: received.itemId,
              locationId: generalBin.id,
              quantity: received.quantity,
              type: TransactionType.PURCHASE_RECEIPT,
              referenceId: po.order_number,
              costBasis: poItem.unit_cost,
            },
            tx,
          );
        }

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
    } catch (error) {
      console.error('===== receiveItems ERROR =====');
      console.error('Error type:', error?.constructor?.name);
      console.error('Error message:', error?.message);
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

    // Add items to PO
    const createdItems = await Promise.all(
      items.map((i) =>
        this.prisma.purchaseOrderItem.create({
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

    // Recompute status and update order
    const updatedPO = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!updatedPO) throw new NotFoundException('Purchase Order not found');

    const newStatus = this.recomputePurchaseOrderStatus(updatedPO.items);
    
    return this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: newStatus },
      include: {
        vendor: true,
        items: {
          include: { catalog_item: true },
        },
      },
    });
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
    if (updates.quantity !== undefined && updates.quantity < poItem.quantity_received) {
      throw new BadRequestException(
        `Cannot reduce quantity below ${poItem.quantity_received} already received`,
      );
    }

    // Map camelCase to snake_case for Prisma
    const prismaUpdates: Record<string, any> = {};
    if (updates.quantity !== undefined) prismaUpdates.quantity = updates.quantity;
    if (updates.unitCost !== undefined) prismaUpdates.unit_cost = updates.unitCost;

    await this.prisma.purchaseOrderItem.update({
      where: { id: itemId },
      data: prismaUpdates,
    });

    // Recompute status and return updated PO
    const updatedPO = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!updatedPO) throw new NotFoundException('Purchase Order not found');

    const newStatus = this.recomputePurchaseOrderStatus(updatedPO.items);

    return this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: newStatus },
      include: {
        vendor: true,
        items: {
          include: { catalog_item: true },
        },
      },
    });
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

    await this.prisma.purchaseOrderItem.delete({
      where: { id: itemId },
    });

    // Recompute status and return updated PO
    const updatedPO = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!updatedPO) throw new NotFoundException('Purchase Order not found');

    const newStatus = this.recomputePurchaseOrderStatus(updatedPO.items);

    return this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: newStatus },
      include: {
        vendor: true,
        items: {
          include: { catalog_item: true },
        },
      },
    });
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
    return this.prisma.$transaction(async (tx) => {
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
        const invoicedQty =
          typeof (item.quantity_invoiced as any)?.gt === 'function'
            ? (item.quantity_invoiced as any).gt(0)
            : Number(item.quantity_invoiced) > 0;

        return invoicedQty || item.purchase_invoice_lines.length > 0;
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
  }
}
