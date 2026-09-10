import {
  BadRequestException,
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
import type { RecordTransactionParams } from '../inventory/ledger.service';
import type { PickWorkshopPartsDto } from './dto/pick-workshop-parts.dto';

import Decimal = Prisma.Decimal;

export const PICK_ELIGIBLE_ORDER_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

export type RequestedPick = {
  workshopTaskLineItemId: string;
  quantity: Decimal;
};

export type PickLine = {
  id: string;
  workshop_task_id: string;
  catalog_item_id: string | null;
  quantity: Decimal;
  part_execution_status: WorkshopPartLineExecutionStatus | null;
};

export type ReservationSlice = {
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

export type SourceStock = {
  id: string;
  catalog_item_id: string;
  location_id: string;
  quantity_on_hand: Decimal;
  quantity_reserved: Decimal;
};

export type StagePlan = {
  line: PickLine;
  reservation: ReservationSlice;
  sourceStock: SourceStock;
  quantity: Decimal;
  costBasis: Decimal | null;
};

export type PickContextResult = {
  lines: Map<string, PickLine>;
  reservationsByLine: Map<string, ReservationSlice[]>;
};

export type SourceLocationSlice = {
  id: string;
  type: string;
  deletedAt: Date | null;
  site_id: string;
};

export type SourceStocksAndLocationsResult = {
  stockByKey: Map<string, SourceStock>;
  sourceLocationById: Map<string, SourceLocationSlice>;
};

export type MovedLineAllocation = {
  sourceLocationId: string;
  quantity: number;
  referenceId: string;
};

export type MovedLineResult = {
  workshopTaskLineItemId: string;
  movedQuantity: number;
  allocations: MovedLineAllocation[];
};

export type LockRowsFn = (
  tx: Prisma.TransactionClient,
  tableName:
    | 'workshop_tasks'
    | 'workshop_task_line_items'
    | 'parts_reservations'
    | 'inventory_stocks',
  tenantId: string,
  ids: readonly string[],
) => Promise<void>;

/**
 * Pure function. Computes `quantity - quantityReceived`.
 * Throws `InternalServerErrorException` if the result is negative.
 */
export function getUnstagedQuantity(
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

/**
 * Pure function. Aggregates pick quantities by line item id.
 * Throws `BadRequestException` if any quantity is <= 0.
 */
export function aggregateRequestedPicks(
  items: PickWorkshopPartsDto['items'],
): Map<string, RequestedPick> {
  const requestedPicks = new Map<string, RequestedPick>();

  for (const item of items) {
    const quantity = new Decimal(item.quantity);
    if (quantity.lte(0)) {
      throw new BadRequestException('Pick quantity must be greater than zero');
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

/**
 * Pure function. Iterates requestedPicks, validates lines, and allocates quantities
 * from OPEN reservations using FIFO order.
 */
export function calculatePickAllocations(
  lines: Map<string, PickLine>,
  reservationsByLine: Map<string, ReservationSlice[]>,
  requestedPicks: Map<string, RequestedPick>,
): Array<{ line: PickLine; reservation: ReservationSlice; quantity: Decimal }> {
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
          getUnstagedQuantity(
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
      const available = getUnstagedQuantity(
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

  return preliminaryPlans;
}

/**
 * Async. Queries `inventoryTransaction` filtered by `tenant_id: tenantId`.
 * Returns a map keyed by `${item_id}:${location_id}`.
 */
export async function findLatestInboundCosts(
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

/**
 * Async. Loads lines and reservations for the requested pick context and acquires row-level locks.
 */
export async function loadAndLockPickContext(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
  requestedPicks: Map<string, RequestedPick>,
  lockRows: LockRowsFn,
): Promise<PickContextResult> {
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

  await lockRows(tx, 'workshop_tasks', tenantId, [
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
  await lockRows(
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
  await lockRows(
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

/**
 * Async. Loads source storage locations and inventory stocks for preliminary plans.
 * Validates locations are active site bins and that stock exists for each pair.
 * Acquires row-level locks on inventory_stocks.
 */
export async function loadSourceStocksAndLocations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  destinationLocationId: string,
  preliminaryPlans: Array<{
    line: PickLine;
    reservation: ReservationSlice;
    quantity: Decimal;
  }>,
  lockRows: LockRowsFn,
): Promise<SourceStocksAndLocationsResult> {
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

  await lockRows(
    tx,
    'inventory_stocks',
    tenantId,
    stocks.map((stock) => stock.id),
  );

  return { stockByKey, sourceLocationById };
}

/**
 * Async orchestrator. Calls `calculatePickAllocations` to build preliminary plans,
 * loads/validates source stocks and locations, finds latest inbound costs,
 * validates ATP invariant, then maps everything into `StagePlan[]`.
 */
export async function buildStagePlans(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  destinationLocationId: string,
  lines: Map<string, PickLine>,
  reservationsByLine: Map<string, ReservationSlice[]>,
  requestedPicks: Map<string, RequestedPick>,
  lockRows: LockRowsFn,
): Promise<StagePlan[]> {
  const preliminaryPlans = calculatePickAllocations(
    lines,
    reservationsByLine,
    requestedPicks,
  );

  const { stockByKey } = await loadSourceStocksAndLocations(
    tx,
    tenantId,
    siteId,
    destinationLocationId,
    preliminaryPlans,
    lockRows,
  );

  // Validate ATP invariant: on_hand >= reserved >= requested
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

  const inboundCosts = await findLatestInboundCosts(
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

/**
 * Pure function. Builds ledger transaction parameters (TRANSFER_OUT and TRANSFER_IN pairs) for staging plans.
 */
export function buildLedgerTransactions(
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

/**
 * Pure function. Calculates cumulative staged quantities by line item id.
 */
export function calculateStagedQuantitiesByLine(
  plans: StagePlan[],
  reservationsByLine: Map<string, ReservationSlice[]>,
): Map<string, Decimal> {
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
  return stagedByLine;
}

/**
 * Pure function. Identifies line IDs that have reached or exceeded their target quantity.
 */
export function findFullyStagedLineIds(
  plans: StagePlan[],
  stagedByLine: Map<string, Decimal>,
): string[] {
  return [
    ...new Set(
      plans
        .filter(({ line }) =>
          (stagedByLine.get(line.id) ?? new Decimal(0)).gte(line.quantity),
        )
        .map((plan) => plan.line.id),
    ),
  ];
}

/**
 * Pure function. Constructs the movedLines response structure grouped by workshop line item.
 */
export function buildMovedLines(
  plans: StagePlan[],
  transferGroupId: string,
): MovedLineResult[] {
  const plansByLine = new Map<
    string,
    Array<{ plan: StagePlan; index: number }>
  >();
  for (const [index, plan] of plans.entries()) {
    const linePlans = plansByLine.get(plan.line.id) ?? [];
    linePlans.push({ plan, index });
    plansByLine.set(plan.line.id, linePlans);
  }
  return [...plansByLine.values()].map((linePlans) => ({
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
}
