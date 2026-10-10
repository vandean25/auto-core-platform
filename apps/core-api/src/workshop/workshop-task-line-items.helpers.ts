import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PartsReservationStatus,
  Prisma,
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  isActiveSlice,
  type ReservationSliceState,
} from '../parts-requisition/parts-requisition.helpers.js';
import type { ReplaceWorkshopTaskLineItemsDto } from './dto/replace-workshop-task-line-items.dto.js';

export interface DeleteLineItemsContext {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  taskId: string;
  returnLocationId?: string;
  releaseReservation?: (
    reservationId: string,
    options: { returnLocationId?: string },
    tx: Prisma.TransactionClient,
  ) => Promise<void> | Promise<unknown>;
}

export interface LineReservationSummary {
  id?: string;
  workshop_task_line_item_id: string;
  quantity?: Prisma.Decimal | number | string;
  quantity_consumed: Prisma.Decimal | number | string;
  quantity_returned?: Prisma.Decimal | number | string;
  quantity_staged?: Prisma.Decimal | number | string;
  status?: PartsReservationStatus;
}

export interface UpdateTaskLineItemsContext {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  taskId: string;
}

export type LineReservationRecord = {
  workshop_task_line_item_id: string;
  quantity_consumed: Prisma.Decimal | number | string;
  quantity_staged: Prisma.Decimal | number | string;
};

export type SubmittedLineItem =
  ReplaceWorkshopTaskLineItemsDto['items'][number];
export type ExistingLineItemToUpdate = SubmittedLineItem & { id: string };

export async function validateLaborOperationIds(
  prisma: Prisma.TransactionClient | PrismaService,
  tenantId: string,
  items: ReplaceWorkshopTaskLineItemsDto['items'],
): Promise<void> {
  const laborOperationIds = [
    ...new Set(
      items.map((i) => i.laborOperationId).filter((id): id is string => !!id),
    ),
  ];

  if (laborOperationIds.length === 0) {
    return;
  }

  const foundCount = await prisma.laborOperation.count({
    where: {
      id: { in: laborOperationIds },
      tenant_id: tenantId,
    },
  });

  if (foundCount !== laborOperationIds.length) {
    throw new BadRequestException(
      'Invalid laborOperationId: one or more labor operations were not found within this tenant scope',
    );
  }
}

export interface IncrementTaskLineItemsVersionParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  taskId: string;
  expectedLineItemsVersion: number;
}

export async function incrementTaskLineItemsVersion(
  params: IncrementTaskLineItemsVersionParams,
): Promise<void> {
  const { tx, tenantId, siteId, taskId, expectedLineItemsVersion } = params;
  const versionUpdate = await tx.workshopTask.updateMany({
    where: {
      id: taskId,
      tenant_id: tenantId,
      workshop_order: { site_id: siteId },
      line_items_version: expectedLineItemsVersion,
    },
    data: { line_items_version: { increment: 1 } },
  });
  if (versionUpdate.count !== 1) {
    throw new ConflictException(
      'Workshop task line items changed; please reload and retry',
    );
  }
}

export interface ValidateSubmittedLineItemIdsParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  taskId: string;
  dto: ReplaceWorkshopTaskLineItemsDto;
}

export async function validateSubmittedLineItemIds(
  params: ValidateSubmittedLineItemIdsParams,
) {
  const { tx, tenantId, siteId, taskId, dto } = params;
  const existingItems =
    (await tx.workshopTaskLineItem.findMany({
      where: {
        tenant_id: tenantId,
        workshop_task_id: taskId,
        workshop_task: { workshop_order: { site_id: siteId } },
      },
      select: {
        id: true,
        quantity: true,
        part_execution_status: true,
      },
    })) ?? [];

  const submittedIds = dto.items
    .map((item) => item.id)
    .filter((id): id is string => id !== undefined);

  if (new Set(submittedIds).size !== submittedIds.length) {
    throw new UnprocessableEntityException(
      'Duplicate line-item IDs are not allowed',
    );
  }

  const existingIds = new Set(existingItems.map((item) => item.id));
  if (submittedIds.some((id) => !existingIds.has(id))) {
    throw new UnprocessableEntityException(
      'One or more line-item IDs were not found for this task',
    );
  }

  return { submittedIds, existingItems };
}

