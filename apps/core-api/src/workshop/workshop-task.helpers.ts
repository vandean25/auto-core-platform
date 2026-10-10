import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WorkshopOrderStatus,
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
import { isTaskBlockedByParts } from '../parts-requisition/parts-requisition.helpers.js';
import { assertNoWarrantyClaimLines } from './workshop-warranty-claim-guard.js';
import type { CreateWorkshopTaskDto } from './dto/create-workshop-task.dto.js';
import type { UpdateWorkshopTaskDto } from './dto/update-workshop-task.dto.js';
import type { ReplaceWorkshopTaskLineItemsDto } from './dto/replace-workshop-task-line-items.dto.js';
import {
  assertLineQuantityDemand,
  createNewTaskLineItems,
  findLineReservationHistory,
  handleDeletedLineItems,
  incrementTaskLineItemsVersion,
  updateExistingTaskLineItems,
  validateSubmittedLineItemIds,
} from './workshop-task-line-items.helpers.js';

export * from './workshop-task-line-items.helpers.js';

export interface FindTaskAndAssertEditableParams {
  prisma: Prisma.TransactionClient | PrismaService;
  tenantId: string;
  orderId: string;
  taskId: string;
  siteId: string;
}

export async function findTaskAndAssertEditable(
  params: FindTaskAndAssertEditableParams,
) {
  const { prisma, tenantId, orderId, taskId, siteId } = params;
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

export interface ValidateTaskForLineItemReplacementParams {
  prisma: Prisma.TransactionClient | PrismaService;
  tenantId: string;
  siteId: string;
  orderId: string;
  taskId: string;
}

export async function validateTaskForLineItemReplacement(
  params: ValidateTaskForLineItemReplacementParams,
) {
  return findTaskAndAssertEditable(params);
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

export interface ExecuteTaskUpdateParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  orderId: string;
  taskId: string;
  currentStatus: WorkshopTaskStatus;
  dto: UpdateWorkshopTaskDto;
  siteId: string;
}

async function performGuardedTaskStatusUpdate(
  params: ExecuteTaskUpdateParams,
  nextStatus: WorkshopTaskStatus,
  fieldData: Prisma.WorkshopTaskUpdateManyMutationInput,
): Promise<void> {
  await guardedStatusUpdate(bindStatusUpdateMany(params.tx.workshopTask), {
    id: params.taskId,
    tenantId: params.tenantId,
    from: params.currentStatus,
    to: nextStatus,
    extraWhere: {
      workshop_order_id: params.orderId,
      workshop_order: { site_id: params.siteId },
    },
    extraData: fieldData,
    conflictMessage: `Task ${params.taskId} status changed concurrently. Please refresh and try again.`,
  });
}

export async function executeTaskUpdate(params: ExecuteTaskUpdateParams) {
  const { tx, tenantId, orderId, taskId, currentStatus, dto, siteId } = params;
  const fieldData = buildTaskUpdateFieldData(dto);
  const nextStatus = dto.status;

  if (nextStatus !== undefined && nextStatus !== currentStatus) {
    await performGuardedTaskStatusUpdate(params, nextStatus, fieldData);
    return;
  }

  if (Object.keys(fieldData).length === 0) {
    return;
  }

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

export interface RecalculateAndApplyOrderStatusParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  orderId: string;
  applyDerivedStatus: (
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    nextOrderStatus: WorkshopOrderStatus,
  ) => Promise<boolean>;
  siteId: string;
}

export async function recalculateAndApplyOrderStatus(
  params: RecalculateAndApplyOrderStatusParams,
): Promise<boolean> {
  const { tx, tenantId, orderId, applyDerivedStatus, siteId } = params;
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

export interface ResolveOrderStatusConflictParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  orderId: string;
  nextOrderStatus: WorkshopOrderStatus;
  error: unknown;
  siteId: string;
}

export async function resolveOrderStatusConflict(
  params: ResolveOrderStatusConflictParams,
): Promise<boolean> {
  const { tx, tenantId, orderId, nextOrderStatus, error, siteId } = params;
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

export interface ExecuteTaskCreationParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  orderId: string;
  dto: CreateWorkshopTaskDto;
}

export async function executeTaskCreation(params: ExecuteTaskCreationParams) {
  const { tx, tenantId, siteId, orderId, dto } = params;
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
        order.tasks.reduce((max, t) => Math.max(max, t.sequence), 0) + 1,
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

export interface LockWorkshopRowsParams {
  tx: Prisma.TransactionClient;
  tableName:
    'workshop_tasks' | 'workshop_task_line_items' | 'parts_reservations';
  tenantId: string;
  ids: readonly string[];
  siteId?: string;
}

export async function lockWorkshopRows(
  params: LockWorkshopRowsParams,
): Promise<void> {
  const { tx, tableName, tenantId, ids, siteId } = params;
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

export interface ExecuteTaskDeletionParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  orderId: string;
  taskId: string;
}

export async function executeTaskDeletion(params: ExecuteTaskDeletionParams) {
  const { tx, tenantId, siteId, orderId, taskId } = params;
  const task = await findTaskAndAssertEditable({
    prisma: tx,
    tenantId,
    orderId,
    taskId,
    siteId,
  });

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

  await assertNoWarrantyClaimLines(tx, {
    tenant_id: tenantId,
    workshop_task_line_item: { workshop_task_id: taskId },
  });

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

export interface ExecuteLineItemReplacementParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  taskId: string;
  dto: ReplaceWorkshopTaskLineItemsDto;
  releaseReservation: (
    reservationId: string,
    options: { returnLocationId?: string },
    client: Prisma.TransactionClient,
  ) => Promise<unknown>;
}

export async function executeLineItemReplacement(
  params: ExecuteLineItemReplacementParams,
) {
  const { tx, tenantId, siteId, taskId, dto, releaseReservation } = params;
  await lockWorkshopRows({
    tx,
    tableName: 'workshop_tasks',
    tenantId,
    ids: [taskId],
    siteId,
  });
  const { submittedIds, existingItems } = await validateSubmittedLineItemIds({
    tx,
    tenantId,
    siteId,
    taskId,
    dto,
  });
  await lockWorkshopRows({
    tx,
    tableName: 'workshop_task_line_items',
    tenantId,
    ids: existingItems.map((item) => item.id),
    siteId,
  });
  const reservationHistory = await findLineReservationHistory(
    tx,
    tenantId,
    siteId,
    existingItems,
  );
  await lockWorkshopRows({
    tx,
    tableName: 'parts_reservations',
    tenantId,
    ids: reservationHistory.map((reservation) => reservation.id),
    siteId,
  });
  assertLineQuantityDemand(existingItems, dto, reservationHistory);

  await incrementTaskLineItemsVersion({
    tx,
    tenantId,
    siteId,
    taskId,
    expectedLineItemsVersion: dto.expectedLineItemsVersion,
  });

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

export interface StockPrepCompletionContext {
  tx: Prisma.TransactionClient;
  tenantId: string;
  orderId: string;
  siteId: string;
  onStockPrepCompleted?: (
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    siteId: string,
  ) => Promise<void>;
}

async function handleStockPrepCompletion(
  ctx: StockPrepCompletionContext,
): Promise<void> {
  if (ctx.onStockPrepCompleted) {
    await ctx.onStockPrepCompleted(
      ctx.tx,
      ctx.tenantId,
      ctx.orderId,
      ctx.siteId,
    );
  }
}

function shouldSkipOrderStatusTransition(
  orderStatus: WorkshopOrderStatus,
  nextOrderStatus: WorkshopOrderStatus,
): { skip: boolean; result: boolean } {
  if (orderStatus === WorkshopOrderStatus.INVOICED) {
    return { skip: true, result: false };
  }
  if (orderStatus === nextOrderStatus) {
    return { skip: true, result: true };
  }
  return { skip: false, result: false };
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
  const statusCheck = shouldSkipOrderStatusTransition(
    order.status,
    nextOrderStatus,
  );
  if (statusCheck.skip) {
    return statusCheck.result;
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
    return resolveOrderStatusConflict({
      tx,
      tenantId,
      orderId,
      nextOrderStatus,
      error,
      siteId,
    });
  }

  if (nextOrderStatus === WorkshopOrderStatus.COMPLETED) {
    await handleStockPrepCompletion({
      tx,
      tenantId,
      orderId,
      siteId,
      onStockPrepCompleted,
    });
  }
  return true;
}

export type ApplyDerivedOrderStatusParams = {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  orderId: string;
  nextOrderStatus: WorkshopOrderStatus;
};

export function applyDerivedOrderStatusWithStockPrep(
  vehicleLedger: {
    completeStockPrep: (
      tx: Prisma.TransactionClient,
      tenantId: string,
      orderId: string,
      siteId: string,
    ) => Promise<void>;
  },
  params: ApplyDerivedOrderStatusParams,
) {
  return executeApplyDerivedOrderStatus({
    ...params,
    onStockPrepCompleted: (tx, tenantId, orderId, siteId) =>
      vehicleLedger.completeStockPrep(tx, tenantId, orderId, siteId),
  });
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
  await lockWorkshopRows({
    tx,
    tableName: 'workshop_tasks',
    tenantId,
    ids: [taskId],
    siteId,
  });
  const task = await findTaskAndAssertEditable({
    prisma: tx,
    tenantId,
    orderId,
    taskId,
    siteId,
  });

  if (dto.status === WorkshopTaskStatus.DONE) {
    await assertTaskNotBlockedByParts(tx, tenantId, taskId);
  }

  await executeTaskUpdate({
    tx,
    tenantId,
    orderId,
    taskId,
    currentStatus: task.status,
    dto,
    siteId,
  });

  await recalculateAndApplyOrderStatus({
    tx,
    tenantId,
    orderId,
    applyDerivedStatus,
    siteId,
  });
}
