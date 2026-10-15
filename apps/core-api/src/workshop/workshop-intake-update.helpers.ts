import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma, WorkshopOrderStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import type { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import type { WorkshopScheduleService } from './workshop-schedule.service.js';
import type { DomainEventStoreService } from '../domain-event-store/domain-event-store.service.js';
import type { RequestContextService } from '../common/services/request-context.service.js';
import type { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto.js';
import {
  assertOrderEditable,
  type WorkshopOrderWithRelations,
} from './workshop-order.helpers.js';
import { assertPersistedSiteId } from '../site/document-retarget.helpers.js';
import { ORDER_WITH_INVOICE_RELATIONS } from './workshop-intake-query.helpers.js';
import { executeUpdateOrderRetargeting } from './workshop-intake-retarget.helpers.js';

export interface WorkshopIntakeServices {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  siteContext: SiteContextService;
  scheduleService: WorkshopScheduleService;
  partsRequisitionService: Pick<PartsRequisitionService, 'releaseReservation'>;
  domainEventStore: DomainEventStoreService;
  requestContext: RequestContextService;
}

export interface ExecuteBasicOrderUpdateParams {
  prisma: PrismaService;
  tenantId: string;
  siteId: string;
  id: string;
  dto: UpdateWorkshopOrderDto;
}

export interface ExecuteRescheduleOrderParams {
  prisma: PrismaService;
  scheduleService: Pick<WorkshopScheduleService, 'rescheduleOrder'>;
  tenantId: string;
  siteId: string;
  id: string;
  existing: {
    vehicle_id: string;
    bay_id: string | null;
    mechanic_id: string | null;
    scheduled_start_at: Date | null;
    scheduled_end_at: Date | null;
    status: WorkshopOrderStatus;
  };
  dto: UpdateWorkshopOrderDto;
}

export function buildWorkshopOrderScheduleUpdateData(
  dto: UpdateWorkshopOrderDto,
  scheduleData: {
    bayId: string;
    mechanicId: string | null;
    start: Date;
    end: Date;
  },
): Prisma.WorkshopOrderUncheckedUpdateManyInput {
  return {
    reported_issue: dto.reportedIssue,
    notes: dto.notes,
    bay_id: scheduleData.bayId,
    mechanic_id: scheduleData.mechanicId,
    scheduled_start_at: scheduleData.start,
    scheduled_end_at: scheduleData.end,
  };
}

export async function executeRescheduleOrder(
  params: ExecuteRescheduleOrderParams,
) {
  const { prisma, scheduleService, tenantId, siteId, id, existing, dto } =
    params;
  return prisma.$transaction(async (tx) => {
    const scheduleData = await scheduleService.rescheduleOrder(
      id,
      {
        vehicle_id: existing.vehicle_id,
        bay_id: existing.bay_id,
        mechanic_id: existing.mechanic_id,
        scheduled_start_at: existing.scheduled_start_at,
        scheduled_end_at: existing.scheduled_end_at,
        status: existing.status,
      },
      dto,
      tx,
    );

    const updateResult = await tx.workshopOrder.updateMany({
      where: { id, tenant_id: tenantId, site_id: siteId },
      data: buildWorkshopOrderScheduleUpdateData(dto, scheduleData),
    });
    if (updateResult.count === 0) {
      throw new NotFoundException(`Workshop order ${id} not found`);
    }

    return tx.workshopOrder.findFirstOrThrow({
      where: { id, tenant_id: tenantId, site_id: siteId },
      include: ORDER_WITH_INVOICE_RELATIONS,
    });
  });
}

export async function executeBasicOrderUpdate(
  params: ExecuteBasicOrderUpdateParams,
) {
  const { prisma, tenantId, siteId, id, dto } = params;
  const updateResult = await prisma.workshopOrder.updateMany({
    where: { id, tenant_id: tenantId, site_id: siteId },
    data: {
      reported_issue: dto.reportedIssue,
      notes: dto.notes,
    },
  });
  if (updateResult.count === 0) {
    throw new NotFoundException(`Workshop order ${id} not found`);
  }

  return prisma.workshopOrder.findFirstOrThrow({
    where: { id, tenant_id: tenantId, site_id: siteId },
    include: ORDER_WITH_INVOICE_RELATIONS,
  });
}

export function isOrderRetargeting(
  dto: UpdateWorkshopOrderDto,
  persistedSiteId: string,
): boolean {
  return dto.siteId !== undefined && dto.siteId !== persistedSiteId;
}

/**
 * Without a retarget, the order is only reachable from the site it is persisted on; a retarget may leave the
 * active site, so the check is skipped for it.
 */
export function assertActiveSiteMatch(
  isRetargeting: boolean,
  persistedSiteId: string,
  activeSiteId: string,
  id: string,
): void {
  if (!isRetargeting && persistedSiteId !== activeSiteId) {
    throw new NotFoundException(`Workshop order ${id} not found`);
  }
}

export function assertExpectedSiteMatch(
  expectedSiteId: string | undefined,
  persistedSiteId: string,
): void {
  if (expectedSiteId !== undefined && expectedSiteId !== persistedSiteId) {
    throw new ConflictException(
      'Workshop order site changed concurrently. Please refresh.',
    );
  }
}

export function hasScheduleUpdateFields(dto: UpdateWorkshopOrderDto): boolean {
  return (
    dto.bayId !== undefined ||
    dto.scheduledStartAt !== undefined ||
    dto.scheduledEndAt !== undefined ||
    dto.mechanicId !== undefined
  );
}

export async function executeUpdateOrder(
  services: WorkshopIntakeServices,
  id: string,
  dto: UpdateWorkshopOrderDto,
): Promise<WorkshopOrderWithRelations> {
  const tenantId = await services.tenantContext.getTenantId();
  const activeSiteId = await services.siteContext.getSiteId();
  const authorizedSiteIds = await services.siteContext.listAuthorizedSiteIds();

  const existing = await services.prisma.workshopOrder.findFirst({
    where: { id, tenant_id: tenantId, site_id: { in: authorizedSiteIds } },
    include: ORDER_WITH_INVOICE_RELATIONS,
  });
  if (!existing) {
    throw new NotFoundException(`Workshop order ${id} not found`);
  }
  assertOrderEditable(existing);
  const persistedSiteId = assertPersistedSiteId(
    existing.site_id,
    'Workshop order site ownership is required',
  );

  const isRetargeting = isOrderRetargeting(dto, persistedSiteId);
  assertActiveSiteMatch(isRetargeting, persistedSiteId, activeSiteId, id);
  assertExpectedSiteMatch(dto.expectedSiteId, persistedSiteId);

  if (isRetargeting) {
    return executeUpdateOrderRetargeting({
      prisma: services.prisma,
      tenantContext: services.tenantContext,
      partsRequisitionService: services.partsRequisitionService,
      tenantId,
      id,
      existing,
      persistedSiteId,
      dto,
    });
  }

  if (hasScheduleUpdateFields(dto)) {
    return executeRescheduleOrder({
      prisma: services.prisma,
      scheduleService: services.scheduleService,
      tenantId,
      siteId: persistedSiteId,
      id,
      existing,
      dto,
    });
  }

  return executeBasicOrderUpdate({
    prisma: services.prisma,
    tenantId,
    siteId: persistedSiteId,
    id,
    dto,
  });
}
