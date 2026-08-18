import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PickWorkshopPartsDto } from './dto/pick-workshop-parts.dto';
import {
  Prisma,
  TransactionType,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { LedgerService } from '../inventory/ledger.service';
import type { RecordTransactionParams } from '../inventory/ledger.service';
import { TenantContextService } from '../common/services/tenant-context.service';

const PICK_ELIGIBLE_ORDER_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

type SourceAllocation = {
  sourceLocationId: string;
  quantity: number;
};

type AllocationReservationMap = Map<string, number>;

@Injectable()
export class WorkshopPickPartsService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(LedgerService) private ledgerService: LedgerService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  private assertPickEligible(status: WorkshopOrderStatus) {
    if (!PICK_ELIGIBLE_ORDER_STATUSES.includes(status)) {
      throw new UnprocessableEntityException(
        `Workshop order status ${status} is not eligible for pick execution`,
      );
    }
  }

  private getAllocationReservationKey(
    catalogItemId: string,
    sourceLocationId: string,
  ) {
    return `${catalogItemId}:${sourceLocationId}`;
  }

  private async allocateFromExplicitSource(
    tx: Prisma.TransactionClient,
    catalogItemId: string,
    sourceLocationId: string,
    quantity: number,
    reservations: AllocationReservationMap,
  ): Promise<SourceAllocation[]> {
    const tenantId = await this.tenantContext.getTenantId();
    const sourceLocation = await tx.storageLocation.findFirst({
      where: { id: sourceLocationId, tenant_id: tenantId },
      select: {
        id: true,
        type: true,
        deletedAt: true,
      },
    });

    if (!sourceLocation || sourceLocation.deletedAt) {
      throw new NotFoundException(
        `Source location ${sourceLocationId} not found`,
      );
    }

    if (sourceLocation.type !== 'bin') {
      throw new UnprocessableEntityException(
        `sourceLocationId must reference a BIN location. Received ${sourceLocation.type}.`,
      );
    }

    const sourceStock = await tx.inventoryStock.findFirst({
      where: {
        tenant_id: tenantId,
        catalog_item_id: catalogItemId,
        location_id: sourceLocationId,
      },
      select: {
        quantity_on_hand: true,
      },
    });

    const reservationKey = this.getAllocationReservationKey(
      catalogItemId,
      sourceLocationId,
    );
    const reservedQuantity = reservations.get(reservationKey) ?? 0;
    const available = (sourceStock?.quantity_on_hand ?? 0) - reservedQuantity;
    if (available < quantity) {
      throw new UnprocessableEntityException(
        `Insufficient stock in location ${sourceLocationId}. Requested ${quantity}, available ${Math.max(available, 0)}.`,
      );
    }

    return [{ sourceLocationId, quantity }];
  }

  private async allocateAcrossSources(
    tx: Prisma.TransactionClient,
    catalogItemId: string,
    quantity: number,
    reservations: AllocationReservationMap,
  ): Promise<SourceAllocation[]> {
    const tenantId = await this.tenantContext.getTenantId();
    const sourceStocks = await tx.inventoryStock.findMany({
      where: {
        tenant_id: tenantId,
        catalog_item_id: catalogItemId,
        quantity_on_hand: { gt: 0 },
        location: {
          type: 'bin',
          deletedAt: null,
        },
      },
      select: {
        location_id: true,
        quantity_on_hand: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { location_id: 'asc' }],
    });

    let remaining = quantity;
    const allocations: SourceAllocation[] = [];

    for (const stock of sourceStocks) {
      if (remaining <= 0) {
        break;
      }

      const reservationKey = this.getAllocationReservationKey(
        catalogItemId,
        stock.location_id,
      );
      const reservedQuantity = reservations.get(reservationKey) ?? 0;
      const availableQuantity = stock.quantity_on_hand - reservedQuantity;

      if (availableQuantity <= 0) {
        continue;
      }

      const allocatedQuantity = Math.min(remaining, availableQuantity);
      if (allocatedQuantity <= 0) {
        continue;
      }

      allocations.push({
        sourceLocationId: stock.location_id,
        quantity: allocatedQuantity,
      });
      remaining -= allocatedQuantity;
    }

    if (remaining > 0) {
      throw new UnprocessableEntityException(
        `Insufficient stock for auto-allocation. Missing quantity ${remaining}.`,
      );
    }

    return allocations;
  }
  async pickParts(orderId: string, dto: PickWorkshopPartsDto) {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.workshopOrder.findFirst({
        where: { id: orderId, tenant_id: tenantId },
        select: {
          id: true,
          order_number: true,
          status: true,
          staging_location_id: true,
        },
      });

      if (!order) {
        throw new NotFoundException(`Workshop order ${orderId} not found`);
      }

      this.assertPickEligible(order.status);

      if (
        order.staging_location_id &&
        order.staging_location_id !== dto.destinationLocationId
      ) {
        throw new ConflictException(
          'Workshop order is already linked to a different staging location',
        );
      }

      const destinationLocation = await tx.storageLocation.findFirst({
        where: { id: dto.destinationLocationId, tenant_id: tenantId },
        select: {
          id: true,
          type: true,
          deletedAt: true,
        },
      });

      if (!destinationLocation || destinationLocation.deletedAt) {
        throw new NotFoundException(
          `Destination location ${dto.destinationLocationId} not found`,
        );
      }

      if (destinationLocation.type !== 'staging_tote') {
        throw new UnprocessableEntityException(
          'Destination location must be of type staging_tote',
        );
      }

      const aggregatedItems = new Map<
        string,
        {
          workshopTaskLineItemId: string;
          quantity: number;
          sourceLocationId?: string;
        }
      >();

      for (const requestItem of dto.items) {
        const existing = aggregatedItems.get(
          requestItem.workshopTaskLineItemId,
        );
        if (!existing) {
          aggregatedItems.set(requestItem.workshopTaskLineItemId, {
            workshopTaskLineItemId: requestItem.workshopTaskLineItemId,
            quantity: requestItem.quantity,
            sourceLocationId: requestItem.sourceLocationId,
          });
          continue;
        }

        const previousSource = existing.sourceLocationId ?? null;
        const incomingSource = requestItem.sourceLocationId ?? null;

        if (previousSource !== incomingSource) {
          throw new BadRequestException(
            `Duplicate line ${requestItem.workshopTaskLineItemId} must use a single sourceLocationId`,
          );
        }

        existing.quantity += requestItem.quantity;
      }

      const requestedLineItemIds = Array.from(aggregatedItems.keys());
      const lineItems = await tx.workshopTaskLineItem.findMany({
        where: {
          tenant_id: tenantId,
          id: { in: requestedLineItemIds },
          type: WorkshopLineItemType.PART,
          workshop_task: {
            workshop_order_id: orderId,
          },
        },
        select: {
          id: true,
          item_no: true,
          quantity: true,
        },
      });

      if (lineItems.length !== requestedLineItemIds.length) {
        throw new NotFoundException(
          'One or more workshop part line items were not found for this order',
        );
      }

      const skus = Array.from(
        new Set(lineItems.map((lineItem) => lineItem.item_no)),
      );
      const catalogItems = await tx.catalogItem.findMany({
        where: {
          tenant_id: tenantId,
          sku: { in: skus },
        },
        select: {
          id: true,
          sku: true,
        },
      });

      if (catalogItems.length !== skus.length) {
        const catalogItemBySku = new Set(catalogItems.map((item) => item.sku));
        const missingSku = skus.find((sku) => !catalogItemBySku.has(sku));
        throw new NotFoundException(
          `Catalog item not found for workshop line SKU ${missingSku}`,
        );
      }

      const lineItemById = new Map(
        lineItems.map((lineItem) => [lineItem.id, lineItem]),
      );
      const catalogItemBySku = new Map(
        catalogItems.map((item) => [item.sku, item]),
      );
      const transferGroupId = `WO-PICK-${order.id}-${Date.now()}`;
      const ledgerTransactions: RecordTransactionParams[] = [];
      const reservations: AllocationReservationMap = new Map();
      const fullyStagedLineIds = new Set<string>();
      const movedLines: Array<{
        workshopTaskLineItemId: string;
        movedQuantity: number;
        allocations: Array<{
          sourceLocationId: string;
          quantity: number;
          referenceId: string;
        }>;
      }> = [];

      for (const requestedItem of aggregatedItems.values()) {
        const lineItem = lineItemById.get(requestedItem.workshopTaskLineItemId);
        if (!lineItem) {
          throw new NotFoundException(
            `Line item ${requestedItem.workshopTaskLineItemId} not found`,
          );
        }

        const lineItemQuantity = Number(lineItem.quantity);
        if (requestedItem.quantity > lineItemQuantity) {
          throw new BadRequestException(
            `Requested quantity ${requestedItem.quantity} exceeds required quantity ${lineItemQuantity} for line item ${lineItem.id}`,
          );
        }

        if (requestedItem.quantity >= lineItemQuantity) {
          fullyStagedLineIds.add(lineItem.id);
        }

        const catalogItem = catalogItemBySku.get(lineItem.item_no);
        if (!catalogItem) {
          throw new NotFoundException(
            `Catalog item not found for workshop line SKU ${lineItem.item_no}`,
          );
        }

        const allocations = requestedItem.sourceLocationId
          ? await this.allocateFromExplicitSource(
              tx,
              catalogItem.id,
              requestedItem.sourceLocationId,
              requestedItem.quantity,
              reservations,
            )
          : await this.allocateAcrossSources(
              tx,
              catalogItem.id,
              requestedItem.quantity,
              reservations,
            );

        for (const allocation of allocations) {
          const reservationKey = this.getAllocationReservationKey(
            catalogItem.id,
            allocation.sourceLocationId,
          );
          reservations.set(
            reservationKey,
            (reservations.get(reservationKey) ?? 0) + allocation.quantity,
          );
        }

        const allocationSummaries: Array<{
          sourceLocationId: string;
          quantity: number;
          referenceId: string;
        }> = [];

        allocations.forEach((allocation, index) => {
          const referenceId = `${transferGroupId}:${lineItem.id}:${index + 1}`;
          ledgerTransactions.push(
            {
              itemId: catalogItem.id,
              locationId: allocation.sourceLocationId,
              quantity: -allocation.quantity,
              type: TransactionType.TRANSFER_OUT,
              referenceId,
            },
            {
              itemId: catalogItem.id,
              locationId: destinationLocation.id,
              quantity: allocation.quantity,
              type: TransactionType.TRANSFER_IN,
              referenceId,
            },
          );

          allocationSummaries.push({
            sourceLocationId: allocation.sourceLocationId,
            quantity: allocation.quantity,
            referenceId,
          });
        });

        movedLines.push({
          workshopTaskLineItemId: lineItem.id,
          movedQuantity: requestedItem.quantity,
          allocations: allocationSummaries,
        });
      }

      await this.ledgerService.recordTransactions(ledgerTransactions, tx);

      if (fullyStagedLineIds.size > 0) {
        await tx.workshopTaskLineItem.updateMany({
          where: {
            tenant_id: tenantId,
            id: { in: Array.from(fullyStagedLineIds) },
            type: WorkshopLineItemType.PART,
            part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
          },
          data: {
            part_execution_status: WorkshopPartLineExecutionStatus.STAGED,
          },
        });
      }

      const orderUpdateResult = await tx.workshopOrder.updateMany({
        where: {
          tenant_id: tenantId,
          id: orderId,
          status: {
            in: PICK_ELIGIBLE_ORDER_STATUSES,
          },
          OR: [
            { staging_location_id: null },
            { staging_location_id: dto.destinationLocationId },
          ],
        },
        data: {
          staging_location_id: dto.destinationLocationId,
        },
      });

      if (orderUpdateResult.count === 0) {
        throw new ConflictException(
          'Workshop order changed during pick execution. Refresh and retry.',
        );
      }

      return {
        id: order.id,
        stagingLocationId: dto.destinationLocationId,
        transferGroupId,
        movedLines,
      };
    });
  }
}