function buildConsumedQuantitiesMap(
  reservationHistory: LineReservationSummary[],
): Map<string, Prisma.Decimal> {
  const consumedQuantities = new Map<string, Prisma.Decimal>();
  for (const reservation of reservationHistory) {
    const current =
      consumedQuantities.get(reservation.workshop_task_line_item_id) ??
      new Prisma.Decimal(0);
    consumedQuantities.set(
      reservation.workshop_task_line_item_id,
      current.add(new Prisma.Decimal(reservation.quantity_consumed)),
    );
  }
  return consumedQuantities;
}

export function classifyDeletedLineItems(
  existingItems: Array<{
    id: string;
    part_execution_status: WorkshopPartLineExecutionStatus | null;
  }>,
  submittedIds: string[],
  reservationHistory: LineReservationSummary[] = [],
) {
  const deletedIds = existingItems
    .map((item) => item.id)
    .filter((id) => !submittedIds.includes(id));

  const reservedLineIds = new Set(
    reservationHistory.map(
      (reservation) => reservation.workshop_task_line_item_id,
    ),
  );
  const consumedQuantities = buildConsumedQuantitiesMap(reservationHistory);
  const isConsumed = (id: string) =>
    consumedQuantities.get(id)?.greaterThan(0) ?? false;
  const hasOperationalHistory = (id: string) => reservedLineIds.has(id);

  return {
    deletedIds,
    hardDeleteIds: deletedIds.filter(
      (id) => !hasOperationalHistory(id) && !isConsumed(id),
    ),
    cancelIds: deletedIds.filter(
      (id) => hasOperationalHistory(id) && !isConsumed(id),
    ),
    consumedIds: deletedIds.filter(isConsumed),
  };
}

export async function findLineReservationHistory(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  existingItems: Array<{ id: string }>,
) {
  const lineIds = existingItems.map((item) => item.id);
  if (lineIds.length === 0) {
    return [];
  }

  return tx.partsReservation.findMany({
    where: {
      tenant_id: tenantId,
      workshop_task_line_item_id: { in: lineIds },
      workshop_task_line_item: {
        workshop_task: { workshop_order: { site_id: siteId } },
      },
    },
    select: {
      id: true,
      workshop_task_line_item_id: true,
      quantity: true,
      quantity_consumed: true,
      quantity_returned: true,
      quantity_staged: true,
      status: true,
    },
  });
}

export function calculateLineActiveCommitment(
  lineReservations: LineReservationSummary[],
  activeStatuses: Set<PartsReservationStatus>,
): Prisma.Decimal {
  return lineReservations.reduce((sum, reservation) => {
    if (!reservation.status || !activeStatuses.has(reservation.status)) {
      return sum;
    }

    const remaining = new Prisma.Decimal(reservation.quantity ?? 0)
      .sub(new Prisma.Decimal(reservation.quantity_consumed))
      .sub(new Prisma.Decimal(reservation.quantity_returned ?? 0));
    if (remaining.isNegative()) {
      throw new ConflictException(
        `Parts reservation ${reservation.workshop_task_line_item_id} has invalid negative remaining demand`,
      );
    }
    return sum.add(remaining);
  }, new Prisma.Decimal(0));
}

function assertSingleLineDemand(
  lineId: string,
  requestedQuantity: Prisma.Decimal,
  reservationHistory: LineReservationSummary[],
  activeStatuses: Set<PartsReservationStatus>,
): void {
  const lineReservations = reservationHistory.filter(
    (reservation) => reservation.workshop_task_line_item_id === lineId,
  );
  const consumedQuantity = lineReservations.reduce(
    (sum, reservation) =>
      sum.add(new Prisma.Decimal(reservation.quantity_consumed)),
    new Prisma.Decimal(0),
  );
  const activeCommitment = calculateLineActiveCommitment(
    lineReservations,
    activeStatuses,
  );
  const minimumQuantity = consumedQuantity.add(activeCommitment);

  if (requestedQuantity.lessThan(minimumQuantity)) {
    throw new ConflictException(
      'Workshop line quantity cannot be reduced below allocated or consumed demand',
    );
  }
}

