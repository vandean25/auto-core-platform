import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../inventory/ledger.service';
import { PurchaseOrderStatus, TransactionType } from '@prisma/client';

@Injectable()
export class PurchaseService {
  constructor(
    private prisma: PrismaService,
    private ledgerService: LedgerService,
  ) {}

  private generateOrderNumber(): string {
    const date = new Date();
    return `PO-${date.getFullYear()}-${Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0')}`;
  }

  async createPurchaseOrder(
    vendorId: string,
    items: { catalogItemId: string; quantity: number; unitCost: number }[],
  ) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const itemIds = items.map((i) => i.catalogItemId);
    const catalogItems = await this.prisma.catalogItem.findMany({
      where: { id: { in: itemIds } },
    });

    for (const item of items) {
      const catalogItem = catalogItems.find((c) => c.id === item.catalogItemId);
      if (!catalogItem)
        throw new BadRequestException(
          `Catalog Item ${item.catalogItemId} not found`,
        );

      if (
        catalogItem.brand &&
        !vendor.supported_brands.includes(catalogItem.brand)
      ) {
        console.warn(
          `WARNING: Buying ${catalogItem.brand} part from ${vendor.name} (Supports: ${vendor.supported_brands.join(', ')})`,
        );
        throw new BadRequestException(
          `Vendor ${vendor.name} does not support brand ${catalogItem.brand}. Supported: ${vendor.supported_brands.join(', ')}`,
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
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!po) throw new NotFoundException('Purchase Order not found');

      for (const received of receivedItems) {
        const poItem = po.items.find(
          (i) => i.catalog_item_id === received.itemId,
        );
        if (!poItem)
          throw new BadRequestException(
            `Item ${received.itemId} not in this PO`,
          );

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

        let location = await tx.storageLocation.findFirst({
          where: { type: 'warehouse' },
        });
        if (!location) {
          location = await tx.storageLocation.create({
            data: { name: 'Default Warehouse', type: 'warehouse' },
          });
        }

        await this.ledgerService.recordTransaction(
          {
            itemId: received.itemId,
            locationId: location.id,
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
      const anyReceived = updatedPO.items.some((i) => i.quantity_received > 0);
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
  }

  async findAll(status?: string) {
    let where = {};
    const filter = status || 'open';

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
        vendor: true,
        items: {
          include: { catalog_item: true },
        },
      },
    });
  }
}
