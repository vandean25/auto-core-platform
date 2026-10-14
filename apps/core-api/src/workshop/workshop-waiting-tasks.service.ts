import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkshopTaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import type { WorkshopResumeWaitingTasksResponseDto } from './dto/workshop-waiting-tasks.dto.js';
import { WORKSHOP_ESTIMATE_OPEN_ORDER_STATUSES } from './workshop-estimate.constants.js';
import {
  assertBackOfficeRole,
  resolveEstimateScope,
  type EstimateScope,
} from './workshop-estimate-scope.js';

/**
 * Advisor action "Resume waiting tasks" (AUT-355, ADR-0025 §9). A customer approval never moves a task on its own,
 * so the advisor resumes the tasks that waited for the customer. Each task moves WAITING_CUSTOMER -> PAUSED under a
 * guarded update, and the mechanic continues from PAUSED through the existing start transition.
 */
@Injectable()
export class WorkshopWaitingTasksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    @Inject(SiteContextService)
    private readonly siteContext: SiteContextService,
  ) {}

  async resumeWaitingTasks(
    orderId: string,
  ): Promise<WorkshopResumeWaitingTasksResponseDto> {
    assertBackOfficeRole(this.tenantContext, 'Resuming waiting tasks');
    const scope = await resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });
    return this.prisma.$transaction((tx) =>
      this.resumeInTransaction(tx, scope, orderId),
    );
  }

  private async resumeInTransaction(
    tx: Prisma.TransactionClient,
    scope: EstimateScope,
    orderId: string,
  ): Promise<WorkshopResumeWaitingTasksResponseDto> {
    const order = await tx.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: scope.tenantId, site_id: scope.siteId },
      select: { status: true },
    });
    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }
    if (!WORKSHOP_ESTIMATE_OPEN_ORDER_STATUSES.includes(order.status)) {
      throw new ConflictException({
        code: 'WORKSHOP_ORDER_NOT_OPEN',
        message: 'Waiting tasks can only be resumed while the order is open.',
      });
    }

    const waiting = await tx.workshopTask.findMany({
      where: {
        tenant_id: scope.tenantId,
        workshop_order_id: orderId,
        status: WorkshopTaskStatus.WAITING_CUSTOMER,
      },
      orderBy: { sequence: 'asc' },
      select: { id: true },
    });
    const taskIds = waiting.map((task) => task.id);
    if (taskIds.length === 0) {
      return { resumed_task_ids: [] };
    }

    const moved = await tx.workshopTask.updateMany({
      where: {
        tenant_id: scope.tenantId,
        id: { in: taskIds },
        status: WorkshopTaskStatus.WAITING_CUSTOMER,
      },
      data: { status: WorkshopTaskStatus.PAUSED },
    });
    if (moved.count !== taskIds.length) {
      throw new ConflictException({
        code: 'WORKSHOP_TASK_CHANGED',
        message:
          'The tasks changed while they were being resumed. Reload the order and try again.',
      });
    }
    return { resumed_task_ids: taskIds };
  }
}
