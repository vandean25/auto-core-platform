import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartsReservationStatus,
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition.js';
import {
  assertOrderEditable,
  deriveOrderStatus,
} from './workshop-order.helpers.js';
import { formatLocalDate, parseLocalDate } from './workshop-planner.time.js';
import {
  isActiveSlice,
  isTaskBlockedByParts,
  type ReservationSliceState,
} from '../parts-requisition/parts-requisition.helpers.js';
import type { CreateWorkshopTaskDto } from './dto/create-workshop-task.dto.js';
import type { UpdateWorkshopTaskDto } from './dto/update-workshop-task.dto.js';
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

export async function findTaskAndAssertEditable(
  prisma: Prisma.TransactionClient | PrismaService,
  tenantId: string,
  orderId: string,
  taskId: string,
  siteId: string,
) {
  const task = await prisma.workshopTask.findFirst({
    where: {
      id: taskId,
      tenant_id: tenantId,
      workshop_order_id: orderId,
      workshop_order: { site_id: siteId },
    },
    include: {
      workshop_order: {
        select: {
          status: true,
          purpose: true,
          invoice: { select: { id: true, invoice_number: true } },
        },
      },
    },
  });

  if (!task) {
    throw new NotFoundException(`Task ${taskId} not found for this order`);
  }
  assertOrderEditable(task.workshop_order);

  return task;
}

export async function validateTaskForLineItemReplacement(
  prisma: Prisma.TransactionClient | PrismaService,
  tenantId: string,
  siteId: string,
  orderId: string,
  taskId: string,
) {
  return findTaskAndAssertEditable(prisma, tenantId, orderId, taskId, siteId);
}

export function buildTaskUpdateFieldData(
  dto: UpdateWorkshopTaskDto,
): Prisma.WorkshopTaskUpdateManyMutationInput {
  const fieldData: Prisma.WorkshopTaskUpdateManyMutationInput = {};
  if (dto.title !== undefined) {
    fieldData.title = dto.title;
  }
  if (dto.mechanicNotes !== undefined) {
    fieldData.mechanic_notes = dto.mechanicNotes;
  }
  return fieldData;
}

export async function executeTaskUpdate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
  taskId: string,
  currentStatus: WorkshopTaskStatus,
  dto: UpdateWorkshopTaskDto,
  siteId: string,
) {
  const fieldData = buildTaskUpdateFieldData(dto);
  const nextStatus = dto.status;

  if (nextStatus !== undefined && nextStatus !== currentStatus) {
    await guardedStatusUpdate(bindStatusUpdateMany(tx.workshopTask), {
      id: taskId,
      tenantId,
      from: currentStatus,
      to: nextStatus,
      extraWhere: {
        workshop_order_id: orderId,
        workshop_order: { site_id: siteId },
      },
      extraData: fieldData,
      conflictMessage: `Task ${taskId} status changed concurrently. Please refresh and try again.`,
    });
  } else if (Object.keys(fieldData).length > 0) {
    const taskUpdate = await tx.workshopTask.updateMany({
      where: {
        id: taskId,
        tenant_id: tenantId,
        workshop_order_id: orderId,
        workshop_order: { site_id: siteId },
      },
      data: fieldData,
    });

    if (taskUpdate.count === 0) {
      throw new NotFoundException(`Task ${taskId} not found for this order`);
    }
  }
}

export async function recalculateAndApplyOrderStatus(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
  applyDerivedStatus: (
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    nextOrderStatus: WorkshopOrderStatus,
  ) => Promise<boolean>,
  siteId: string,
): Promise<boolean> {
  const tasks = await tx.workshopTask.findMany({
    where: {
      workshop_order_id: orderId,
      tenant_id: tenantId,
      workshop_order: { site_id: siteId },
    },
    select: { status: true },
  });

  const nextOrderStatus = deriveOrderStatus(tasks.map((t) => t.status));
  return applyDerivedStatus(tx, tenantId, orderId, nextOrderStatus);
}

export async function resolveOrderStatusConflict(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
  nextOrderStatus: WorkshopOrderStatus,
  error: unknown,
  siteId: string,
): Promise<boolean> {
  if (!(error instanceof ConflictException)) {
    throw error;
  }
  const latest = await tx.workshopOrder.findFirst({
    where: {
      id: orderId,
      tenant_id: tenantId,
      site_id: siteId,
    },
    select: { status: true },
  });
  if (!latest) {
    throw new NotFoundException(`Workshop order ${orderId} not found`);
  }
  if (latest.status === WorkshopOrderStatus.INVOICED) {
    return false;
  }
  if (latest.status === nextOrderStatus) {
    return true;
  }
  throw error;
}

