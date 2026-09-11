import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  PurchaseOrderStatus,
  TransactionType,
  Prisma,
  StorageLocation,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../inventory/ledger.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { SiteService } from '../site/site.service';
import { chunkedPromiseAll } from '../common/utils/promise.util';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition';
import {
  aggregateAndValidateReceiptItems,
  determinePostReceiptStatus,
  IncomingReceiptItem,
} from './purchase-receipt.helpers';
import {
  lockPurchaseOrderHeader,
  lockPurchaseOrderItems,
} from './purchase-lock.helpers';

export type PurchaseOrderWithItems = Prisma.PurchaseOrderGetPayload<{
  include: { items: true };
}>;

@Injectable()
export class PurchaseReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly tenantContext: TenantContextService,
    private readonly siteService: SiteService,
  ) {}

  /**
   * Resolves the default warehouse and general bin for the tenant.
   * If either does not exist, it is created automatically.
   */
  async resolveWarehouseAndGeneralBin(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<{ warehouse: StorageLocation; generalBin: StorageLocation }> {
    let warehouse = await tx.storageLocation.findFirst({
      where: { tenant_id: tenantId, type: 'warehouse' },
    });

    if (!warehouse) {
      const siteId = await this.siteService.resolveDefaultSiteId(tenantId);
      warehouse = await tx.storageLocation.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          name: 'Default Warehouse',
          code: 'WH-001',
          type: 'warehouse',
        },
      });
    }

    let generalBin = await tx.storageLocation.findFirst({
      where: {
        tenant_id: tenantId,
        parent_id: warehouse.id,
        type: 'bin',
        name: 'General Bin',
      },
    });

    if (!generalBin) {
      generalBin = await tx.storageLocation.create({
        data: {
          tenant_id: tenantId,
          site_id: warehouse.site_id,
          name: 'General Bin',
          code: `${warehouse.code}-GEN`,
          type: 'bin',
          parent_id: warehouse.id,
        },
      });
    }

    return { warehouse, generalBin };
  }

  /**
   * Receives items on a purchase order, updates quantities atomically with
   * optimistic locking, records ledger transactions, and transitions the PO status.
   */
  async receiveItems(
    orderId: string,
    receivedItems: IncomingReceiptItem[],
  ): Promise<PurchaseOrderWithItems> {
    const tenantId = await this.tenantContext.getTenantId();

    return this.prisma.$transaction(async (tx) => {
      await lockPurchaseOrderHeader(tx, tenantId, orderId);

      const po = await tx.purchaseOrder.findFirst({
        where: { id: orderId, tenant_id: tenantId },
        include: { items: true },
      });
      if (!po) {
        throw new NotFoundException('Purchase Order not found');
      }

      if (
        po.status !== PurchaseOrderStatus.DRAFT &&
        po.status !== PurchaseOrderStatus.SENT &&
        po.status !== PurchaseOrderStatus.PARTIAL
      ) {
        throw new BadRequestException(
          'Only DRAFT, SENT, or PARTIAL purchase orders can receive items',
        );
      }

      const poItemIds = po.items.map((item) => item.id);
      await lockPurchaseOrderItems(tx, tenantId, poItemIds);

      const { generalBin } = await this.resolveWarehouseAndGeneralBin(
        tx,
        tenantId,
      );

      const currentItems = await tx.purchaseOrderItem.findMany({
        where: { id: { in: poItemIds }, tenant_id: tenantId },
      });
      const currentItemsMap = new Map(
        currentItems.map((item) => [item.id, item]),
      );

      const validatedAggregatedItems = aggregateAndValidateReceiptItems(
        receivedItems,
        po.items,
        currentItemsMap,
      );

      // Batch write item updates with optimistic concurrency check
      await chunkedPromiseAll(
        validatedAggregatedItems,
        async ({ poItem, quantity, received, quantityReceived }) => {
          const updateResult = await tx.purchaseOrderItem.updateMany({
            where: {
              id: poItem.id,
              tenant_id: tenantId,
              quantity_received: quantityReceived,
            },
            data: { quantity_received: { increment: quantity } },
          });

          if (updateResult.count === 0) {
            throw new ConflictException(
              `Purchase order item ${poItem.id} was updated concurrently. Please refresh and try again.`,
            );
          }

          // Record the inventory transaction using the ledger service
          await this.ledgerService.recordTransactions(
            [
              {
                itemId: received.itemId,
                locationId: generalBin.id,
                quantity,
                type: TransactionType.PURCHASE_RECEIPT,
                referenceId: po.order_number,
                costBasis: poItem.unit_cost,
              },
            ],
            tx,
          );
        },
      );

      const updatedPO = await tx.purchaseOrder.findFirst({
        where: { id: orderId, tenant_id: tenantId },
        include: { items: true },
      });

      if (!updatedPO) {
        throw new NotFoundException('Failed to retrieve updated PO');
      }

      const newStatus = determinePostReceiptStatus(updatedPO.items, po.status);

      if (newStatus !== po.status) {
        await guardedStatusUpdate(bindStatusUpdateMany(tx.purchaseOrder), {
          id: orderId,
          tenantId,
          from: po.status,
          to: newStatus,
          conflictMessage:
            'Purchase order status changed concurrently. Please refresh and try again.',
        });

        const refreshedPO = await tx.purchaseOrder.findFirst({
          where: { id: orderId, tenant_id: tenantId },
          include: { items: true },
        });

        if (!refreshedPO) {
          throw new NotFoundException('Failed to retrieve refreshed PO');
        }

        return refreshedPO;
      }

      return updatedPO;
    });
  }
}
