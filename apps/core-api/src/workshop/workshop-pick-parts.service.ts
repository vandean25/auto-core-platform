import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  PartsReservationKind,
  PartsReservationStatus,
  Prisma,
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import { AtpService } from '../inventory/atp.service.js';
import { LedgerService } from '../inventory/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PickWorkshopPartsDto } from './dto/pick-workshop-parts.dto.js';
import {
  aggregateRequestedPicks,
  buildLedgerTransactions,
  buildMovedLines,
  buildStagePlans,
  calculateStagedQuantitiesByLine,
  findFullyStagedLineIds,
  loadAndLockPickContext,
  PICK_ELIGIBLE_ORDER_STATUSES,
} from './workshop-pick-allocation.helpers.js';
import type {
  LockRowsFn,
  ReservationSlice,
  SourceStock,
  StagePlan,
} from './workshop-pick-allocation.helpers.js';

import Decimal = Prisma.Decimal;

export interface ValidateOrderStagingParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  orderId: string;
  destinationLocationId: string;
}

export type SetOrderStagingLocationParams = ValidateOrderStagingParams;

export interface PersistStageStateContext {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  order?: { id: string };
  orderId?: string;
  destinationLocationId: string;
  plans: StagePlan[];
  reservationsByLine: Map<string, ReservationSlice[]>;
  transferGroupId: string;
  fullyStagedLineIds?: Set<string>;
}

function aggregateQuantitiesByStock(
  plans: StagePlan[],
): Array<{ stock: SourceStock; quantity: Decimal }> {
  const quantitiesByStock = new Map<
    string,
    { stock: SourceStock; quantity: Decimal }
  >();
  for (const plan of plans) {
    const existing = quantitiesByStock.get(plan.sourceStock.id);
    if (existing) {
      existing.quantity = existing.quantity.add(plan.quantity);
    } else {
      quantitiesByStock.set(plan.sourceStock.id, {
        stock: plan.sourceStock,
        quantity: plan.quantity,
      });
    }
  }
  return Array.from(quantitiesByStock.values());
}

async function lockEntityRows(
  tx: Prisma.TransactionClient,
  tableName:
    | 'workshop_tasks'
    | 'workshop_task_line_items'
    | 'parts_reservations'
    | 'inventory_stocks',
  tenantId: string,
  ids: readonly string[],
): Promise<void> {
  const uniqueIds = Array.from(new Set(ids)).sort();
  if (uniqueIds.length === 0) {
    return;
  }

  const tableIdentifier = Prisma.raw(tableName);
  const idList = Prisma.join(uniqueIds);
  // eslint-disable-next-line no-restricted-syntax -- phase-3 lock hierarchy requires sorted tenant-qualified row locks.
  await tx.$queryRaw`
    SELECT id
    FROM ${tableIdentifier}
    WHERE tenant_id = ${tenantId}
      AND id IN (${idList})
    ORDER BY id
    FOR UPDATE
  `;
}

async function updateReservations(
  db: Prisma.TransactionClient | PrismaService,
  tenantId: string,
  plans: StagePlan[],
): Promise<void> {
  await chunkedPromiseAll(plans, async (plan) => {
    const receivedQuantity = plan.reservation.quantity_received.add(
      plan.quantity,
    );
    const data: Prisma.PartsReservationUpdateManyMutationInput = {
      quantity_received: { increment: plan.quantity },
      quantity_staged: { increment: plan.quantity },
      status: receivedQuantity.gte(plan.reservation.quantity)
        ? PartsReservationStatus.STAGED
        : PartsReservationStatus.OPEN,
    };
    if (plan.reservation.quantity_received.eq(0)) {
      data.tote_cost_basis = plan.costBasis;
    }

    const updateResult = await db.partsReservation.updateMany({
      where: {
        tenant_id: tenantId,
        id: plan.reservation.id,
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        quantity_received: plan.reservation.quantity_received,
      },
      data,
    });
    if (updateResult.count !== 1) {
      throw new ConflictException(
        `Parts reservation ${plan.reservation.id} changed during staging. Refresh and retry.`,
      );
    }
  });
}

async function updateLineItemStatuses(
  db: Prisma.TransactionClient | PrismaService,
  tenantId: string,
  fullyStagedLineIds: string[],
): Promise<void> {
  if (fullyStagedLineIds.length === 0) {
    return;
  }
  await db.workshopTaskLineItem.updateMany({
    where: {
      tenant_id: tenantId,
      id: { in: fullyStagedLineIds },
      type: WorkshopLineItemType.PART,
      part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
    },
    data: { part_execution_status: WorkshopPartLineExecutionStatus.STAGED },
  });
}

async function incrementTaskVersions(
  db: Prisma.TransactionClient | PrismaService,
  tenantId: string,
  taskIds: string[],
): Promise<void> {
  const versionUpdate = await db.workshopTask.updateMany({
    where: { tenant_id: tenantId, id: { in: taskIds } },
    data: { line_items_version: { increment: 1 } },
  });
  if (versionUpdate.count !== taskIds.length) {
    throw new ConflictException(
      'Workshop task changed during pick execution. Refresh and retry.',
    );
  }
}

