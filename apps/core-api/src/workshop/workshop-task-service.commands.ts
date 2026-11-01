import { syncWorkshopEstimateOverrunAfterWrite } from './workshop-estimate-overrun-sync.js';
import { Inject, Injectable } from '@nestjs/common';
import { WorkshopTaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { VehicleLedgerService } from '../vehicle-stock/vehicle-ledger.service.js';
import type { CreateWorkshopTaskDto } from './dto/create-workshop-task.dto.js';
import type { UpdateWorkshopTaskDto } from './dto/update-workshop-task.dto.js';
import type { ReplaceWorkshopTaskLineItemsDto } from './dto/replace-workshop-task-line-items.dto.js';
import { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import { NotificationCloudTasksService } from '../notifications/notification-cloud-tasks.service.js';
import { wakeUpAfterCommit } from './workshop-estimate-email-queue.js';
import { WorkshopIntakeService } from './workshop-intake.service.js';
import { WorkshopOrderReadyEmailService } from './workshop-order-ready-email.service.js';
import {
  assertWorkshopTaskExecutionRole,
  assertWorkshopTaskWriteRole,
} from './workshop-task-scope.js';
import {
  applyDerivedOrderStatusWithStockPrep,
  executeLineItemReplacement,
  executeTaskCreation,
  executeTaskDeletion,
  executeTaskUpdateTransaction,
  handleTaskLineItemsError,
  recalculateAndApplyOrderStatus,
  validateLaborOperationIds,
  validateTaskForLineItemReplacement,
} from './workshop-task.helpers.js';

export type WorkshopTaskServiceDeps = {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  siteContext: SiteContextService;
  vehicleLedger: VehicleLedgerService;
  orders: WorkshopIntakeService;
  partsReservations: PartsRequisitionService;
  readyEmail: WorkshopOrderReadyEmailService;
  wakeUps: NotificationCloudTasksService;
};

async function applyDerivedOrderStatus(
  deps: WorkshopTaskServiceDeps,
  input: {
    tx: import('@prisma/client').Prisma.TransactionClient;
    tenantId: string;
    siteId: string;
    orderId: string;
    nextOrderStatus: import('@prisma/client').WorkshopOrderStatus;
  },
): Promise<{ applied: boolean; queuedOutboxId: string | null }> {
  let queuedOutboxId: string | null = null;
  const applied = await applyDerivedOrderStatusWithStockPrep(
    deps.vehicleLedger,
    input,
    async (tx, tenantId, siteId, orderId) => {
      queuedOutboxId = await deps.readyEmail.onOrderCompletedInTx(tx, {
        tenantId,
        siteId,
        orderId,
        occurredAt: new Date(),
      });
    },
  );
  return { applied, queuedOutboxId: applied ? queuedOutboxId : null };
}

async function resolveScopedContext(deps: WorkshopTaskServiceDeps) {
  const [tenantId, siteId] = await Promise.all([
    deps.tenantContext.getTenantId(),
    deps.siteContext.getSiteId(),
  ]);
  return { tenantId, siteId };
}

export async function runWorkshopTaskCreate(
  deps: WorkshopTaskServiceDeps,
  orderId: string,
  dto: CreateWorkshopTaskDto,
) {
  assertWorkshopTaskWriteRole(deps.tenantContext, 'Creating workshop tasks');
  const { tenantId, siteId } = await resolveScopedContext(deps);
  const { task, queuedOutboxId } = await deps.prisma.$transaction(
    async (tx) => {
      const { order, task, nextOrderStatus } = await executeTaskCreation({
        tx,
        tenantId,
        siteId,
        orderId,
        dto,
      });

      let queuedOutboxId: string | null = null;
      if (nextOrderStatus !== order.status) {
        ({ queuedOutboxId } = await applyDerivedOrderStatus(deps, {
          tx,
          tenantId,
          siteId,
          orderId,
          nextOrderStatus,
        }));
      }

      return {
        task,
        queuedOutboxId,
      };
    },
  );
  if (queuedOutboxId) {
    await wakeUpAfterCommit(deps.wakeUps, queuedOutboxId, tenantId);
  }
  return {
    ...task,
    done: task.status === WorkshopTaskStatus.DONE,
    lineItems: [],
  };
}

export async function runWorkshopTaskUpdate(
  deps: WorkshopTaskServiceDeps,
  orderId: string,
  taskId: string,
  dto: UpdateWorkshopTaskDto,
) {
  assertWorkshopTaskExecutionRole(
    deps.tenantContext,
    'Updating workshop tasks',
  );
  const { tenantId, siteId } = await resolveScopedContext(deps);
  const queuedOutboxId = await deps.prisma.$transaction(async (tx) => {
    let outboxId: string | null = null;
    await executeTaskUpdateTransaction({
      tx,
      tenantId,
      siteId,
      orderId,
      taskId,
      dto,
      applyDerivedStatus: async (t, ten, ord, next) => {
        const outcome = await applyDerivedOrderStatus(deps, {
          tx: t,
          tenantId: ten,
          siteId,
          orderId: ord,
          nextOrderStatus: next,
        });
        outboxId = outcome.queuedOutboxId;
        return outcome.applied;
      },
    });
    return outboxId;
  });
  if (queuedOutboxId) {
    await wakeUpAfterCommit(deps.wakeUps, queuedOutboxId, tenantId);
  }

  return deps.orders.findOne(orderId);
}

export async function runWorkshopTaskDelete(
  deps: WorkshopTaskServiceDeps,
  orderId: string,
  taskId: string,
) {
  assertWorkshopTaskWriteRole(deps.tenantContext, 'Deleting workshop tasks');
  const { tenantId, siteId } = await resolveScopedContext(deps);
  const queuedOutboxId = await deps.prisma.$transaction(async (tx) => {
    await executeTaskDeletion({ tx, tenantId, siteId, orderId, taskId });
    let outboxId: string | null = null;
    await recalculateAndApplyOrderStatus({
      tx,
      tenantId,
      orderId,
      applyDerivedStatus: async (t, ten, ord, next) => {
        const outcome = await applyDerivedOrderStatus(deps, {
          tx: t,
          tenantId: ten,
          siteId,
          orderId: ord,
          nextOrderStatus: next,
        });
        outboxId = outcome.queuedOutboxId;
        return outcome.applied;
      },
      siteId,
    });
    return outboxId;
  });
  if (queuedOutboxId) {
    await wakeUpAfterCommit(deps.wakeUps, queuedOutboxId, tenantId);
  }

  return deps.orders.findOne(orderId);
}

export async function runWorkshopTaskLineItemReplacement(
  deps: WorkshopTaskServiceDeps,
  orderId: string,
  taskId: string,
  dto: ReplaceWorkshopTaskLineItemsDto,
) {
  assertWorkshopTaskWriteRole(deps.tenantContext, 'Modifying task line items');
  const { tenantId, siteId } = await resolveScopedContext(deps);
  await validateTaskForLineItemReplacement({
    prisma: deps.prisma,
    tenantId,
    siteId,
    orderId,
    taskId,
  });
  await validateLaborOperationIds(deps.prisma, tenantId, dto.items);

  try {
    await deps.prisma.$transaction(async (tx) => {
      await executeLineItemReplacement({
        tx,
        tenantId,
        siteId,
        taskId,
        dto,
        releaseReservation: (reservationId, options, client) =>
          deps.partsReservations.releaseReservation(
            reservationId,
            options,
            client,
          ),
      });
    });
  } catch (error) {
    handleTaskLineItemsError(error);
  }

  return deps.orders.findOne(orderId);
}

@Injectable()
export class WorkshopTaskService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    @Inject(SiteContextService)
    private readonly siteContext: SiteContextService,
    @Inject(VehicleLedgerService)
    private readonly vehicleLedger: VehicleLedgerService,
    private readonly orders: WorkshopIntakeService,
    private readonly partsReservations: PartsRequisitionService,
    private readonly readyEmail: WorkshopOrderReadyEmailService,
    private readonly wakeUps: NotificationCloudTasksService,
  ) {}

  async listForMcp(input: { page: number; pageSize: number }) {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const where = {
      tenant_id: tenantId,
      workshop_order: { is: { tenant_id: tenantId, site_id: siteId } },
    };
    const skip = (input.page - 1) * input.pageSize;
    const [data, total] = await Promise.all([
      this.prisma.workshopTask.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take: input.pageSize,
        select: {
          id: true,
          workshop_order_id: true,
          title: true,
          status: true,
          line_items_version: true,
          line_items: {
            select: {
              id: true,
              type: true,
              item_no: true,
              description: true,
              quantity: true,
              unit_price: true,
              catalog_item_id: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      this.prisma.workshopTask.count({ where }),
    ]);
    return {
      data,
      meta: { total, page: input.page, page_size: input.pageSize },
    };
  }

  createTask(orderId: string, dto: CreateWorkshopTaskDto) {
    return runWorkshopTaskCreate(this.deps(), orderId, dto);
  }

  updateTask(orderId: string, taskId: string, dto: UpdateWorkshopTaskDto) {
    return runWorkshopTaskUpdate(this.deps(), orderId, taskId, dto);
  }

  deleteTask(orderId: string, taskId: string) {
    return runWorkshopTaskDelete(this.deps(), orderId, taskId);
  }

  async replaceTaskLineItems(
    orderId: string,
    taskId: string,
    dto: ReplaceWorkshopTaskLineItemsDto,
  ) {
    const result = await runWorkshopTaskLineItemReplacement(
      this.deps(),
      orderId,
      taskId,
      dto,
    );
    // The lines changed, so an overrun against the approved estimate is recorded now (AUT-355).
    await syncWorkshopEstimateOverrunAfterWrite(
      this.prisma,
      this.siteContext,
      await this.tenantContext.getTenantId(),
      orderId,
    );
    return result;
  }

  private deps(): WorkshopTaskServiceDeps {
    return {
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
      vehicleLedger: this.vehicleLedger,
      orders: this.orders,
      partsReservations: this.partsReservations,
      readyEmail: this.readyEmail,
      wakeUps: this.wakeUps,
    };
  }
}