export function assertLineQuantityDemand(
  existingItems: Array<{ id: string }>,
  dto: ReplaceWorkshopTaskLineItemsDto,
  reservationHistory: LineReservationSummary[],
): void {
  const submittedQuantities = new Map(
    dto.items
      .filter((item): item is typeof item & { id: string } => !!item.id)
      .map((item) => [item.id, new Prisma.Decimal(item.qty)]),
  );
  const activeStatuses = new Set<PartsReservationStatus>([
    PartsReservationStatus.OPEN,
    PartsReservationStatus.ORDERED,
    PartsReservationStatus.STAGED,
  ]);

  for (const line of existingItems) {
    const requestedQuantity =
      submittedQuantities.get(line.id) ?? new Prisma.Decimal(0);
    assertSingleLineDemand(
      line.id,
      requestedQuantity,
      reservationHistory,
      activeStatuses,
    );
  }
}

function isDeletedActiveReservation(
  reservation: LineReservationSummary,
  deletedSet: Set<string>,
): boolean {
  if (!reservation.id || !reservation.status) {
    return false;
  }
  if (!deletedSet.has(reservation.workshop_task_line_item_id)) {
    return false;
  }
  return isActiveSlice(reservation as ReservationSliceState);
}

export async function releaseDeletedLineReservations(
  ctx: DeleteLineItemsContext,
  deletedIds: string[],
  reservationHistory: LineReservationSummary[],
): Promise<LineReservationSummary[]> {
  const deletedSet = new Set(deletedIds);
  const activeReservations = reservationHistory.filter((reservation) =>
    isDeletedActiveReservation(reservation, deletedSet),
  );

  const release = ctx.releaseReservation;
  if (release) {
    for (const reservation of activeReservations) {
      if (reservation.id) {
        await release(
          reservation.id,
          { returnLocationId: ctx.returnLocationId },
          ctx.tx,
        );
      }
    }
  }

  return activeReservations;
}

export async function executeLineDeletionsAndCancellations(
  ctx: DeleteLineItemsContext,
  hardDeleteIds: string[],
  cancelIds: string[],
): Promise<void> {
  if (hardDeleteIds.length > 0) {
    await ctx.tx.workshopTaskLineItem.deleteMany({
      where: {
        tenant_id: ctx.tenantId,
        workshop_task_id: ctx.taskId,
        id: { in: hardDeleteIds },
        workshop_task: { workshop_order: { site_id: ctx.siteId } },
      },
    });
  }
  if (cancelIds.length > 0) {
    await ctx.tx.workshopTaskLineItem.updateMany({
      where: {
        tenant_id: ctx.tenantId,
        workshop_task_id: ctx.taskId,
        id: { in: cancelIds },
        workshop_task: { workshop_order: { site_id: ctx.siteId } },
      },
      data: {
        part_execution_status: WorkshopPartLineExecutionStatus.CANCELLED,
      },
    });
  }
}

function assertConsumedLinesReleased(
  consumedIds: string[],
  activeReservationCount: number,
): void {
  if (consumedIds.length > 0 && activeReservationCount === 0) {
    throw new ConflictException(
      'Consumed line items must be released before removal',
    );
  }
}

export async function handleDeletedLineItems(
  ctx: DeleteLineItemsContext,
  existingItems: Array<{
    id: string;
    part_execution_status: WorkshopPartLineExecutionStatus | null;
  }>,
  submittedIds: string[],
  reservationHistory: LineReservationSummary[] = [],
): Promise<void> {
  const { deletedIds, hardDeleteIds, cancelIds, consumedIds } =
    classifyDeletedLineItems(existingItems, submittedIds, reservationHistory);

  if (deletedIds.length === 0) {
    return;
  }

  const activeReservations = await releaseDeletedLineReservations(
    ctx,
    deletedIds,
    reservationHistory,
  );

  assertConsumedLinesReleased(consumedIds, activeReservations.length);

  await executeLineDeletionsAndCancellations(ctx, hardDeleteIds, cancelIds);
}

