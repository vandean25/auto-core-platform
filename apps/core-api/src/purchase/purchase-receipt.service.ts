import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  PartsReservationStatus,
  PurchaseOrderStatus,
  TransactionType,
  Prisma,
  StorageLocation,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LedgerService,
  RecordTransactionParams,
} from '../inventory/ledger.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { SiteContextService } from '../common/services/site-context.service';
import { SiteService } from '../site/site.service';
import { chunkedPromiseAll } from '../common/utils/promise.util';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition';
import {
  aggregateAndValidateReceiptItems,
  determinePostReceiptStatus,
  determineReceivedReservationStatus,
  isAllocatedReservation,
  IncomingReceiptItem,
  ValidatedAggregatedReceiptItem,
} from './purchase-receipt.helpers';
import {
  lockPurchaseOrderHeader,
  lockPurchaseOrderItems,
  lockPartsReservations,
  lockWorkshopTaskLineItems,
  lockWorkshopTasks,
} from './purchase-lock.helpers';

import Decimal = Prisma.Decimal;

const RECEIVABLE_STATUSES: ReadonlySet<PurchaseOrderStatus> = new Set([
  PurchaseOrderStatus.DRAFT,
  PurchaseOrderStatus.SENT,
  PurchaseOrderStatus.PARTIAL,
]);

