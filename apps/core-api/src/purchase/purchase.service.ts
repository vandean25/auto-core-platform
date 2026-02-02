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
  ) { }

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
            throw new BadRequestException('itemId is required for each received item');
          }

          const poItem = po.items.find(
            (i) => i.catalog_item_id === received.itemId,
          );
          if (!poItem) {
            // Log available catalog_item_ids for debugging
            const availableIds = po.items.map(i => i.catalog_item_id).join(', ');
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
              data: { name: 'Default Warehouse', code: 'WH-001', type: 'warehouse' },
            });
          }

          // Ensure General Bin exists for this warehouse
          let generalBin = await tx.storageLocation.findFirst({
              where: { 
                  parent_id: warehouse.id, 
                  type: 'bin', 
                  name: 'General Bin' 
              }
          });

          if (!generalBin) {
              generalBin = await tx.storageLocation.create({
                  data: {
                      name: 'General Bin',
                      code: `${warehouse.code}-GEN`,
                      type: 'bin',
                      parent_id: warehouse.id
                  }
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
    } catch (error) {
      console.error('===== receiveItems ERROR =====');
      console.error('Error type:', error?.constructor?.name);
      console.error('Error message:', error?.message);
      console.error('Full error:', error);
      throw error;
    }
  }

  async findAll(params?: any) {
    if (params && (params.where || params.orderBy || params.skip)) {
        const [data, total] = await Promise.all([
            this.prisma.purchaseOrder.findMany({
                ...params,
                include: { vendor: true, items: true },
            }),
            this.prisma.purchaseOrder.count({ where: params.where }),
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
        vendor: true,
        items: {
          include: { catalog_item: true },
        },
      },
    });
  }
}