function toDecimalOrNull(
  value: number | string | Prisma.Decimal | null | undefined,
): Prisma.Decimal | null {
  return value != null ? new Prisma.Decimal(value) : null;
}

export function buildNewTaskLineItemRecord(
  tenantId: string,
  taskId: string,
  item: ReplaceWorkshopTaskLineItemsDto['items'][number],
): Prisma.WorkshopTaskLineItemCreateManyInput {
  const isLabor = item.type === WorkshopLineItemType.LABOR;
  return {
    id: item.id ?? randomUUID(),
    tenant_id: tenantId,
    workshop_task_id: taskId,
    type: isLabor ? WorkshopLineItemType.LABOR : WorkshopLineItemType.PART,
    part_execution_status: isLabor
      ? null
      : WorkshopPartLineExecutionStatus.PENDING_PICK,
    item_no: item.itemNo,
    description: item.description,
    quantity: new Prisma.Decimal(item.qty),
    unit_price: new Prisma.Decimal(item.unitPrice),
    labor_operation_id: item.laborOperationId ?? null,
    standard_aw: toDecimalOrNull(item.standardAw),
    actual_hours: toDecimalOrNull(item.actualHours),
    internal_cost_rate: toDecimalOrNull(item.internalCostRate),
  };
}

export async function createNewTaskLineItems(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
  items: ReplaceWorkshopTaskLineItemsDto['items'],
): Promise<void> {
  const newItems = items.filter((item) => !item.id);
  if (newItems.length === 0) {
    return;
  }

  await tx.workshopTaskLineItem.createMany({
    data: newItems.map((item) =>
      buildNewTaskLineItemRecord(tenantId, taskId, item),
    ),
  });
}

export async function fetchPartLineReservations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  partLineIds: string[],
): Promise<LineReservationRecord[]> {
  if (partLineIds.length === 0) {
    return [];
  }
  return tx.partsReservation.findMany({
    where: {
      tenant_id: tenantId,
      workshop_task_line_item_id: { in: partLineIds },
    },
    select: {
      workshop_task_line_item_id: true,
      quantity_consumed: true,
      quantity_staged: true,
    },
  });
}

export function groupReservationsByLine(
  reservations: LineReservationRecord[],
): Map<string, LineReservationRecord[]> {
  const reservationsByLine = new Map<string, LineReservationRecord[]>();
  for (const reservation of reservations) {
    const list =
      reservationsByLine.get(reservation.workshop_task_line_item_id) ?? [];
    list.push(reservation);
    reservationsByLine.set(reservation.workshop_task_line_item_id, list);
  }
  return reservationsByLine;
}

export function computePartItemExecutionStatus(
  requestedQty: Prisma.Decimal | number | string,
  lineReservations: LineReservationRecord[],
): WorkshopPartLineExecutionStatus {
  const consumed = lineReservations.reduce(
    (sum, reservation) =>
      sum.add(new Prisma.Decimal(reservation.quantity_consumed)),
    new Prisma.Decimal(0),
  );
  if (consumed.gte(new Prisma.Decimal(requestedQty))) {
    return WorkshopPartLineExecutionStatus.CONSUMED;
  }
  const hasStaged = lineReservations.some((reservation) =>
    new Prisma.Decimal(reservation.quantity_staged).gt(0),
  );
  if (hasStaged) {
    return WorkshopPartLineExecutionStatus.STAGED;
  }
  return WorkshopPartLineExecutionStatus.PENDING_PICK;
}

