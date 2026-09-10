import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  PartsReservationKind,
  PartsReservationStatus,
  Prisma,
  TransactionType,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { SiteContextService } from '../common/services/site-context.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { chunkedPromiseAll } from '../common/utils/promise.util';
import { AtpService } from '../inventory/atp.service';
import { LedgerService } from '../inventory/ledger.service';
import type { RecordTransactionParams } from '../inventory/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PickWorkshopPartsDto } from './dto/pick-workshop-parts.dto';

import Decimal = Prisma.Decimal;

const PICK_ELIGIBLE_ORDER_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

type RequestedPick = {
  workshopTaskLineItemId: string;
  quantity: Decimal;
};

type PickLine = {
  id: string;
  workshop_task_id: string;
  catalog_item_id: string | null;
  quantity: Decimal;
  part_execution_status: WorkshopPartLineExecutionStatus | null;
};

type ReservationSlice = {
  id: string;
  workshop_task_line_item_id: string;
  quantity: Decimal;
  quantity_received: Decimal;
  quantity_staged: Decimal;
  quantity_consumed: Decimal;
  quantity_returned: Decimal;
  kind: PartsReservationKind;
  status: PartsReservationStatus;
  location_id: string | null;
  tote_cost_basis: Decimal | null;
  createdAt: Date;
};

type SourceStock = {
  id: string;
  catalog_item_id: string;
  location_id: string;
  quantity_on_hand: Decimal;
  quantity_reserved: Decimal;
};

