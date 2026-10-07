import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import type { UpdateWorkshopInspectionDto } from './dto/update-workshop-inspection.dto.js';

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
      include: { items: { orderBy: { createdAt: 'asc' } } },
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
    const inspection = await this.getTaskChecklist(orderId, taskId);
    const itemIds = dto.items.map((item) => item.id);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException('Checklist item IDs must be unique.');
    }
    const existingItems = await this.prisma.workshopInspectionItem.findMany({
      where: {
        tenant_id: inspection.tenant_id,
        workshop_inspection_id: inspection.id,
        id: { in: itemIds },
      },
      select: { id: true },
    });
    if (existingItems.length !== itemIds.length) {
      throw new BadRequestException('One or more checklist items are invalid.');
    }

    const tenantId = inspection.tenant_id;
    const siteId = await this.siteContext.getSiteId();
    await this.prisma.$transaction(
      async (tx) => {
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
              tenant_id: inspection.tenant_id,
              workshop_inspection_id: inspection.id,
            },
            data: {
              ...(item.passed !== undefined && { passed: item.passed }),
              ...(item.notes !== undefined && { notes: item.notes }),
            },
          }),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.getTaskChecklist(orderId, taskId);
  }
}
