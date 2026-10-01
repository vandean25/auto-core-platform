import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateWorkshopTaskDto } from './dto/create-workshop-task.dto.js';
import type { UpdateWorkshopTaskDto } from './dto/update-workshop-task.dto.js';
import type { ReplaceWorkshopTaskLineItemsDto } from './dto/replace-workshop-task-line-items.dto.js';
import {
  Prisma,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { VehicleLedgerService } from '../vehicle-stock/vehicle-ledger.service.js';
import {
  executeApplyDerivedOrderStatus,
  executeLineItemReplacement,
  executeTaskCreation,
  executeTaskDeletion,
  executeTaskUpdateTransaction,
  handleTaskLineItemsError,
  recalculateAndApplyOrderStatus,
  validateLaborOperationIds,
  validateTaskForLineItemReplacement,
} from './workshop-task.helpers.js';
import { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import { WorkshopIntakeService } from './workshop-intake.service.js';

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

  private async getScopedContext(): Promise<{
    tenantId: string;
    siteId: string;
  }> {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    return { tenantId, siteId };
  }

  private applyDerivedOrderStatus(params: {
    tx: Prisma.TransactionClient;
    tenantId: string;
    siteId: string;
    orderId: string;
    nextOrderStatus: WorkshopOrderStatus;
  }) {
    return executeApplyDerivedOrderStatus({
      ...params,
      onStockPrepCompleted: (tx, tenantId, orderId, siteId) =>
        this.vehicleLedger.completeStockPrep(tx, tenantId, orderId, siteId),
    });
  }

  async createTask(orderId: string, dto: CreateWorkshopTaskDto) {
    const { tenantId, siteId } = await this.getScopedContext();
    return this.prisma.$transaction(async (tx) => {
      const { order, task, nextOrderStatus } = await executeTaskCreation({
        tx,
        tenantId,
        siteId,
        orderId,
        dto,
      });

      if (nextOrderStatus !== order.status) {
        await this.applyDerivedOrderStatus({
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

  async updateTask(
    orderId: string,
    taskId: string,
    dto: UpdateWorkshopTaskDto,
  ) {
    const { tenantId, siteId } = await this.getScopedContext();
    await this.prisma.$transaction(async (tx) => {
      await executeTaskUpdateTransaction({
        tx,
        tenantId,
        siteId,
        orderId,
        taskId,
        dto,
        applyDerivedStatus: (t, ten, ord, next) =>
          this.applyDerivedOrderStatus({
            tx: t,
            tenantId: ten,
            siteId,
            orderId: ord,
            nextOrderStatus: next,
          }),
      });
    });

    return this.orders.findOne(orderId);
  }

  async deleteTask(orderId: string, taskId: string) {
    const { tenantId, siteId } = await this.getScopedContext();
    await this.prisma.$transaction(async (tx) => {
      await executeTaskDeletion({ tx, tenantId, siteId, orderId, taskId });
      await recalculateAndApplyOrderStatus({
        tx,
        tenantId,
        orderId,
        applyDerivedStatus: (t, ten, ord, next) =>
          this.applyDerivedOrderStatus({
            tx: t,
            tenantId: ten,
            siteId,
            orderId: ord,
            nextOrderStatus: next,
          }),
        siteId,
      });
    });

    return this.orders.findOne(orderId);
  }

  async replaceTaskLineItems(
    orderId: string,
    taskId: string,
    dto: ReplaceWorkshopTaskLineItemsDto,
  ) {
    const { tenantId, siteId } = await this.getScopedContext();
    await validateTaskForLineItemReplacement({
      prisma: this.prisma,
      tenantId,
      siteId,
      orderId,
      taskId,
    });
    await validateLaborOperationIds(this.prisma, tenantId, dto.items);

    try {
      await this.prisma.$transaction(async (tx) => {
        await executeLineItemReplacement({
          tx,
          tenantId,
          siteId,
          taskId,
          dto,
          releaseReservation: (reservationId, options, client) =>
            this.partsReservations.releaseReservation(
              reservationId,
              options,
              client,
            ),
        });
      });
    } catch (error) {
      handleTaskLineItemsError(error);
    }

    return this.orders.findOne(orderId);
  }
}