type StagePlan = {
  line: PickLine;
  reservation: ReservationSlice;
  sourceStock: SourceStock;
  quantity: Decimal;
  costBasis: Decimal | null;
};

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
        await this.validateOrderAndStagingLocation(
          tx,
          tenantId,
          siteId,
          orderId,
          dto.destinationLocationId,
        );
      const requestedPicks = this.aggregateRequestedPicks(dto.items);
      const { lines, reservationsByLine } = await this.loadAndLockPickContext(
        tx,
        tenantId,
        orderId,
        requestedPicks,
      );
      const plans = await this.buildStagePlans(
        tx,
        tenantId,
        siteId,
        destinationLocation.id,
        lines,
        reservationsByLine,
        requestedPicks,
      );
      const transferGroupId = `WO-PICK-${order.id}-${Date.now()}`;
      const ledgerTransactions = this.buildLedgerTransactions(
        plans,
        destinationLocation.id,
        transferGroupId,
      );

      await this.releaseReservedStock(tx, tenantId, plans);
      await this.ledgerService.recordTransactions(ledgerTransactions, tx);
      const { movedLines } = await this.persistStageState(
        tx,
        tenantId,
        siteId,
        orderId,
        destinationLocation.id,
        plans,
        reservationsByLine,
        transferGroupId,
      );

      return {
        id: order.id,
        stagingLocationId: destinationLocation.id,
        transferGroupId,
        movedLines,
      };
    });
  }

  private aggregateRequestedPicks(
    items: PickWorkshopPartsDto['items'],
  ): Map<string, RequestedPick> {
    const requestedPicks = new Map<string, RequestedPick>();

    for (const item of items) {
      const quantity = new Decimal(item.quantity);
      if (quantity.lte(0)) {
        throw new BadRequestException(
          'Pick quantity must be greater than zero',
        );
      }

      const existing = requestedPicks.get(item.workshopTaskLineItemId);
      if (existing) {
        existing.quantity = existing.quantity.add(quantity);
      } else {
        requestedPicks.set(item.workshopTaskLineItemId, {
          workshopTaskLineItemId: item.workshopTaskLineItemId,
          quantity,
        });
      }
    }

    return requestedPicks;
  }

  private async validateOrderAndStagingLocation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
    orderId: string,
    destinationLocationId: string,
  ) {
    const order = await tx.workshopOrder.findFirst({
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

    const destinationLocation = await tx.storageLocation.findFirst({
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

  private async loadAndLockPickContext(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    requestedPicks: Map<string, RequestedPick>,
  ) {
    const requestedLineIds = [...requestedPicks.keys()];
    const lineWhere = {
      tenant_id: tenantId,
      id: { in: requestedLineIds },
      type: WorkshopLineItemType.PART,
      part_execution_status: {
        not: WorkshopPartLineExecutionStatus.CANCELLED,
      },
      workshop_task: {
        tenant_id: tenantId,
        workshop_order_id: orderId,
      },
    } as const;
    const initialLines = await tx.workshopTaskLineItem.findMany({
      where: lineWhere,
      select: {
        id: true,
        workshop_task_id: true,
        catalog_item_id: true,
        quantity: true,
        part_execution_status: true,
      },
    });

    if (initialLines.length !== requestedLineIds.length) {
      throw new NotFoundException(
        'One or more workshop part line items were not found for this order',
      );
    }

    await this.lockRows(tx, 'workshop_tasks', tenantId, [
      ...new Set(initialLines.map((line) => line.workshop_task_id)),
    ]);
    const lines = await tx.workshopTaskLineItem.findMany({
      where: lineWhere,
      select: {
        id: true,
        workshop_task_id: true,
        catalog_item_id: true,
        quantity: true,
        part_execution_status: true,
      },
    });
    await this.lockRows(
      tx,
      'workshop_task_line_items',
      tenantId,
      lines.map((line) => line.id),
    );

    const reservations = await tx.partsReservation.findMany({
      where: {
        tenant_id: tenantId,
        workshop_task_line_item_id: { in: lines.map((line) => line.id) },
        kind: PartsReservationKind.ON_HAND,
        status: {
          in: [PartsReservationStatus.OPEN, PartsReservationStatus.STAGED],
        },
      },
      select: {
        id: true,
        workshop_task_line_item_id: true,
        quantity: true,
        quantity_received: true,
        quantity_staged: true,
        quantity_consumed: true,
        quantity_returned: true,
        kind: true,
        status: true,
        location_id: true,
        tote_cost_basis: true,
        createdAt: true,
      },
      orderBy: [
        { workshop_task_line_item_id: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });
    await this.lockRows(
      tx,
      'parts_reservations',
      tenantId,
      reservations.map((reservation) => reservation.id),
    );

    const linesById = new Map(lines.map((line) => [line.id, line]));
    const reservationsByLine = new Map<string, ReservationSlice[]>();
    for (const reservation of reservations) {
      const lineReservations =
        reservationsByLine.get(reservation.workshop_task_line_item_id) ?? [];
      lineReservations.push(reservation);
      reservationsByLine.set(
        reservation.workshop_task_line_item_id,
        lineReservations,
      );
    }

    return {
      lines: linesById,
      reservationsByLine,
    };
  }

  private async buildStagePlans(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
    destinationLocationId: string,
    lines: Map<string, PickLine>,
    reservationsByLine: Map<string, ReservationSlice[]>,
    requestedPicks: Map<string, RequestedPick>,
  ): Promise<StagePlan[]> {
    const preliminaryPlans: Array<{
      line: PickLine;
      reservation: ReservationSlice;
      quantity: Decimal;
    }> = [];

    for (const requestedPick of requestedPicks.values()) {
      const line = lines.get(requestedPick.workshopTaskLineItemId);
      if (!line) {
        throw new NotFoundException(
          `Line item ${requestedPick.workshopTaskLineItemId} not found`,
        );
      }
      if (!line.catalog_item_id) {
        throw new UnprocessableEntityException(
          'Only catalog-backed part lines can be picked.',
        );
      }

      const reservations = (reservationsByLine.get(line.id) ?? []).filter(
        (reservation) => reservation.status === PartsReservationStatus.OPEN,
      );
      let remaining = requestedPick.quantity;
      const availableQuantity = reservations.reduce(
        (sum, reservation) =>
          sum.add(
            this.getUnstagedQuantity(
              reservation.quantity,
              reservation.quantity_received,
            ),
          ),
        new Decimal(0),
      );

      if (availableQuantity.lt(requestedPick.quantity)) {
        throw new UnprocessableEntityException(
          `Requested quantity ${requestedPick.quantity.toString()} exceeds OPEN ON_HAND reservation quantity ${availableQuantity.toString()} for line ${line.id}`,
        );
      }

      for (const reservation of reservations) {
        if (remaining.lte(0)) {
          break;
        }
        const available = this.getUnstagedQuantity(
          reservation.quantity,
          reservation.quantity_received,
        );
        if (available.lte(0)) {
          continue;
        }

        const stagedQuantity = Decimal.min(remaining, available);
        preliminaryPlans.push({
          line,
          reservation,
          quantity: stagedQuantity,
        });
        remaining = remaining.sub(stagedQuantity);
      }

      if (remaining.gt(0)) {
        throw new UnprocessableEntityException(
          `Unable to stage the complete requested quantity for line ${line.id}`,
        );
      }
    }

    const sourceLocationIds = [
      ...new Set(
        preliminaryPlans
          .map((plan) => plan.reservation.location_id)
          .filter((id): id is string => id !== null),
      ),
    ];
    const sourceLocations = await tx.storageLocation.findMany({
      where: {
        tenant_id: tenantId,
        id: { in: sourceLocationIds },
        site_id: siteId,
        deletedAt: null,
        type: LocationType.bin,
        site: { is_active: true },
      },
      select: {
        id: true,
        type: true,
        deletedAt: true,
        site_id: true,
      },
    });
    const sourceLocationById = new Map(
      sourceLocations.map((location) => [location.id, location]),
    );
    const missingLocationId = sourceLocationIds.find(
      (locationId) => !sourceLocationById.has(locationId),
    );
    if (missingLocationId) {
      throw new UnprocessableEntityException(
        `Source location ${missingLocationId} is not available in the active site`,
      );
    }
    if (
      preliminaryPlans.some(
        (plan) =>
          plan.reservation.location_id === null ||
          !sourceLocationById.has(plan.reservation.location_id),
      )
    ) {
      throw new UnprocessableEntityException(
        'Every OPEN ON_HAND reservation must have an authorized source bin.',
      );
    }

    const sourceStockPairs = [
      ...new Map(
        preliminaryPlans.map((plan) => {
          const pair = {
            catalog_item_id: plan.line.catalog_item_id as string,
            location_id: plan.reservation.location_id as string,
          };
          return [`${pair.catalog_item_id}:${pair.location_id}`, pair];
        }),
      ).values(),
    ];
    const stockPairs = [
      ...new Map(
        sourceStockPairs.flatMap((pair) => {
          return [
            [`${pair.catalog_item_id}:${pair.location_id}`, pair],
            [
              `${pair.catalog_item_id}:${destinationLocationId}`,
              {
                catalog_item_id: pair.catalog_item_id,
                location_id: destinationLocationId,
              },
            ],
          ];
        }),
      ).values(),
    ];
    const stocks = await tx.inventoryStock.findMany({
      where: {
        tenant_id: tenantId,
        OR: stockPairs,
      },
      select: {
        id: true,
        catalog_item_id: true,
        location_id: true,
        quantity_on_hand: true,
        quantity_reserved: true,
      },
    });
    const stockByKey = new Map(
      stocks.map((stock) => [
        `${stock.catalog_item_id}:${stock.location_id}`,
        stock,
      ]),
    );
    const missingStockPair = sourceStockPairs.find(
      (pair) => !stockByKey.has(`${pair.catalog_item_id}:${pair.location_id}`),
    );
    if (missingStockPair) {
      throw new UnprocessableEntityException(
        `No inventory stock exists for item ${missingStockPair.catalog_item_id} at source location ${missingStockPair.location_id}`,
      );
    }

    await this.lockRows(
      tx,
      'inventory_stocks',
      tenantId,
      stocks.map((stock) => stock.id),
    );

    const requestedByStock = new Map<string, Decimal>();
    for (const plan of preliminaryPlans) {
      const key = `${plan.line.catalog_item_id}:${plan.reservation.location_id}`;
      requestedByStock.set(
        key,
        (requestedByStock.get(key) ?? new Decimal(0)).add(plan.quantity),
      );
    }
    for (const [key, quantity] of requestedByStock) {
      const stock = stockByKey.get(key);
      if (!stock) {
        continue;
      }
      const quantityOnHand = new Decimal(stock.quantity_on_hand);
      const quantityReserved = new Decimal(stock.quantity_reserved);
      const available = quantityOnHand.sub(quantityReserved);
      if (available.lt(0)) {
        throw new InternalServerErrorException(
          `Inventory ATP invariant failed: quantity available is negative for stock ${stock.id}`,
        );
      }
      if (quantityOnHand.lt(quantity) || quantityReserved.lt(quantity)) {
        throw new UnprocessableEntityException(
          `Insufficient ATP for item ${stock.catalog_item_id} at source location ${stock.location_id}. Requested ${quantity.toString()}.`,
        );
      }
    }

    const inboundCosts = await this.findLatestInboundCosts(
      tx,
      tenantId,
      preliminaryPlans,
    );
    return preliminaryPlans.map((plan) => {
      const sourceStock = stockByKey.get(
        `${plan.line.catalog_item_id}:${plan.reservation.location_id}`,
      );
      if (!sourceStock) {
        throw new UnprocessableEntityException(
          'Source stock is not available for this reservation.',
        );
      }
      const costBasis = plan.reservation.quantity_received.eq(0)
        ? (inboundCosts.get(
            `${plan.line.catalog_item_id}:${plan.reservation.location_id}`,
          ) ?? null)
        : plan.reservation.tote_cost_basis;
      return { ...plan, sourceStock, costBasis };
    });
  }

  private getUnstagedQuantity(
    quantity: Decimal,
    quantityReceived: Decimal,
  ): Decimal {
    const unstagedQuantity = quantity.sub(quantityReceived);
    if (unstagedQuantity.lt(0)) {
      throw new InternalServerErrorException(
        'Parts reservation invariant failed: received quantity exceeds reservation quantity',
      );
    }
    return unstagedQuantity;
  }

  private async findLatestInboundCosts(
    tx: Prisma.TransactionClient,
    tenantId: string,
    plans: Array<{
      line: PickLine;
      reservation: ReservationSlice;
      quantity: Decimal;
    }>,
  ): Promise<Map<string, Decimal | null>> {
    const pairs = [
      ...new Map(
        plans
          .filter((plan) => plan.reservation.quantity_received.eq(0))
          .map((plan) => {
            const pair = {
              item_id: plan.line.catalog_item_id as string,
              location_id: plan.reservation.location_id as string,
            };
            return [`${pair.item_id}:${pair.location_id}`, pair];
          }),
      ).values(),
    ];
    if (pairs.length === 0) {
      return new Map();
    }

    const inboundTransactions = await tx.inventoryTransaction.findMany({
      where: {
        tenant_id: tenantId,
        OR: pairs.flatMap((pair) => [
          {
            item_id: pair.item_id,
            location_id: pair.location_id,
            type: TransactionType.PURCHASE_RECEIPT,
          },
          {
            item_id: pair.item_id,
            location_id: pair.location_id,
            type: TransactionType.INITIAL_BALANCE,
          },
          {
            item_id: pair.item_id,
            location_id: pair.location_id,
            type: TransactionType.TRANSFER_IN,
          },
          {
            item_id: pair.item_id,
            location_id: pair.location_id,
            type: TransactionType.ADJUSTMENT,
            quantity: { gt: 0 },
          },
        ]),
      },
      select: {
        item_id: true,
        location_id: true,
        cost_basis: true,
      },
      orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }],
    });
    const costs = new Map<string, Decimal | null>();
    for (const transaction of inboundTransactions) {
      const key = `${transaction.item_id}:${transaction.location_id}`;
      if (!costs.has(key)) {
        costs.set(key, transaction.cost_basis);
      }
    }
    return costs;
  }

  private buildLedgerTransactions(
    plans: StagePlan[],
    destinationLocationId: string,
    transferGroupId: string,
  ): RecordTransactionParams[] {
    return plans.flatMap((plan, index) => {
      const referenceId = `${transferGroupId}:${plan.line.id}:${index + 1}`;
      return [
        {
          itemId: plan.line.catalog_item_id as string,
          locationId: plan.reservation.location_id as string,
          quantity: plan.quantity.negated(),
          type: TransactionType.TRANSFER_OUT,
          referenceId,
          costBasis: plan.costBasis,
          partsReservationId: plan.reservation.id,
        },
        {
          itemId: plan.line.catalog_item_id as string,
          locationId: destinationLocationId,
          quantity: plan.quantity,
          type: TransactionType.TRANSFER_IN,
          referenceId,
          costBasis: plan.costBasis,
          partsReservationId: plan.reservation.id,
        },
      ];
    });
  }

  private async releaseReservedStock(
    tx: Prisma.TransactionClient,
    _tenantId: string,
    plans: StagePlan[],
  ): Promise<void> {
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

    await chunkedPromiseAll(
      [...quantitiesByStock.values()],
      async ({ stock, quantity }) => {
        try {
          await this.atpService.releaseOnHand(
            { stockId: stock.id, quantity },
            tx,
          );
        } catch (error) {
          if (error instanceof ConflictException) {
            throw new ConflictException(
              `Inventory ATP changed before staging stock ${stock.id}. Refresh and retry.`,
            );
          }
          throw error;
        }
      },
    );
  }

  private async persistStageState(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
    orderId: string,
    destinationLocationId: string,
    plans: StagePlan[],
    reservationsByLine: Map<string, ReservationSlice[]>,
    transferGroupId: string,
  ) {
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

      const updateResult = await tx.partsReservation.updateMany({
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

    const stagedByLine = new Map<string, Decimal>();
    for (const [lineId, reservations] of reservationsByLine) {
      stagedByLine.set(
        lineId,
        reservations.reduce(
          (sum, reservation) => sum.add(reservation.quantity_staged),
          new Decimal(0),
        ),
      );
    }
    for (const plan of plans) {
      stagedByLine.set(
        plan.line.id,
        (stagedByLine.get(plan.line.id) ?? new Decimal(0)).add(plan.quantity),
      );
    }
    const fullyStagedLineIds = [
      ...new Set(
        plans
          .filter(({ line }) =>
            (stagedByLine.get(line.id) ?? new Decimal(0)).gte(line.quantity),
          )
          .map((plan) => plan.line.id),
      ),
    ];
    if (fullyStagedLineIds.length > 0) {
      await tx.workshopTaskLineItem.updateMany({
        where: {
          tenant_id: tenantId,
          id: { in: fullyStagedLineIds },
          type: WorkshopLineItemType.PART,
          part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
        },
        data: { part_execution_status: WorkshopPartLineExecutionStatus.STAGED },
      });
    }

    const taskIds = [
      ...new Set(plans.map((plan) => plan.line.workshop_task_id)),
    ];
    const versionUpdate = await tx.workshopTask.updateMany({
      where: { tenant_id: tenantId, id: { in: taskIds } },
      data: { line_items_version: { increment: 1 } },
    });
    if (versionUpdate.count !== taskIds.length) {
      throw new ConflictException(
        'Workshop task changed during pick execution. Refresh and retry.',
      );
    }

    const orderUpdateResult = await tx.workshopOrder.updateMany({
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

    const plansByLine = new Map<
      string,
      Array<{ plan: StagePlan; index: number }>
    >();
    for (const [index, plan] of plans.entries()) {
      const linePlans = plansByLine.get(plan.line.id) ?? [];
      linePlans.push({ plan, index });
      plansByLine.set(plan.line.id, linePlans);
    }
    const movedLines = [...plansByLine.values()].map((linePlans) => ({
      workshopTaskLineItemId: linePlans[0].plan.line.id,
      movedQuantity: linePlans
        .reduce((sum, { plan }) => sum.add(plan.quantity), new Decimal(0))
        .toNumber(),
      allocations: linePlans.map(({ plan, index }) => ({
        sourceLocationId: plan.reservation.location_id as string,
        quantity: plan.quantity.toNumber(),
        referenceId: `${transferGroupId}:${plan.line.id}:${index + 1}`,
      })),
    }));

    return { movedLines };
  }

  private async lockRows(
    tx: Prisma.TransactionClient,
    tableName:
      | 'workshop_tasks'
      | 'workshop_task_line_items'
      | 'parts_reservations'
      | 'inventory_stocks',
    tenantId: string,
    ids: readonly string[],
  ): Promise<void> {
    const sortedIds = [...new Set(ids)].sort();
    if (sortedIds.length === 0) {
      return;
    }

    // eslint-disable-next-line no-restricted-syntax -- phase-3 lock hierarchy requires sorted tenant-qualified row locks.
    await tx.$queryRaw`
      SELECT id
      FROM ${Prisma.raw(tableName)}
      WHERE tenant_id = ${tenantId}
        AND id IN (${Prisma.join(sortedIds)})
      ORDER BY id
      FOR UPDATE
    `;
  }
}