export async function resolveDefaultTaskScheduledDate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  order: {
    tasks: { id: string }[];
    scheduled_start_at: Date | null;
  },
  siteId: string,
): Promise<Date | undefined> {
  if (order.tasks.length > 0 || !order.scheduled_start_at) {
    return undefined;
  }

  const settings = await tx.site.findFirst({
    where: {
      tenant_id: tenantId,
      id: siteId,
      is_active: true,
    },
    select: { timezone: true },
  });
  const timeZone = settings?.timezone ?? 'Europe/Vienna';
  const localDate = formatLocalDate(order.scheduled_start_at, timeZone);
  const { year, month, day } = parseLocalDate(localDate);
  return new Date(Date.UTC(year, month - 1, day));
}

export async function executeTaskCreation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  orderId: string,
  dto: CreateWorkshopTaskDto,
) {
  const order = await tx.workshopOrder.findFirst({
    where: { id: orderId, tenant_id: tenantId, site_id: siteId },
    include: {
      tasks: true,
      invoice: { select: { id: true, invoice_number: true } },
    },
  });

  if (!order) {
    throw new NotFoundException(`Workshop order ${orderId} not found`);
  }
  assertOrderEditable(order);

  const scheduledDate = await resolveDefaultTaskScheduledDate(
    tx,
    tenantId,
    order,
    siteId,
  );

  const task = await tx.workshopTask.create({
    data: {
      tenant_id: tenantId,
      workshop_order_id: orderId,
      title: dto.title,
      status: WorkshopTaskStatus.NOT_STARTED,
      sequence:
        order.tasks.reduce((max, task) => Math.max(max, task.sequence), 0) + 1,
      scheduled_date: scheduledDate,
    },
    include: {
      line_items: true,
    },
  });

  const allTaskStatuses = [...order.tasks.map((t) => t.status), task.status];
  const nextOrderStatus = deriveOrderStatus(allTaskStatuses);

  return { order, task, nextOrderStatus };
}

export async function assertTaskNotBlockedByParts(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
): Promise<void> {
  const lines =
    (await tx.workshopTaskLineItem.findMany({
      where: { tenant_id: tenantId, workshop_task_id: taskId },
      select: { part_execution_status: true },
    })) ?? [];
  const reservations =
    (await tx.partsReservation.findMany({
      where: {
        tenant_id: tenantId,
        workshop_task_line_item: { workshop_task_id: taskId },
      },
      select: {
        status: true,
        quantity: true,
        quantity_consumed: true,
        quantity_returned: true,
        quantity_staged: true,
      },
    })) ?? [];
  if (isTaskBlockedByParts({ lines, reservations })) {
    throw new ConflictException(
      'Task cannot be completed while part work is incomplete.',
    );
  }
}

