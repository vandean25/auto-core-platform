import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition';
import {
  assertOrderEditable,
  deriveOrderStatus,
} from './workshop-order.helpers';
import { formatLocalDate, parseLocalDate } from './workshop-planner.time';
import type { UpdateWorkshopTaskDto } from './dto/update-workshop-task.dto';
import type { ReplaceWorkshopTaskLineItemsDto } from './dto/replace-workshop-task-line-items.dto';

export interface DeleteLineItemsContext {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  taskId: string;
}

export interface LineReservationSummary {
  workshop_task_line_item_id: string;
  quantity_consumed: Prisma.Decimal | number | string;
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

  if (consumedIds.length > 0) {
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
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  taskId: string,
  items: ReplaceWorkshopTaskLineItemsDto['items'],
) {
  const existingItemsToUpdate = items.filter(
    (item): item is typeof item & { id: string } => !!item.id,
  );

  await Promise.all(
    existingItemsToUpdate.map((item) =>
      tx.workshopTaskLineItem.updateMany({
        where: {
          id: item.id,
          tenant_id: tenantId,
          workshop_task_id: taskId,
          workshop_task: { workshop_order: { site_id: siteId } },
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
