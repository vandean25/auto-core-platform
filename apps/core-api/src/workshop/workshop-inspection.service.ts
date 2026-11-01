import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkshopCheckInStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import type { UpdateWorkshopInspectionDto } from './dto/update-workshop-inspection.dto.js';
import { CHECK_IN_ERROR_CODES } from './workshop-check-in.rules.js';
import { assertCheckInDraftForMutation } from './workshop-check-in-immutability.js';
import { toWorkshopInspectionResponse } from './workshop-inspection.mapper.js';
import type { WorkshopInspectionResponseDto } from './dto/workshop-inspection-response.dto.js';
import { assertWorkshopTaskExecutionRole } from './workshop-task-scope.js';

const taskInspectionInclude = {
  items: { orderBy: { createdAt: 'asc' as const } },
};

const orderInspectionInclude = {
  items: {
    orderBy: [
      { inspection_template_item: { sort_order: 'asc' as const } },
      { createdAt: 'asc' as const },
    ],
    include: {
      inspection_template_item: { select: { sort_order: true } },
    },
  },
};

@Injectable()
export class WorkshopInspectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async getTaskChecklist(orderId: string, taskId: string) {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const inspection = await this.prisma.workshopInspection.findFirst({
      where: {
        tenant_id: tenantId,
        workshop_order_id: orderId,
        workshop_task_id: taskId,
        workshop_order: { site_id: siteId },
      },
      include: taskInspectionInclude,
    });
    if (!inspection) {
      throw new NotFoundException(
        'Checklist not found for this workshop task.',
      );
    }
    return inspection;
  }

  async updateTaskChecklist(
    orderId: string,
    taskId: string,
    dto: UpdateWorkshopInspectionDto,
  ) {
    assertWorkshopTaskExecutionRole(
      this.tenantContext,
      'Updating task checklist',
    );
    const inspection = await this.getTaskChecklist(orderId, taskId);
    await this.applyInspectionItemUpdates(
      orderId,
      inspection.tenant_id,
      inspection.id,
      dto,
    );
    return this.getTaskChecklist(orderId, taskId);
  }

  async getOrderCheckInChecklist(
    orderId: string,
  ): Promise<WorkshopInspectionResponseDto> {
    const inspection = await this.findOrderCheckInInspection(orderId);
    return toWorkshopInspectionResponse(inspection);
  }

  async updateOrderCheckInChecklist(
    orderId: string,
    expectedRevision: number,
    dto: UpdateWorkshopInspectionDto,
  ): Promise<WorkshopInspectionResponseDto> {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    const checkIn = await this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
      select: {
        id: true,
        status: true,
        revision: true,
        inspection_id: true,
      },
    });
    if (!checkIn) {
      throw new NotFoundException('Workshop check-in not found');
    }
    if (checkIn.status === WorkshopCheckInStatus.COMPLETED) {
      assertCheckInDraftForMutation(checkIn.status);
    }
    if (!checkIn.inspection_id) {
      throw new NotFoundException('Check-in reception checklist not found');
    }

    const inspection = await this.prisma.workshopInspection.findFirst({
      where: {
        tenant_id: tenantId,
        id: checkIn.inspection_id,
        workshop_order_id: orderId,
        workshop_task_id: null,
        workshop_order: { site_id: siteId },
      },
      select: { id: true, tenant_id: true },
    });
    if (!inspection) {
      throw new NotFoundException('Check-in reception checklist not found');
    }

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.workshopCheckIn.updateMany({
        where: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          id: checkIn.id,
          revision: expectedRevision,
          status: WorkshopCheckInStatus.DRAFT,
        },
        data: { revision: { increment: 1 } },
      });
      if (count === 0) {
        const latest = await tx.workshopCheckIn.findFirst({
          where: { tenant_id: tenantId, workshop_order_id: orderId },
          select: { status: true },
        });
        if (!latest) {
          throw new NotFoundException('Workshop check-in not found');
        }
        if (latest.status === WorkshopCheckInStatus.COMPLETED) {
          assertCheckInDraftForMutation(latest.status);
        }
        throw new ConflictException({
          code: CHECK_IN_ERROR_CODES.CHECK_IN_CONFLICT,
          message: 'Check-in revision is stale. Reload and retry.',
        });
      }

      await this.applyInspectionItemUpdates(
        orderId,
        inspection.tenant_id,
        inspection.id,
        dto,
        tx,
      );
    });

    return this.getOrderCheckInChecklist(orderId);
  }

  private async findOrderCheckInInspection(orderId: string) {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    const checkIn = await this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
      select: { inspection_id: true },
    });
    if (!checkIn?.inspection_id) {
      throw new NotFoundException('Check-in reception checklist not found');
    }

    const inspection = await this.prisma.workshopInspection.findFirst({
      where: {
        tenant_id: tenantId,
        id: checkIn.inspection_id,
        workshop_order_id: orderId,
        workshop_task_id: null,
        workshop_order: { site_id: siteId },
      },
      include: orderInspectionInclude,
    });
    if (!inspection) {
      throw new NotFoundException('Check-in reception checklist not found');
    }
    return inspection;
  }

  private async applyInspectionItemUpdates(
    orderId: string,
    tenantId: string,
    inspectionId: string,
    dto: UpdateWorkshopInspectionDto,
    prisma: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const itemIds = dto.items.map((item) => item.id);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException('Checklist item IDs must be unique.');
    }
    const existingItems = await prisma.workshopInspectionItem.findMany({
      where: {
        tenant_id: tenantId,
        workshop_inspection_id: inspectionId,
        id: { in: itemIds },
      },
      select: { id: true },
    });
    if (existingItems.length !== itemIds.length) {
      throw new BadRequestException('One or more checklist items are invalid.');
    }

    const siteId = await this.siteContext.getSiteId();
    const runUpdates = async (tx: Prisma.TransactionClient) => {
      const activeSiteOrder = await tx.workshopOrder.findFirst({
        where: { id: orderId, tenant_id: tenantId, site_id: siteId },
        select: { id: true },
      });
      if (!activeSiteOrder) {
        throw new NotFoundException(
          'Workshop order is outside the active site.',
        );
      }

      await chunkedPromiseAll(dto.items, (item) =>
        tx.workshopInspectionItem.updateMany({
          where: {
            id: item.id,
            tenant_id: tenantId,
            workshop_inspection_id: inspectionId,
          },
          data: {
            ...(item.passed !== undefined && { passed: item.passed }),
            ...(item.notes !== undefined && { notes: item.notes }),
          },
        }),
      );
    };

    if ('$transaction' in prisma && typeof prisma.$transaction === 'function') {
      await prisma.$transaction(async (tx) => runUpdates(tx), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      return;
    }

    await runUpdates(prisma);
  }
}