export async function validateLaborOperationIds(
  prisma: Prisma.TransactionClient | PrismaService,
  tenantId: string,
  items: ReplaceWorkshopTaskLineItemsDto['items'],
) {
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

export async function incrementTaskLineItemsVersion(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  taskId: string,
  expectedLineItemsVersion: number,
) {
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

export async function validateSubmittedLineItemIds(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  taskId: string,
  dto: ReplaceWorkshopTaskLineItemsDto,
) {
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
  const consumedQuantities = new Map<string, Prisma.Decimal>();
  for (const reservation of reservationHistory) {
    consumedQuantities.set(
      reservation.workshop_task_line_item_id,
      (
        consumedQuantities.get(reservation.workshop_task_line_item_id) ??
        new Prisma.Decimal(0)
      ).add(new Prisma.Decimal(reservation.quantity_consumed)),
    );
  }
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
    const lineReservations = reservationHistory.filter(
      (reservation) => reservation.workshop_task_line_item_id === line.id,
    );
    const consumedQuantity = lineReservations.reduce(
      (sum, reservation) =>
        sum.add(new Prisma.Decimal(reservation.quantity_consumed)),
      new Prisma.Decimal(0),
    );
    const activeCommitment = lineReservations.reduce((sum, reservation) => {
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
    const minimumQuantity = consumedQuantity.add(activeCommitment);

    if (requestedQuantity.lessThan(minimumQuantity)) {
      throw new ConflictException(
        'Workshop line quantity cannot be reduced below allocated or consumed demand',
      );
    }
  }
}

export async function lockWorkshopRows(
  tx: Prisma.TransactionClient,
  tableName:
    'workshop_tasks' | 'workshop_task_line_items' | 'parts_reservations',
  tenantId: string,
  ids: readonly string[],
  siteId?: string,
): Promise<void> {
  const sortedIds = [...new Set(ids)].sort();
  if (sortedIds.length === 0) {
    return;
  }

  if (tableName === 'workshop_tasks' && siteId) {
    // eslint-disable-next-line no-restricted-syntax -- line mutations share the global task/line/reservation lock order.
    await tx.$queryRaw`
      SELECT task.id
      FROM workshop_tasks AS task
      INNER JOIN workshop_orders AS order_row
        ON order_row.tenant_id = task.tenant_id
        AND order_row.id = task.workshop_order_id
      WHERE task.tenant_id = ${tenantId}
        AND order_row.site_id = ${siteId}
        AND task.id IN (${Prisma.join(sortedIds)})
      ORDER BY task.id
      FOR UPDATE
    `;
    return;
  }

  // eslint-disable-next-line no-restricted-syntax -- line mutations share the global task/line/reservation lock order.
  await tx.$queryRaw`
    SELECT id
    FROM ${Prisma.raw(tableName)}
    WHERE tenant_id = ${tenantId}
      AND id IN (${Prisma.join(sortedIds)})
    ORDER BY id
    FOR UPDATE
  `;
}

export async function handleDeletedLineItems(
  ctx: DeleteLineItemsContext,
  existingItems: Array<{
    id: string;
    part_execution_status: WorkshopPartLineExecutionStatus | null;
  }>,
  submittedIds: string[],
  reservationHistory: LineReservationSummary[] = [],
) {
  const { deletedIds, hardDeleteIds, cancelIds, consumedIds } =
    classifyDeletedLineItems(existingItems, submittedIds, reservationHistory);

  if (deletedIds.length === 0) {
    return;
  }

  const activeReservations = reservationHistory.filter(
    (reservation) =>
      Boolean(reservation.id) &&
      Boolean(reservation.status) &&
      deletedIds.includes(reservation.workshop_task_line_item_id) &&
      isActiveSlice(reservation as ReservationSliceState),
  );

  for (const reservation of activeReservations) {
    if (ctx.releaseReservation && reservation.id) {
      await ctx.releaseReservation(
        reservation.id,
        { returnLocationId: ctx.returnLocationId },
        ctx.tx,
      );
    }
  }

  if (consumedIds.length > 0 && activeReservations.length === 0) {
    throw new ConflictException(
      'Consumed line items must be released before removal',
    );
  }
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

export function buildNewTaskLineItemRecord(
  tenantId: string,
  taskId: string,
  item: ReplaceWorkshopTaskLineItemsDto['items'][number],
): Prisma.WorkshopTaskLineItemCreateManyInput {
  return {
    tenant_id: tenantId,
    workshop_task_id: taskId,
    type:
      item.type === WorkshopLineItemType.LABOR
        ? WorkshopLineItemType.LABOR
        : WorkshopLineItemType.PART,
    part_execution_status:
      item.type === WorkshopLineItemType.PART
        ? WorkshopPartLineExecutionStatus.PENDING_PICK
        : null,
    item_no: item.itemNo,
    description: item.description,
    quantity: new Prisma.Decimal(item.qty),
    unit_price: new Prisma.Decimal(item.unitPrice),
    labor_operation_id: item.laborOperationId ?? null,
    standard_aw:
      item.standardAw != null ? new Prisma.Decimal(item.standardAw) : null,
    actual_hours:
      item.actualHours != null ? new Prisma.Decimal(item.actualHours) : null,
    internal_cost_rate:
      item.internalCostRate != null
        ? new Prisma.Decimal(item.internalCostRate)
        : null,
  };
}

export async function createNewTaskLineItems(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
  items: ReplaceWorkshopTaskLineItemsDto['items'],
) {
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

export async function updateExistingTaskLineItems(
  ctx: UpdateTaskLineItemsContext,
  items: ReplaceWorkshopTaskLineItemsDto['items'],
) {
  const existingItemsToUpdate = items.filter(
    (item): item is typeof item & { id: string } => !!item.id,
  );
  if (existingItemsToUpdate.length === 0) {
    return;
  }

  const partLineIds = existingItemsToUpdate
    .filter((item) => item.type === WorkshopLineItemType.PART)
    .map((item) => item.id);

  const reservations = partLineIds.length
    ? await ctx.tx.partsReservation.findMany({
        where: {
          tenant_id: ctx.tenantId,
          workshop_task_line_item_id: { in: partLineIds },
        },
        select: {
          workshop_task_line_item_id: true,
          quantity_consumed: true,
          quantity_staged: true,
        },
      })
    : [];

  const reservationsByLine = new Map<string, typeof reservations>();
  for (const reservation of reservations) {
    const lineReservations =
      reservationsByLine.get(reservation.workshop_task_line_item_id) ?? [];
    lineReservations.push(reservation);
    reservationsByLine.set(
      reservation.workshop_task_line_item_id,
      lineReservations,
    );
  }

  const partExecutionStatusById = new Map<
    string,
    WorkshopPartLineExecutionStatus
  >();
  for (const item of existingItemsToUpdate.filter(
    (candidate) => candidate.type === WorkshopLineItemType.PART,
  )) {
    const lineReservations = reservationsByLine.get(item.id) ?? [];
    const consumed = lineReservations.reduce(
      (sum, reservation) =>
        sum.add(new Prisma.Decimal(reservation.quantity_consumed)),
      new Prisma.Decimal(0),
    );
    const hasStaged = lineReservations.some((reservation) =>
      new Prisma.Decimal(reservation.quantity_staged).gt(0),
    );
    partExecutionStatusById.set(
      item.id,
      consumed.gte(new Prisma.Decimal(item.qty))
        ? WorkshopPartLineExecutionStatus.CONSUMED
        : hasStaged
          ? WorkshopPartLineExecutionStatus.STAGED
          : WorkshopPartLineExecutionStatus.PENDING_PICK,
    );
  }

  await Promise.all(
    existingItemsToUpdate.map((item) =>
      ctx.tx.workshopTaskLineItem.updateMany({
        where: {
          id: item.id,
          tenant_id: ctx.tenantId,
          workshop_task_id: ctx.taskId,
          workshop_task: { workshop_order: { site_id: ctx.siteId } },
        },
        data: {
          description: item.description,
          quantity: new Prisma.Decimal(item.qty),
          unit_price: new Prisma.Decimal(item.unitPrice),
          ...(item.actualHours != null && {
            actual_hours: new Prisma.Decimal(item.actualHours),
          }),
          ...(item.standardAw != null && {
            standard_aw: new Prisma.Decimal(item.standardAw),
          }),
          ...(item.internalCostRate != null && {
            internal_cost_rate: new Prisma.Decimal(item.internalCostRate),
          }),
          ...(item.laborOperationId !== undefined && {
            labor_operation_id: item.laborOperationId,
          }),
          ...(item.type === WorkshopLineItemType.PART && {
            part_execution_status: partExecutionStatusById.get(item.id),
          }),
        },
      }),
    ),
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

export async function executeTaskDeletion(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  orderId: string,
  taskId: string,
) {
  const task = await findTaskAndAssertEditable(
    tx,
    tenantId,
    orderId,
    taskId,
    siteId,
  );

  if (task.workshop_order.invoice) {
    throw new BadRequestException(
      'Workshop order already has an invoice; tasks cannot be deleted',
    );
  }

  const reservationHistory =
    (await tx.partsReservation.findMany({
      where: {
        tenant_id: tenantId,
        workshop_task_line_item: { workshop_task_id: taskId },
      },
      select: { id: true },
      take: 1,
    })) ?? [];
  if (reservationHistory.length > 0) {
    throw new ConflictException(
      'Tasks with reservation or inventory activity cannot be hard-deleted.',
    );
  }

  const deleteResult = await tx.workshopTask.deleteMany({
    where: {
      id: taskId,
      tenant_id: tenantId,
      workshop_order: { site_id: siteId },
    },
  });

  if (deleteResult.count === 0) {
    throw new NotFoundException(`Task ${taskId} not found for this order`);
  }
}

export async function executeLineItemReplacement(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  taskId: string,
  dto: ReplaceWorkshopTaskLineItemsDto,
  releaseReservation: (
    reservationId: string,
    options: { returnLocationId?: string },
    client: Prisma.TransactionClient,
  ) => Promise<unknown>,
) {
  await lockWorkshopRows(tx, 'workshop_tasks', tenantId, [taskId], siteId);
  const { submittedIds, existingItems } = await validateSubmittedLineItemIds(
    tx,
    tenantId,
    siteId,
    taskId,
    dto,
  );
  await lockWorkshopRows(
    tx,
    'workshop_task_line_items',
    tenantId,
    existingItems.map((item) => item.id),
    siteId,
  );
  const reservationHistory = await findLineReservationHistory(
    tx,
    tenantId,
    siteId,
    existingItems,
  );
  await lockWorkshopRows(
    tx,
    'parts_reservations',
    tenantId,
    reservationHistory.map((reservation) => reservation.id),
    siteId,
  );
  assertLineQuantityDemand(existingItems, dto, reservationHistory);

  await incrementTaskLineItemsVersion(
    tx,
    tenantId,
    siteId,
    taskId,
    dto.expectedLineItemsVersion,
  );

  await handleDeletedLineItems(
    {
      tx,
      tenantId,
      siteId,
      taskId,
      returnLocationId: dto.returnLocationId,
      releaseReservation,
    },
    existingItems,
    submittedIds,
    reservationHistory,
  );
  await createNewTaskLineItems(tx, tenantId, taskId, dto.items);
  await updateExistingTaskLineItems(
    {
      tx,
      tenantId,
      siteId,
      taskId,
    },
    dto.items,
  );
}

export async function executeApplyDerivedOrderStatus(params: {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  orderId: string;
  nextOrderStatus: WorkshopOrderStatus;
  onStockPrepCompleted?: (
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    siteId: string,
  ) => Promise<void>;
}): Promise<boolean> {
  const {
    tx,
    tenantId,
    siteId,
    orderId,
    nextOrderStatus,
    onStockPrepCompleted,
  } = params;
  const order = await tx.workshopOrder.findFirst({
    where: { id: orderId, tenant_id: tenantId, site_id: siteId },
    select: { status: true },
  });
  if (!order) {
    throw new NotFoundException(`Workshop order ${orderId} not found`);
  }
  if (order.status === WorkshopOrderStatus.INVOICED) {
    return false;
  }
  if (order.status === nextOrderStatus) {
    return true;
  }

  try {
    await guardedStatusUpdate(bindStatusUpdateMany(tx.workshopOrder), {
      id: orderId,
      tenantId,
      extraWhere: { site_id: siteId },
      from: order.status,
      to: nextOrderStatus,
      conflictMessage:
        'Workshop order status changed concurrently. Please refresh and try again.',
    });
  } catch (error) {
    return resolveOrderStatusConflict(
      tx,
      tenantId,
      orderId,
      nextOrderStatus,
      error,
      siteId,
    );
  }

  if (
    nextOrderStatus === WorkshopOrderStatus.COMPLETED &&
    onStockPrepCompleted
  ) {
    await onStockPrepCompleted(tx, tenantId, orderId, siteId);
  }
  return true;
}

export async function executeTaskUpdateTransaction(params: {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  orderId: string;
  taskId: string;
  dto: UpdateWorkshopTaskDto;
  applyDerivedStatus: (
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    nextOrderStatus: WorkshopOrderStatus,
  ) => Promise<boolean>;
}) {
  const { tx, tenantId, siteId, orderId, taskId, dto, applyDerivedStatus } =
    params;
  await lockWorkshopRows(tx, 'workshop_tasks', tenantId, [taskId], siteId);
  const task = await findTaskAndAssertEditable(
    tx,
    tenantId,
    orderId,
    taskId,
    siteId,
  );

  if (dto.status === WorkshopTaskStatus.DONE) {
    await assertTaskNotBlockedByParts(tx, tenantId, taskId);
  }

  await executeTaskUpdate(
    tx,
    tenantId,
    orderId,
    taskId,
    task.status,
    dto,
    siteId,
  );

  await recalculateAndApplyOrderStatus(
    tx,
    tenantId,
    orderId,
    applyDerivedStatus,
    siteId,
  );
}