@Injectable()
export class WorkshopPickPartsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LedgerService) private readonly ledgerService: LedgerService,
    @Inject(AtpService) private readonly atpService: AtpService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    @Inject(SiteContextService)
    private readonly siteContext: SiteContextService,
  ) {}

  async pickParts(orderId: string, dto: PickWorkshopPartsDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();

    return this.prisma.$transaction(async (tx) => {
      const { order, destinationLocation } =
        await this.validateOrderAndStagingLocation({
          tx,
          tenantId,
          siteId,
          orderId,
          destinationLocationId: dto.destinationLocationId,
        });
      const requestedPicks = aggregateRequestedPicks(dto.items);
      const lockRowsFn: LockRowsFn = lockEntityRows;

      const { lines, reservationsByLine } = await loadAndLockPickContext(
        tx,
        tenantId,
        orderId,
        requestedPicks,
        lockRowsFn,
      );
      const plans = await buildStagePlans(
        tx,
        tenantId,
        siteId,
        destinationLocation.id,
        lines,
        reservationsByLine,
        requestedPicks,
        lockRowsFn,
      );
      const transferGroupId = `WO-PICK-${order.id}-${Date.now()}`;
      const ledgerTransactions = buildLedgerTransactions(
        plans,
        destinationLocation.id,
        transferGroupId,
      );

      await this.releaseReservedStock(tx, plans);
      await this.ledgerService.recordTransactions(ledgerTransactions, tx);
      const { movedLines } = await this.persistStageState({
        tx,
        tenantId,
        siteId,
        order,
        orderId: order.id,
        destinationLocationId: destinationLocation.id,
        plans,
        reservationsByLine,
        transferGroupId,
      });

      return {
        id: order.id,
        stagingLocationId: destinationLocation.id,
        transferGroupId,
        movedLines,
      };
    });
  }

  private async validateOrderAndStagingLocation(
    params: ValidateOrderStagingParams,
  ) {
    const { tx, tenantId, siteId, orderId, destinationLocationId } = params;
    const db = tx ?? this.prisma;
    const order = await db.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      select: {
        id: true,
        site_id: true,
        status: true,
        staging_location_id: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Workshop order ${orderId} not found`);
    }
    if (order.site_id !== siteId) {
      throw new NotFoundException(`Workshop order ${orderId} not found`);
    }
    if (!PICK_ELIGIBLE_ORDER_STATUSES.includes(order.status)) {
      throw new UnprocessableEntityException(
        `Workshop order status ${order.status} is not eligible for pick execution`,
      );
    }
    if (
      order.staging_location_id &&
      order.staging_location_id !== destinationLocationId
    ) {
      throw new ConflictException(
        'Workshop order is already linked to a different staging location',
      );
    }

    const destinationLocation = await db.storageLocation.findFirst({
      where: {
        id: destinationLocationId,
        tenant_id: tenantId,
        site_id: siteId,
        deletedAt: null,
        type: LocationType.staging_tote,
        site: { is_active: true },
      },
      select: {
        id: true,
        type: true,
        deletedAt: true,
        site_id: true,
      },
    });

    if (!destinationLocation) {
      throw new NotFoundException(
        `Destination location ${destinationLocationId} is not available in the active site`,
      );
    }

    return { order, destinationLocation };
  }

  private async releaseReservedStock(
    tx: Prisma.TransactionClient,
    plans: StagePlan[],
  ): Promise<void> {
    const stockReleases = aggregateQuantitiesByStock(plans);
    await chunkedPromiseAll(stockReleases, async ({ stock, quantity }) => {
      try {
        await this.atpService.releaseOnHand(
          { stockId: stock.id, quantity },
          tx ?? this.prisma,
        );
      } catch (error) {
        if (error instanceof ConflictException) {
          throw new ConflictException(
            `Inventory ATP changed before staging stock ${stock.id}. Refresh and retry.`,
          );
        }
        throw error;
      }
    });
  }

  private async setOrderStagingLocation(
    params: SetOrderStagingLocationParams,
  ): Promise<void> {
    const { tx, tenantId, siteId, orderId, destinationLocationId } = params;
    const db = tx ?? this.prisma;
    const orderUpdateResult = await db.workshopOrder.updateMany({
      where: {
        tenant_id: tenantId,
        id: orderId,
        site_id: siteId,
        status: { in: PICK_ELIGIBLE_ORDER_STATUSES },
        OR: [
          { staging_location_id: null },
          { staging_location_id: destinationLocationId },
        ],
      },
      data: { staging_location_id: destinationLocationId },
    });
    if (orderUpdateResult.count === 0) {
      throw new ConflictException(
        'Workshop order changed during pick execution. Refresh and retry.',
      );
    }
  }

  private async persistStageState(ctx: PersistStageStateContext) {
    const {
      tx,
      tenantId,
      siteId,
      destinationLocationId,
      plans,
      reservationsByLine,
      transferGroupId,
    } = ctx;
    const orderId = ctx.orderId ?? ctx.order?.id;
    if (!orderId) {
      throw new ConflictException(
        'Workshop order ID missing from staging context',
      );
    }

    const db = tx ?? this.prisma;
    await updateReservations(db, tenantId, plans);

    const stagedByLine = calculateStagedQuantitiesByLine(
      plans,
      reservationsByLine,
    );
    const fullyStagedLineIds =
      ctx.fullyStagedLineIds ?? findFullyStagedLineIds(plans, stagedByLine);
    await updateLineItemStatuses(
      db,
      tenantId,
      Array.isArray(fullyStagedLineIds)
        ? fullyStagedLineIds
        : [...fullyStagedLineIds],
    );

    const taskIds = [
      ...new Set(plans.map((plan) => plan.line.workshop_task_id)),
    ];
    await incrementTaskVersions(db, tenantId, taskIds);

    await this.setOrderStagingLocation({
      tx: db,
      tenantId,
      siteId,
      orderId,
      destinationLocationId,
    });

    const movedLines = buildMovedLines(plans, transferGroupId);
    return { movedLines };
  }
}
