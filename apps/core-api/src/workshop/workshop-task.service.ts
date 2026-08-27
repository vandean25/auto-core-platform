import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWorkshopTaskDto } from './dto/create-workshop-task.dto';
import type { UpdateWorkshopTaskDto } from './dto/update-workshop-task.dto';
import type { ReplaceWorkshopTaskLineItemsDto } from './dto/replace-workshop-task-line-items.dto';
import {
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition';
import { VehicleLedgerService } from '../vehicle-stock/vehicle-ledger.service';
import {
  assertOrderEditable,
  deriveOrderStatus,
} from './workshop-order.helpers';
import { WorkshopIntakeService } from './workshop-intake.service';
import { formatLocalDate, parseLocalDate } from './workshop-planner.time';

@Injectable()
export class WorkshopTaskService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    @Inject(VehicleLedgerService)
    private readonly vehicleLedger: VehicleLedgerService,
    private readonly orders: WorkshopIntakeService,
  ) {}

  private async resolveDefaultTaskScheduledDate(
    tx: Prisma.TransactionClient,
    tenantId: string,
    order: {
      tasks: { id: string }[];
      scheduled_start_at: Date | null;
    },
  ): Promise<Date | undefined> {
    if (order.tasks.length > 0 || !order.scheduled_start_at) {
      return undefined;
    }

    const settings = await tx.workshopSettings.findFirst({
      where: { tenant_id: tenantId },
      select: { timezone: true },
    });
    const timeZone = settings?.timezone ?? 'Europe/Vienna';
    const localDate = formatLocalDate(order.scheduled_start_at, timeZone);
    const { year, month, day } = parseLocalDate(localDate);
    return new Date(Date.UTC(year, month - 1, day));
  }

  private async applyDerivedOrderStatus(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    nextOrderStatus: WorkshopOrderStatus,
  ) {
    const order = await tx.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
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
        from: order.status,
        to: nextOrderStatus,
        conflictMessage:
          'Workshop order status changed concurrently. Please refresh and try again.',
      });
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }
      const latest = await tx.workshopOrder.findFirst({
        where: { id: orderId, tenant_id: tenantId },
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

    if (nextOrderStatus === WorkshopOrderStatus.COMPLETED) {
      await this.vehicleLedger.completeStockPrep(tx, tenantId, orderId);
    }
    return true;
  }

  async createTask(orderId: string, dto: CreateWorkshopTaskDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const createdTask = await this.prisma.$transaction(async (tx) => {
      const order = await tx.workshopOrder.findFirst({
        where: { id: orderId, tenant_id: tenantId },
        include: {
          tasks: true,
          invoice: { select: { id: true, invoice_number: true } },
        },
      });

      if (!order) {
        throw new NotFoundException(`Workshop order ${orderId} not found`);
      }
      assertOrderEditable(order);

      const scheduledDate = await this.resolveDefaultTaskScheduledDate(
        tx,
        tenantId,
        order,
      );

      const task = await tx.workshopTask.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          title: dto.title,
          status: WorkshopTaskStatus.NOT_STARTED,
          scheduled_date: scheduledDate,
        },
        include: {
          line_items: true,
        },
      });

      const allTaskStatuses = [
        ...order.tasks.map((t) => t.status),
        task.status,
      ];
      const nextOrderStatus = deriveOrderStatus(allTaskStatuses);
      if (nextOrderStatus !== order.status) {
        const applied = await this.applyDerivedOrderStatus(
          tx,
          tenantId,
          orderId,
          nextOrderStatus,
        );
        if (!applied) {
          return {
            ...task,
            done: task.status === WorkshopTaskStatus.DONE,
            lineItems: [],
          };
        }
      }

      return {
        ...task,
        done: task.status === WorkshopTaskStatus.DONE,
        lineItems: [],
      };
    });

    return createdTask;
  }

  async updateTask(
    orderId: string,
    taskId: string,
    dto: UpdateWorkshopTaskDto,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.workshopTask.findFirst({
        where: {
          id: taskId,
          tenant_id: tenantId,
          workshop_order_id: orderId,
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

      const fieldData: Prisma.WorkshopTaskUpdateManyMutationInput = {};
      if (dto.title !== undefined) {
        fieldData.title = dto.title;
      }
      if (dto.mechanicNotes !== undefined) {
        fieldData.mechanic_notes = dto.mechanicNotes;
      }

      const nextStatus = dto.status;
      if (nextStatus !== undefined && nextStatus !== task.status) {
        await guardedStatusUpdate(bindStatusUpdateMany(tx.workshopTask), {
          id: taskId,
          tenantId,
          from: task.status,
          to: nextStatus,
          extraWhere: { workshop_order_id: orderId },
          extraData: fieldData,
          conflictMessage: `Task ${taskId} status changed concurrently. Please refresh and try again.`,
        });
      } else if (Object.keys(fieldData).length > 0) {
        const taskUpdate = await tx.workshopTask.updateMany({
          where: {
            id: taskId,
            tenant_id: tenantId,
            workshop_order_id: orderId,
          },
          data: fieldData,
        });

        if (taskUpdate.count === 0) {
          throw new NotFoundException(
            `Task ${taskId} not found for this order`,
          );
        }
      }

      const tasks = await tx.workshopTask.findMany({
        where: { workshop_order_id: orderId, tenant_id: tenantId },
        select: { status: true },
      });

      const nextOrderStatus = deriveOrderStatus(tasks.map((t) => t.status));
      const updateResult = await this.applyDerivedOrderStatus(
        tx,
        tenantId,
        orderId,
        nextOrderStatus,
      );
      if (!updateResult) {
        return;
      }
    });

    return this.orders.findOne(orderId);
  }

  async deleteTask(orderId: string, taskId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.workshopTask.findFirst({
        where: {
          id: taskId,
          tenant_id: tenantId,
          workshop_order_id: orderId,
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

      if (task.workshop_order.invoice) {
        throw new BadRequestException(
          'Workshop order already has an invoice; tasks cannot be deleted',
        );
      }

      const deleteResult = await tx.workshopTask.deleteMany({
        where: { id: taskId, tenant_id: tenantId },
      });

      if (deleteResult.count === 0) {
        throw new NotFoundException(`Task ${taskId} not found for this order`);
      }

      const tasks = await tx.workshopTask.findMany({
        where: { workshop_order_id: orderId, tenant_id: tenantId },
        select: { status: true },
      });

      const nextOrderStatus = deriveOrderStatus(
        tasks.map((existingTask) => existingTask.status),
      );
      await this.applyDerivedOrderStatus(
        tx,
        tenantId,
        orderId,
        nextOrderStatus,
      );
    });

    return this.orders.findOne(orderId);
  }

  async replaceTaskLineItems(
    orderId: string,
    taskId: string,
    dto: ReplaceWorkshopTaskLineItemsDto,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const task = await this.prisma.workshopTask.findFirst({
      where: {
        id: taskId,
        tenant_id: tenantId,
        workshop_order_id: orderId,
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

    // Validate labor operations belong to the current tenant
    const laborOperationIds = [
      ...new Set(
        dto.items
          .map((i) => i.laborOperationId)
          .filter((id): id is string => !!id),
      ),
    ];

    if (laborOperationIds.length > 0) {
      const foundCount = await this.prisma.laborOperation.count({
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

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.workshopTaskLineItem.deleteMany({
          where: { workshop_task_id: taskId },
        });

        if (dto.items.length > 0) {
          await tx.workshopTaskLineItem.createMany({
            data: dto.items.map((item) => ({
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
                item.standardAw != null
                  ? new Prisma.Decimal(item.standardAw)
                  : null,
              actual_hours:
                item.actualHours != null
                  ? new Prisma.Decimal(item.actualHours)
                  : null,
              internal_cost_rate:
                item.internalCostRate != null
                  ? new Prisma.Decimal(item.internalCostRate)
                  : null,
            })),
          });
        }
      });
    } catch (error) {
      const fieldName =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.meta?.field_name
          : undefined;
      const fieldNameText =
        typeof fieldName === 'string'
          ? fieldName
          : Array.isArray(fieldName)
            ? fieldName
                .filter((part): part is string => typeof part === 'string')
                .join(',')
            : '';

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

    return this.orders.findOne(orderId);
  }
}
