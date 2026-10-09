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
import { WorkshopIntakeService } from './workshop-intake.service.js';
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
};

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
  const { tenantId, siteId } = await resolveScopedContext(deps);
  return deps.prisma.$transaction(async (tx) => {
    const { order, task, nextOrderStatus } = await executeTaskCreation({
      tx,
      tenantId,
      siteId,
      orderId,
      dto,
    });

    if (nextOrderStatus !== order.status) {
      await applyDerivedOrderStatusWithStockPrep(deps.vehicleLedger, {
        tx,
        tenantId,
        siteId,
        orderId,
        nextOrderStatus,
      });
    }

    return {
      ...task,
      done: task.status === WorkshopTaskStatus.DONE,
      lineItems: [],
    };
  });
}

export async function runWorkshopTaskUpdate(
  deps: WorkshopTaskServiceDeps,
  orderId: string,
  taskId: string,
  dto: UpdateWorkshopTaskDto,
) {
  const { tenantId, siteId } = await resolveScopedContext(deps);
  await deps.prisma.$transaction(async (tx) => {
    await executeTaskUpdateTransaction({
      tx,
      tenantId,
      siteId,
      orderId,
      taskId,
      dto,
      applyDerivedStatus: (t, ten, ord, next) =>
        applyDerivedOrderStatusWithStockPrep(deps.vehicleLedger, {
          tx: t,
          tenantId: ten,
          siteId,
          orderId: ord,
          nextOrderStatus: next,
        }),
    });
  });

  return deps.orders.findOne(orderId);
}

export async function runWorkshopTaskDelete(
  deps: WorkshopTaskServiceDeps,
  orderId: string,
  taskId: string,
) {
  const { tenantId, siteId } = await resolveScopedContext(deps);
  await deps.prisma.$transaction(async (tx) => {
    await executeTaskDeletion({ tx, tenantId, siteId, orderId, taskId });
    await recalculateAndApplyOrderStatus({
      tx,
      tenantId,
      orderId,
      applyDerivedStatus: (t, ten, ord, next) =>
        applyDerivedOrderStatusWithStockPrep(deps.vehicleLedger, {
          tx: t,
          tenantId: ten,
          siteId,
          orderId: ord,
          nextOrderStatus: next,
        }),
      siteId,
    });
  });

  return deps.orders.findOne(orderId);
}

export async function runWorkshopTaskLineItemReplacement(
  deps: WorkshopTaskServiceDeps,
  orderId: string,
  taskId: string,
  dto: ReplaceWorkshopTaskLineItemsDto,
) {
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

  replaceTaskLineItems(
    orderId: string,
    taskId: string,
    dto: ReplaceWorkshopTaskLineItemsDto,
  ) {
    return runWorkshopTaskLineItemReplacement(
      this.deps(),
      orderId,
      taskId,
      dto,
    );
  }

  private deps(): WorkshopTaskServiceDeps {
    return {
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
      vehicleLedger: this.vehicleLedger,
      orders: this.orders,
      partsReservations: this.partsReservations,
    };
  }
}