export function derivePartExecutionStatusMap(
  existingItems: ExistingLineItemToUpdate[],
  reservationsByLine: Map<string, LineReservationRecord[]>,
): Map<string, WorkshopPartLineExecutionStatus> {
  const partExecutionStatusById = new Map<
    string,
    WorkshopPartLineExecutionStatus
  >();
  for (const item of existingItems) {
    if (item.type !== WorkshopLineItemType.PART) {
      continue;
    }
    const lineReservations = reservationsByLine.get(item.id) ?? [];
    partExecutionStatusById.set(
      item.id,
      computePartItemExecutionStatus(item.qty, lineReservations),
    );
  }
  return partExecutionStatusById;
}

function assignLaborLineFields(
  data: Prisma.WorkshopTaskLineItemUncheckedUpdateManyInput,
  item: ExistingLineItemToUpdate,
): void {
  if (item.actualHours != null) {
    data.actual_hours = new Prisma.Decimal(item.actualHours);
  }
  if (item.standardAw != null) {
    data.standard_aw = new Prisma.Decimal(item.standardAw);
  }
  if (item.internalCostRate != null) {
    data.internal_cost_rate = new Prisma.Decimal(item.internalCostRate);
  }
  if (item.laborOperationId !== undefined) {
    data.labor_operation_id = item.laborOperationId;
  }
}

export function buildExistingLineItemUpdateData(
  item: ExistingLineItemToUpdate,
  partStatus?: WorkshopPartLineExecutionStatus,
): Prisma.WorkshopTaskLineItemUncheckedUpdateManyInput {
  const data: Prisma.WorkshopTaskLineItemUncheckedUpdateManyInput = {
    description: item.description,
    quantity: new Prisma.Decimal(item.qty),
    unit_price: new Prisma.Decimal(item.unitPrice),
  };
  assignLaborLineFields(data, item);
  if (item.type === WorkshopLineItemType.PART && partStatus) {
    data.part_execution_status = partStatus;
  }
  return data;
}

export async function executeExistingLineItemUpdates(
  ctx: UpdateTaskLineItemsContext,
  existingItems: ExistingLineItemToUpdate[],
  partExecutionStatusById: Map<string, WorkshopPartLineExecutionStatus>,
): Promise<void> {
  await Promise.all(
    existingItems.map((item) =>
      ctx.tx.workshopTaskLineItem.updateMany({
        where: {
          id: item.id,
          tenant_id: ctx.tenantId,
          workshop_task_id: ctx.taskId,
          workshop_task: { workshop_order: { site_id: ctx.siteId } },
        },
        data: buildExistingLineItemUpdateData(
          item,
          partExecutionStatusById.get(item.id),
        ),
      }),
    ),
  );
}

export async function updateExistingTaskLineItems(
  ctx: UpdateTaskLineItemsContext,
  items: ReplaceWorkshopTaskLineItemsDto['items'],
): Promise<void> {
  const existingItemsToUpdate = items.filter(
    (item): item is ExistingLineItemToUpdate => Boolean(item.id),
  );
  if (existingItemsToUpdate.length === 0) {
    return;
  }

  const partLineIds = existingItemsToUpdate
    .filter((item) => item.type === WorkshopLineItemType.PART)
    .map((item) => item.id);

  const reservations = await fetchPartLineReservations(
    ctx.tx,
    ctx.tenantId,
    partLineIds,
  );
  const reservationsByLine = groupReservationsByLine(reservations);
  const partExecutionStatusById = derivePartExecutionStatusMap(
    existingItemsToUpdate,
    reservationsByLine,
  );

  await executeExistingLineItemUpdates(
    ctx,
    existingItemsToUpdate,
    partExecutionStatusById,
  );
}

export function computeFieldNameText(fieldName: unknown): string {
  if (typeof fieldName === 'string') {
    return fieldName;
  }
  if (Array.isArray(fieldName)) {
    return fieldName
      .filter((part): part is string => typeof part === 'string')
      .join(',');
  }
  return '';
}

export function handleTaskLineItemsError(error: unknown): never {
  const fieldName =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.meta?.field_name
      : undefined;
  const fieldNameText = computeFieldNameText(fieldName);

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003' &&
    fieldNameText.includes('labor_operation_id')
  ) {
    throw new BadRequestException(
      'Invalid laborOperationId: referenced labor operation was not found',
    );
  }
  throw error;
}