const RECEIPT_PO_INCLUDE = {
  items: {
    include: {
      parts_reservation: {
        select: {
          id: true,
          status: true,
          detached_at: true,
          quantity: true,
          quantity_received: true,
          workshop_task_line_item: {
            select: {
              id: true,
              workshop_task_id: true,
              workshop_task: {
                select: {
                  id: true,
                  workshop_order: {
                    select: {
                      id: true,
                      site_id: true,
                      staging_location_id: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

type ReceiptPurchaseOrder = Prisma.PurchaseOrderGetPayload<{
  include: typeof RECEIPT_PO_INCLUDE;
}>;

type ReceiptPoItem = ReceiptPurchaseOrder['items'][number];

type ReceiptReservation = NonNullable<ReceiptPoItem['parts_reservation']>;

export type PurchaseOrderWithItems = Prisma.PurchaseOrderGetPayload<{
  include: { items: true };
}>;

interface ApplyReceiptItemsParams {
  tenantId: string;
  siteId: string;
  orderNumber: string;
  generalBinId: string;
  poItemById: Map<string, ReceiptPoItem>;
  validatedItems: ValidatedAggregatedReceiptItem[];
}

interface StageReservationParams {
  tenantId: string;
  reservation: ReceiptReservation;
  quantity: Decimal;
  quantityReceived: Decimal;
  unitCost: Decimal;
  toteId: string;
}

interface FreeStockLocationParams {
  tenantId: string;
  siteId: string;
  received: IncomingReceiptItem;
  reservation: ReceiptPoItem['parts_reservation'];
  generalBinId: string;
}

function collectReceiptLocks(order: ReceiptPurchaseOrder) {
  const taskIds = new Set<string>();
  const lineIds = new Set<string>();
  const reservationIds = new Set<string>();

  for (const item of order.items) {
    const reservation = item.parts_reservation;
    if (!reservation) {
      continue;
    }
    reservationIds.add(reservation.id);
    lineIds.add(reservation.workshop_task_line_item.id);
    taskIds.add(reservation.workshop_task_line_item.workshop_task_id);
  }

  return {
    taskIds: [...taskIds],
    lineIds: [...lineIds],
    reservationIds: [...reservationIds],
    itemIds: order.items.map((item) => item.id),
  };
}

function requireJobTote(
  reservation: ReceiptReservation,
  poItemId: string,
): string {
  const toteId =
    reservation.workshop_task_line_item.workshop_task.workshop_order
      .staging_location_id;
  if (!toteId) {
    throw new UnprocessableEntityException(
      `Workshop order for purchase order item ${poItemId} has no staging tote assigned.`,
    );
  }
  return toteId;
}

@Injectable()
export class PurchaseReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly tenantContext: TenantContextService,
    private readonly siteService: SiteService,
    private readonly siteContext: SiteContextService,
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
   *
   * Allocated reservations transfer straight into their job tote; released
   * reservations and unlinked items land as free warehouse stock.
   */
  async receiveItems(
    orderId: string,
    receivedItems: IncomingReceiptItem[],
  ): Promise<PurchaseOrderWithItems> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();

    return this.prisma.$transaction(async (tx) => {
      const snapshot = await this.loadReceiptOrder(tx, tenantId, orderId);
      this.assertReceivable(snapshot);

      const locks = collectReceiptLocks(snapshot);
      await lockWorkshopTasks(tx, tenantId, locks.taskIds);
      await lockWorkshopTaskLineItems(tx, tenantId, locks.lineIds);
      await lockPartsReservations(tx, tenantId, locks.reservationIds);
      await lockPurchaseOrderHeader(tx, tenantId, orderId);
      await lockPurchaseOrderItems(tx, tenantId, locks.itemIds);

      const po = await this.loadReceiptOrder(tx, tenantId, orderId);
      this.assertReceivable(po);

      const poItemById = new Map(po.items.map((item) => [item.id, item]));
      const validatedItems = aggregateAndValidateReceiptItems(
        receivedItems,
        po.items,
        poItemById,
      );

      const { generalBin } = await this.resolveWarehouseAndGeneralBin(
        tx,
        tenantId,
      );

      const { ledgerEntries, affectedTaskIds } = await this.applyReceiptItems(
        tx,
        {
          tenantId,
          siteId,
          orderNumber: po.order_number,
          generalBinId: generalBin.id,
          poItemById,
          validatedItems,
        },
      );

      await this.ledgerService.recordTransactions(ledgerEntries, tx);
      await this.incrementTaskVersions(tx, tenantId, affectedTaskIds);

      return this.finalizePurchaseOrderStatus(tx, tenantId, orderId, po.status);
    });
  }

  private async loadReceiptOrder(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
  ): Promise<ReceiptPurchaseOrder> {
    const order = await tx.purchaseOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      include: RECEIPT_PO_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException('Purchase Order not found');
    }
    return order;
  }

  private assertReceivable(order: ReceiptPurchaseOrder): void {
    if (!RECEIVABLE_STATUSES.has(order.status)) {
      throw new BadRequestException(
        'Only DRAFT, SENT, or PARTIAL purchase orders can receive items',
      );
    }
  }

  private async applyReceiptItems(
    tx: Prisma.TransactionClient,
    params: ApplyReceiptItemsParams,
  ): Promise<{
    ledgerEntries: RecordTransactionParams[];
    affectedTaskIds: string[];
  }> {
    const ledgerEntries: RecordTransactionParams[] = [];
    const affectedTaskIds = new Set<string>();

    await chunkedPromiseAll(params.validatedItems, async (validatedItem) => {
      const poItem = params.poItemById.get(validatedItem.poItem.id);
      if (!poItem) {
        throw new ConflictException(
          `Purchase order item ${validatedItem.poItem.id} disappeared during receipt.`,
        );
      }

      await this.incrementReceivedQuantity(
        tx,
        params.tenantId,
        poItem,
        validatedItem,
      );

      const reservation = poItem.parts_reservation;
      if (isAllocatedReservation(reservation)) {
        const toteId = requireJobTote(reservation, poItem.id);
        await this.stageReservation(tx, {
          tenantId: params.tenantId,
          reservation,
          quantity: validatedItem.quantity,
          quantityReceived: validatedItem.quantityReceived,
          unitCost: new Decimal(poItem.unit_cost),
          toteId,
        });
        affectedTaskIds.add(
          reservation.workshop_task_line_item.workshop_task_id,
        );
        ledgerEntries.push({
          itemId: poItem.catalog_item_id,
          locationId: toteId,
          quantity: validatedItem.quantity,
          type: TransactionType.PURCHASE_RECEIPT,
          referenceId: params.orderNumber,
          costBasis: poItem.unit_cost,
          partsReservationId: reservation.id,
        });
        return;
      }

      const locationId = await this.resolveFreeStockLocation(tx, {
        tenantId: params.tenantId,
        siteId: params.siteId,
        received: validatedItem.received,
        reservation,
        generalBinId: params.generalBinId,
      });
      ledgerEntries.push({
        itemId: poItem.catalog_item_id,
        locationId,
        quantity: validatedItem.quantity,
        type: TransactionType.PURCHASE_RECEIPT,
        referenceId: params.orderNumber,
        costBasis: poItem.unit_cost,
      });
    });

    return { ledgerEntries, affectedTaskIds: [...affectedTaskIds] };
  }

  private async incrementReceivedQuantity(
    tx: Prisma.TransactionClient,
    tenantId: string,
    poItem: ReceiptPoItem,
    validatedItem: ValidatedAggregatedReceiptItem,
  ): Promise<void> {
    const updateResult = await tx.purchaseOrderItem.updateMany({
      where: {
        id: poItem.id,
        tenant_id: tenantId,
        quantity_received: validatedItem.quantityReceived,
      },
      data: { quantity_received: { increment: validatedItem.quantity } },
    });

    if (updateResult.count === 0) {
      throw new ConflictException(
        `Purchase order item ${poItem.id} was updated concurrently. Please refresh and try again.`,
      );
    }
  }

  private async stageReservation(
    tx: Prisma.TransactionClient,
    params: StageReservationParams,
  ): Promise<void> {
    const nextStatus = determineReceivedReservationStatus(
      params.reservation.quantity,
      params.quantityReceived.add(params.quantity),
    );
    const data: Prisma.PartsReservationUncheckedUpdateManyInput = {
      quantity_received: { increment: params.quantity },
      quantity_staged: { increment: params.quantity },
      status: nextStatus,
      location_id: params.toteId,
    };
    if (new Decimal(params.reservation.quantity_received).eq(0)) {
      data.tote_cost_basis = params.unitCost;
    }

    const updateResult = await tx.partsReservation.updateMany({
      where: {
        tenant_id: params.tenantId,
        id: params.reservation.id,
        status: {
          in: [PartsReservationStatus.OPEN, PartsReservationStatus.ORDERED],
        },
        detached_at: null,
        quantity_received: new Decimal(params.reservation.quantity_received),
      },
      data,
    });

    if (updateResult.count !== 1) {
      throw new ConflictException(
        `Parts reservation ${params.reservation.id} changed during receipt. Please refresh and try again.`,
      );
    }
  }

  private async resolveFreeStockLocation(
    tx: Prisma.TransactionClient,
    params: FreeStockLocationParams,
  ): Promise<string> {
    if (params.received.locationId) {
      const location = await tx.storageLocation.findFirst({
        where: {
          id: params.received.locationId,
          tenant_id: params.tenantId,
          site_id: params.siteId,
          deletedAt: null,
          type: LocationType.bin,
        },
        select: { id: true },
      });
      if (!location) {
        throw new UnprocessableEntityException(
          'Free-stock receipt location is not available in the active site.',
        );
      }
      return location.id;
    }

    if (params.reservation) {
      throw new UnprocessableEntityException(
        'locationId is required to receive a released purchase order item into free stock.',
      );
    }

    return params.generalBinId;
  }

  private async incrementTaskVersions(
    tx: Prisma.TransactionClient,
    tenantId: string,
    taskIds: string[],
  ): Promise<void> {
    if (taskIds.length === 0) {
      return;
    }

    const versionUpdate = await tx.workshopTask.updateMany({
      where: { tenant_id: tenantId, id: { in: taskIds } },
      data: { line_items_version: { increment: 1 } },
    });
    if (versionUpdate.count !== taskIds.length) {
      throw new ConflictException(
        'Workshop task changed during receipt. Please refresh and try again.',
      );
    }
  }

  private async finalizePurchaseOrderStatus(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    currentStatus: PurchaseOrderStatus,
  ): Promise<PurchaseOrderWithItems> {
    const updatedPO = await tx.purchaseOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      include: { items: true },
    });

    if (!updatedPO) {
      throw new NotFoundException('Failed to retrieve updated PO');
    }

    const newStatus = determinePostReceiptStatus(
      updatedPO.items,
      currentStatus,
    );

    if (newStatus === currentStatus) {
      return updatedPO;
    }

    await guardedStatusUpdate(bindStatusUpdateMany(tx.purchaseOrder), {
      id: orderId,
      tenantId,
      from: currentStatus,
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
}
